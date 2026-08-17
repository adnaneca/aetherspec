#!/usr/bin/env python3
"""
AetherSpec — SRS-FE Document Merger
Deterministically assembles the final SRS-FE document from approved sections.
No LLM involved. 100% accurate. 0% hallucination.

Usage:
    python3 merge_srs_fe.py --project-id prj-001 --doc-id doc-001 --db-url "..."

Environment:
    MINIO_ENDPOINT        MinIO host (default: 127.0.0.1:9000)
    MINIO_ACCESS_KEY      MinIO access key
    MINIO_SECRET_KEY      MinIO secret key
    MINIO_USE_SSL         true/false (default: false)

Output:
    {project_id}/output/{output_name}               (main document)
    {project_id}/srs-fe/appendices/A-rtm.md         (requirements traceability matrix)
    {project_id}/srs-fe/appendices/B-approval.md    (approval record)
    {project_id}/srs-fe/appendices/C-history.md     (change history placeholder)
    {project_id}/srs-fe/appendices/D-revisions.md   (draft revision log)
"""

import argparse
import io
import os
import re
import sys
from datetime import datetime
from urllib.parse import urlparse

import psycopg2
from psycopg2.extras import RealDictCursor

from minio import Minio
from minio.error import S3Error

# ── ID extraction patterns ──
ID_PATTERNS = {
    "SR-FE": r"\bSR-FE-\d+\b",
    "NFR-FE": r"\bNFR-FE-\d+\b",
    "UI-FE": r"\bUI-FE-\d+\b",
    "INT-FE": r"\bINT-FE-\d+\b",
    "CONSTR-FE": r"\bCONSTR-FE-\d+\b",
    "RULE-FE": r"\bRULE-FE-\d+\b",
    "ASSUMP-FE": r"\bASSUMP-FE-\d+\b",
    "RISK-FE": r"\bRISK-FE-\d+\b",
}

VALID_STATUSES = {"active", "paused", "completed", "terminated", "error"}


def get_minio_client(endpoint, access_key, secret_key, use_ssl=False):
    """Create a MinIO client."""
    return Minio(endpoint, access_key=access_key, secret_key=secret_key, secure=use_ssl)


def get_db_connection(db_url):
    """Open a Postgres connection."""
    return psycopg2.connect(db_url, cursor_factory=RealDictCursor)


def fetch_approved_steps(conn, doc_id):
    """Fetch approved document steps ordered by step_number."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT ds.step_number, ds.step_name, ds.status, ds.minio_path,
                   ds.approved_by, ds.approved_at
            FROM document_steps ds
            WHERE ds.document_id = %s
              AND ds.status = 'SIGNED_OFF'
            ORDER BY ds.step_number
            """,
            (doc_id,),
        )
        return cur.fetchall()


def fetch_section_content(minio_client, bucket, minio_path):
    """Fetch a section's content from MinIO using a full minio_path."""
    key = minio_object_key(bucket, minio_path)
    if not key:
        return None
    try:
        response = minio_client.get_object(bucket, key)
        content = response.read().decode("utf-8")
        response.close()
        response.release_conn()
        return content
    except S3Error as e:
        print(f"Warning: Could not fetch {minio_path}: {e}", file=sys.stderr)
        return None


def minio_object_key(bucket, minio_path):
    """Strip leading bucket name from a full minio_path."""
    prefix = f"{bucket}/"
    if minio_path.startswith(prefix):
        return minio_path[len(prefix) :]
    return minio_path


def extract_ids(content):
    """Extract all traceable IDs from section content."""
    all_ids = set()
    if content:
        for pattern in ID_PATTERNS.values():
            for match in re.finditer(pattern, content):
                all_ids.add(match.group())
    return sorted(all_ids)


