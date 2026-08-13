#!/usr/bin/env python3
"""
AetherSpec — Backlog Generator
Deterministically extracts backlog items from the merged SRS-BE document.
No LLM involved. No agents. Pure extraction.

Usage:
    python3 generate_backlog.py --project-id prj-001 --doc-id doc-002 --db-url "..." --generated-by admin

Environment:
    MINIO_ENDPOINT        MinIO host (default: 127.0.0.1:9000)
    MINIO_ACCESS_KEY      MinIO access key
    MINIO_SECRET_KEY      MinIO secret key
    MINIO_USE_SSL         true/false (default: false)

Output:
    {project_id}/backlog/backlog-001.md
"""

import argparse
import io
import json
import os
import re
import sys
from datetime import datetime
from urllib.parse import urlparse

import psycopg2
from psycopg2.extras import RealDictCursor

from minio import Minio
from minio.error import S3Error

from markdown_table import parse_markdown_tables, find_rows_by_id_prefix

# ── ID patterns and category mapping ──
ID_PATTERNS = {
    "SR-BE": r"\bSR-BE-\d+\b",
    "NFR-BE": r"\bNFR-BE-\d+\b",
    "DATA-BE": r"\bDATA-BE-\d+\b",
    "INT-BE": r"\bINT-BE-\d+\b",
    "SEC-BE": r"\bSEC-BE-\d+\b",
    "RULE-BE": r"\bRULE-BE-\d+\b",
    "ASSUMP-BE": r"\bASSUMP-BE-\d+\b",
    "RISK-BE": r"\bRISK-BE-\d+\b",
    "UC-BE": r"\bUC-BE-\d+\b",
    "AC-BE": r"\bAC-BE-\d+\b",
}

CATEGORY_MAP = {
    "SR-BE": "Functional",
    "NFR-BE": "Non-Functional",
    "DATA-BE": "Data",
    "INT-BE": "Integration",
    "SEC-BE": "Security",
    "RULE-BE": "Business Rule",
    "ASSUMP-BE": "Assumption",
    "RISK-BE": "Risk",
    "UC-BE": "Use Case",
    "AC-BE": "Acceptance Criteria",
}

# Map RFC 2119 keywords to MoSCoW-style priorities.
PRIORITY_MAP = {
    "shall": "Must Have",
    "must": "Must Have",
    "should": "Should Have",
    "may": "Could Have",
}

EFFORT_MAP = {
    "Must Have": "Simple",
    "Should Have": "Medium",
    "Could Have": "Complex",
}


def get_minio_client(endpoint, access_key, secret_key, use_ssl=False):
    """Create a MinIO client."""
    return Minio(endpoint, access_key=access_key, secret_key=secret_key, secure=use_ssl)


def get_db_connection(db_url):
    """Open a Postgres connection."""
    return psycopg2.connect(db_url, cursor_factory=RealDictCursor)


def fetch_merged_srs_path(conn, doc_id):
    """Return the minio_path of the merged SRS-BE document if it exists."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT minio_path
            FROM document_steps
            WHERE document_id = %s
              AND step_number = 0
            LIMIT 1
            """,
            (doc_id,),
        )
        row = cur.fetchone()
        if row and row.get("minio_path"):
            return row["minio_path"]

        # Fallback: infer from project bucket convention.
        cur.execute(
            "SELECT project_id FROM documents WHERE id = %s",
            (doc_id,),
        )
        doc = cur.fetchone()
        if doc:
            return f"{doc['project_id']}/output/SRS-BE-001.md"
        return None


def minio_object_key(bucket, minio_path):
    """Strip leading bucket name from a full minio_path."""
    prefix = f"{bucket}/"
    if minio_path.startswith(prefix):
        return minio_path[len(prefix):]
    return minio_path


def fetch_object(minio_client, bucket, key):
    """Fetch an object from MinIO and return its UTF-8 content."""
    try:
        response = minio_client.get_object(bucket, key)
        content = response.read().decode("utf-8")
        response.close()
        response.release_conn()
        return content
    except S3Error as e:
        print(f"Warning: Could not fetch {bucket}/{key}: {e}", file=sys.stderr)
        return None


def infer_priority(requirement_text):
    """Infer MoSCoW priority from RFC 2119 keywords in the requirement text."""
    text_lower = requirement_text.lower()
    for keyword, priority in PRIORITY_MAP.items():
        if keyword in text_lower:
            return priority
    return "Must Have"


def extract_trace_targets(trace_text):
    """Extract BR-xxx and UC-xxx IDs from a Traces-To cell."""
    if not trace_text:
        return []
    ids = re.findall(r"\b(?:BR|UC|SR|NFR|DATA|INT|SEC|RULE|ASSUMP|RISK|AC)-(?:BE-)?\d+\b", trace_text)
    return ids


def generate_story(requirement_text, category):
    """Generate a simple draft user story from a requirement."""
    # Strip bold/italic markdown and leading system phrases.
    text = re.sub(r"\*\*|__|\*|_", "", requirement_text)
    text = re.sub(r"^\s*The backend system\s+", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+(shall|should|may|must)\s+", " ", text, flags=re.IGNORECASE)
    text = text.strip().rstrip(".")
    if not text:
        text = f"support the {category.lower()} requirement"
    return f"As a user, I want {text.lower()} so that the system fulfills the {category.lower()} requirement."


def generate_backlog_document(project_id, doc_id, generated_by, requirements):
    """Build the markdown backlog document and summary."""
    categories = {}
    priorities = {}

    lines = [
        f"# Backlog — {project_id}",
        "",
        f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"**Generated By:** {generated_by}",
        f"**Source Document:** {doc_id} (SRS-BE)",
        f"**Total Items:** {len(requirements)}",
        "",
        "## Summary",
        "",
        "| Category | Count |",
        "|---|---|",
    ]

    for req in requirements:
        cat = req["category"]
        categories[cat] = categories.get(cat, 0) + 1

    for cat, count in sorted(categories.items()):
        lines.append(f"| {cat} | {count} |")

    lines.extend([
        "",
        "| Priority | Count |",
        "|---|---|",
    ])

    for req in requirements:
        pri = req["priority"]
        priorities[pri] = priorities.get(pri, 0) + 1

    for pri, count in sorted(priorities.items()):
        lines.append(f"| {pri} | {count} |")

    lines.extend(["", "---", "", "## Backlog Items", ""])

    for i, req in enumerate(requirements, 1):
        bl_id = f"BL-{i:03d}"
        priority = req["priority"]
        effort = EFFORT_MAP.get(priority, "Medium")
        traces = ", ".join(req["traces_to"]) if req["traces_to"] else "N/A"
        story = generate_story(req["requirement"], req["category"])

        lines.extend([
            f"## {bl_id}: {req['id']}",
            "",
            f"**Category:** {req['category']}",
            f"**Priority:** {priority}",
            f"**Traces To:** {req['id']} → {traces}",
            f"**Effort Hint (Rough):** {effort}",
            "",
            f"**Story:** {story}",
            "",
            f"**Source Section:** {req.get('source_section') or 'SRS-BE'}",
            "",
            "---",
            "",
        ])

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Generate backlog from approved SRS-BE")
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--doc-id", required=True)
    parser.add_argument("--db-url", default=os.getenv("DATABASE_URL", ""), help="Postgres connection URL")
    parser.add_argument("--generated-by", default="system", help="Username of the person generating the backlog")
    parser.add_argument("--output-name", default="backlog-001.md", help="Output backlog file name")
    args = parser.parse_args()

    endpoint = os.getenv("MINIO_ENDPOINT", "127.0.0.1:9000")
    access_key = os.getenv("MINIO_ACCESS_KEY", "")
    secret_key = os.getenv("MINIO_SECRET_KEY", "")
    use_ssl = os.getenv("MINIO_USE_SSL", "false").lower() in ("true", "1", "yes")

    minio_client = get_minio_client(endpoint, access_key, secret_key, use_ssl)

    # Resolve merged SRS-BE path from DB or convention.
    conn = get_db_connection(args.db_url)
    minio_path = fetch_merged_srs_path(conn, args.doc_id)
    if not minio_path:
        print("ERROR: Could not determine merged SRS-BE path", file=sys.stderr)
        sys.exit(1)

    key = minio_object_key(args.project_id, minio_path)
    content = fetch_object(minio_client, args.project_id, key)
    if content is None:
        print(f"ERROR: Could not fetch merged SRS-BE from {minio_path}", file=sys.stderr)
        sys.exit(1)

    tables = parse_markdown_tables(content)
    id_prefixes = list(ID_PATTERNS.keys())
    rows = find_rows_by_id_prefix(tables, id_prefixes)

    requirements = []
    for row in rows:
        req_id = row["id"]
        prefix = req_id.split("-")[0]
        if prefix.endswith("BE"):
            prefix = "-".join(req_id.split("-")[:2])
        category = CATEGORY_MAP.get(prefix, "Unknown")
        requirement_text = row.get("requirement") or row.get("description") or req_id
        priority = row.get("priority") or infer_priority(requirement_text)
        traces = extract_trace_targets(row.get("traces_to", ""))
        source = row.get("source") or "SRS-BE"

        requirements.append({
            "id": req_id,
            "category": category,
            "requirement": requirement_text,
            "priority": priority,
            "traces_to": traces,
            "source_section": source,
        })

    if not requirements:
        print("ERROR: No requirements found in merged SRS-BE", file=sys.stderr)
        sys.exit(1)

    backlog_content = generate_backlog_document(
        args.project_id, args.doc_id, args.generated_by, requirements
    )

    backlog_path = f"backlog/{args.output_name}"
    data_bytes = backlog_content.encode("utf-8")
    minio_client.put_object(
        args.project_id,
        backlog_path,
        io.BytesIO(data_bytes),
        len(data_bytes),
        content_type="text/markdown",
    )

    summary = {
        "total": len(requirements),
        "categories": categories,
        "priorities": priorities,
        "output_path": f"{args.project_id}/{backlog_path}",
    }

    print(f"✅ Backlog generated: {args.project_id}/{backlog_path}")
    print(f"   Total items: {summary['total']}")
    print(f"JSON_SUMMARY:{json.dumps(summary)}")


if __name__ == "__main__":
    main()