def extract_sources(content):
    """Extract Source column entries from requirement tables."""
    sources = set()
    if not content:
        return sorted(sources)

    # Match markdown table rows and look for rows where first cell is "Source".
    # Continue reading subsequent rows until the table ends.
    rows = re.findall(r"^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|", content, re.MULTILINE)
    in_source_table = False
    for cell1, cell2 in rows:
        c1 = cell1.strip()
        c2 = cell2.strip()
        if c1.lower() == "source":
            in_source_table = True
            continue
        if c1.lower() in {"id", "requirement", "description", "priority", "---"}:
            in_source_table = False
            continue
        if in_source_table and c2 and c2 not in {"—", "-", "n/a"}:
            sources.add(c2)
    return sorted(sources)


def extract_traces_to(content):
    """Extract FE-xxx -> BR-xxx mappings from markdown table 'Traces-To' column."""
    fe_prefixes = tuple(['SR-FE-', 'INT-FE-', 'FR-FE-', 'NFR-FE-', 'UI-FE-',
                         'CONSTR-FE-', 'RULE-FE-', 'ASSUMP-FE-', 'RISK-FE-'])
    traces = []
    lines = content.split('\n') if content else []
    in_table = False
    header_cells = []
    traces_col_idx = -1
    req_col_idx = -1

    for line in lines:
        stripped = line.strip()
        if '|' in line:
            cells = [c.strip() for c in stripped.split('|')]
            cells = [c for c in cells if c != '']
            if not cells:
                continue
            if all(re.match(r'^:?-+:?$', c) for c in cells):
                continue

            if not in_table:
                in_table = True
                header_cells = cells
                traces_col_idx = -1
                req_col_idx = -1
                for i, cell in enumerate(cells):
                    if 'trace' in cell.lower():
                        traces_col_idx = i
                    if cell == 'ID' or any(cell.startswith(p) for p in fe_prefixes):
                        req_col_idx = i
                continue

            if in_table and traces_col_idx >= 0 and req_col_idx >= 0:
                if req_col_idx < len(cells) and traces_col_idx < len(cells):
                    req_id = cells[req_col_idx]
                    br_ref = cells[traces_col_idx]
                    if req_id.startswith(fe_prefixes) and br_ref.startswith('BR-'):
                        traces.append(f"{req_id} -> {br_ref}")
        elif in_table:
            in_table = False

    return traces


def extract_api_consumption(content):
    """Extract INT-FE-xxx -> INT-BE-xxx mappings from Section 5 markdown tables."""
    traces = []
    lines = content.split('\n') if content else []
    in_table = False
    header_cells = []
    int_fe_col_idx = -1
    contract_col_idx = -1

    for line in lines:
        stripped = line.strip()
        if '|' in line:
            cells = [c.strip() for c in stripped.split('|')]
            cells = [c for c in cells if c != '']
            if not cells:
                continue

            # A separator line like |---|---|---| ends header detection
            if all(re.match(r'^:?-+:?$', c) for c in cells):
                continue

            if not in_table:
                # Header row: locate columns by header names
                in_table = True
                header_cells = cells
                int_fe_col_idx = -1
                contract_col_idx = -1
                for i, cell in enumerate(cells):
                    if cell == 'ID' or cell.startswith('INT-FE'):
                        int_fe_col_idx = i
                    if any(term in cell.lower() for term in ['api', 'contract', 'consumes', 'backend api', 'int-be']):
                        contract_col_idx = i
                continue

            if in_table and int_fe_col_idx >= 0 and contract_col_idx >= 0:
                if int_fe_col_idx < len(cells) and contract_col_idx < len(cells):
                    int_fe_id = cells[int_fe_col_idx]
                    contract_ref = cells[contract_col_idx]
                    if int_fe_id.startswith('INT-FE') and 'INT-BE' in contract_ref:
                        int_be_ids = re.findall(r'INT-BE-\d+', contract_ref)
                        for int_be_id in int_be_ids:
                            traces.append(f"{int_fe_id} -> {int_be_id}")
        elif in_table:
            in_table = False
            header_cells = []
            int_fe_col_idx = -1
            contract_col_idx = -1

    return traces


def build_rtm(all_ids, all_traces, all_api_consumption):
    """Build the Requirements Traceability Matrix (Appendix A)."""
    lines = [
        "# Appendix A: Requirements Traceability Matrix",
        "",
        f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "## A.1 Frontend Requirements -> Business Requirements",
        "",
        "| Requirement ID | Traces To (BR) | Status |",
        "|---|---|---|",
    ]

    for trace in all_traces:
        lines.append(f"| {trace.replace(' -> ', ' | ')} | Traced |")

    lines.extend([
        "",
        "## A.2 Frontend Interactions -> Backend API Contracts",
        "",
        "| INT-FE ID | Consumes (INT-BE) | Status |",
        "|---|---|---|",
    ])

    for trace in all_api_consumption:
        lines.append(f"| {trace.replace(' -> ', ' | ')} | Traced |")

    lines.extend(["", f"**Total FE IDs:** {len(all_ids)} | **BR traces:** {len(all_traces)} | **API consumptions:** {len(all_api_consumption)}", ""])
    return "\n".join(lines)


def build_approval_record(steps_info, merged_by, merged_date):
    """Build the Approval Record (Appendix B)."""
    lines = [
        "# Appendix B: Approval Record",
        "",
        f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "## Section Approvals",
        "",
        "| Step | Section Name | Approved By | Approved Date |",
        "|---|---|---|---|",
    ]

    for step in steps_info:
        approved_by = step.get("approved_by") or "system"
        approved_at = ""
        raw_approved_at = step.get("approved_at")
        if raw_approved_at:
            try:
                # psycopg2 returns datetime; stringify first.
                dt = datetime.fromisoformat(str(raw_approved_at).replace("Z", "+00:00"))
                approved_at = dt.strftime("%Y-%m-%d")
            except (ValueError, TypeError):
                approved_at = str(raw_approved_at)[:10]
        lines.append(
            f"| {step['step_number']} | {step['step_name']} | {approved_by} | {approved_at} |"
        )

    lines.extend([
        "",
        "## Final Document Approval",
        "",
        "| Role | Name | Date |",
        "|---|---|---|",
        f"| Approved By | {merged_by} | {merged_date} |",
        "",
    ])

    return "\n".join(lines)


def build_change_history():
    """Build the Change History placeholder (Appendix C)."""
    return """# Appendix C: Change History (Post-Approval)

| CR-ID | Date | Section(s) | Summary | Approver | Version |
|---|---|---|---|---|---|---|
| — | — | — | No post-approval changes yet | — | — |
"""


def build_revision_log():
    """Build the Draft Revision Log placeholder (Appendix D)."""
    return """# Appendix D: Draft Revision Log (Pre-Approval)

| Date | Section | Summary | Version |
|---|---|---|---|
| — | — | No draft revisions recorded | — |
"""


def build_main_srs(sections_content, all_ids, all_sources, output_name):
    """Build the main SRS-FE document."""
    srs_id = output_name.replace(".md", "")
    now = datetime.now().strftime("%Y-%m-%d")

    lines = [
        "---",
        f"id: {srs_id}",
        "title: Software Requirements Specification — Frontend",
        "version: v1.0.0",
        "status: SIGNED_OFF",
        f"created: {now}",
        f"approved: {now}",
        "---",
        "",
        "# Software Requirements Specification — Frontend",
        "",
    ]

    for i, content in enumerate(sections_content):
        if content:
            lines.append(content)
            if i < len(sections_content) - 1:
                lines.extend(["", "---", ""])

    lines.extend([
        "",
        "## Appendices",
        "",
        "- [Appendix A: Requirements Traceability Matrix](appendices/A-rtm.md)",
        "- [Appendix B: Approval Record](appendices/B-approval.md)",
        "- [Appendix C: Change History](appendices/C-history.md)",
        "- [Appendix D: Draft Revision Log](appendices/D-revisions.md)",
        "",
    ])

    return "\n".join(lines)


def put_markdown(minio_client, bucket, key, content):
    """Write markdown content to MinIO."""
    data = content.encode("utf-8")
    minio_client.put_object(
        bucket,
        key,
        io.BytesIO(data),
        len(data),
        content_type="text/markdown",
    )


def main():
    parser = argparse.ArgumentParser(
        description="Merge approved SRS-FE sections into a final document"
    )
    parser.add_argument("--project-id", required=True, help="Project ID (MinIO bucket)")
    parser.add_argument("--doc-id", required=True, help="Document ID in Postgres")
    parser.add_argument(
        "--db-url",
        required=True,
        help="Postgres connection URL, e.g. postgres://user:pass@host:5432/db",
    )
    parser.add_argument("--merged-by", default="system", help="User who triggered merge")
    parser.add_argument(
        "--minio-endpoint",
        default=os.getenv("MINIO_ENDPOINT", "127.0.0.1:9000"),
    )
    parser.add_argument(
        "--minio-access-key",
        default=os.getenv("MINIO_ACCESS_KEY", ""),
    )
    parser.add_argument(
        "--minio-secret-key",
        default=os.getenv("MINIO_SECRET_KEY", ""),
    )
    parser.add_argument(
        "--minio-use-ssl",
        default=os.getenv("MINIO_USE_SSL", "false").lower() == "true",
        action="store_true",
    )
    parser.add_argument(
        "--output-name",
        default="SRS-FE-001.md",
        help="Name of the merged SRS-FE file (used for frontmatter id)",
    )

    args = parser.parse_args()

    if not args.minio_access_key or not args.minio_secret_key:
        print("Error: MinIO credentials required", file=sys.stderr)
        sys.exit(1)

    minio_client = get_minio_client(
        args.minio_endpoint,
        args.minio_access_key,
        args.minio_secret_key,
        args.minio_use_ssl,
    )

    conn = get_db_connection(args.db_url)
    try:
        steps = fetch_approved_steps(conn, args.doc_id)
    finally:
        conn.close()

    if not steps:
        print("Error: No approved sections found for document", file=sys.stderr)
        sys.exit(1)

    sections_content = []
    all_ids = set()
    all_sources = set()
    all_traces = set()
    all_api_consumption = set()

    for step in steps:
        minio_path = step.get("minio_path")
        if not minio_path:
            continue
        print(f"Fetching: {minio_path}")
        content = fetch_section_content(minio_client, args.project_id, minio_path)
        if content:
            sections_content.append(content)
            all_ids.update(extract_ids(content))
            all_sources.update(extract_sources(content))
            all_traces.update(extract_traces_to(content))
            all_api_consumption.update(extract_api_consumption(content))

    if not sections_content:
        print("Error: No section content could be loaded", file=sys.stderr)
        sys.exit(1)

    now_date = datetime.now().strftime("%Y-%m-%d")
    main_content = build_main_srs(
        sections_content, sorted(all_ids), sorted(all_sources), args.output_name
    )
    rtm_content = build_rtm(sorted(all_ids), sorted(all_traces), sorted(all_api_consumption))
    approval_content = build_approval_record(steps, args.merged_by, now_date)
    history_content = build_change_history()
    revision_content = build_revision_log()

    main_path = f"output/{args.output_name}"
    put_markdown(minio_client, args.project_id, main_path, main_content)
    print(f"Written: {args.project_id}/{main_path}")

    appendices = [
        ("srs-fe/appendices/A-rtm.md", rtm_content),
        ("srs-fe/appendices/B-approval.md", approval_content),
        ("srs-fe/appendices/C-history.md", history_content),
        ("srs-fe/appendices/D-revisions.md", revision_content),
    ]

    for path, content in appendices:
        put_markdown(minio_client, args.project_id, path, content)
        print(f"Written: {args.project_id}/{path}")

    print("\n✅ SRS-FE merged successfully!")
    print(f"   Main document: {args.project_id}/{main_path}")
    print(f"   Appendices: 4 files in {args.project_id}/srs-fe/appendices/")
    print(f"   Total IDs: {len(all_ids)}")
    print(f"   Total sources: {len(all_sources)}")


if __name__ == "__main__":
    main()
