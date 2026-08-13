#!/usr/bin/env python3
"""
AetherSpec — Shared Markdown Table Parser

Provides robust parsing of markdown tables with header mapping.
Used by merge scripts and backlog generator.
"""

import re


def _split_cells(line):
    """Split a markdown table row into cells, handling leading/trailing pipes."""
    cells = [c.strip() for c in line.split("|")]
    # Remove empty cells caused by leading/trailing pipes.
    if cells and cells[0] == "":
        cells = cells[1:]
    if cells and cells[-1] == "":
        cells = cells[:-1]
    return cells


def parse_markdown_tables(content):
    """
    Parse all markdown tables in `content`.

    Returns a list of dicts:
        [
            {
                "headers": ["ID", "Requirement", "Priority", ...],
                "rows": [
                    ["SR-BE-01", "...", "Must Have", ...],
                    ...
                ],
            },
            ...
        ]
    """
    if not content:
        return []

    tables = []
    lines = content.split("\n")
    i = 0

    while i < len(lines):
        line = lines[i].strip()
        if "|" in line and "---" not in line:
            headers = _split_cells(line)
            # Next line should be separator.
            if i + 1 < len(lines) and re.match(r"^\|?\s*-+[-|:\s]*-+\s*\|?$", lines[i + 1].strip()):
                i += 2
                rows = []
                while i < len(lines):
                    row_line = lines[i].strip()
                    if "|" in row_line and "---" not in row_line:
                        rows.append(_split_cells(row_line))
                        i += 1
                    else:
                        break
                tables.append({"headers": headers, "rows": rows})
                continue
        i += 1

    return tables


def find_rows_by_id_prefix(tables, id_prefixes, column_map=None):
    """
    Find all rows whose ID cell starts with one of the given prefixes.

    Args:
        tables: list of parsed tables from parse_markdown_tables()
        id_prefixes: list of ID prefixes (e.g., ["SR-BE", "NFR-BE"])
        column_map: optional dict mapping canonical column names to indices;
                      if None, it is auto-detected from headers.

    Returns a list of dicts with keys mapped from canonical column names.
    """
    results = []

    for table in tables:
        headers = [h.strip().lower() for h in table["headers"]]
        rows = table["rows"]

        # Auto-detect column indices if not provided.
        col_idx = column_map or {
            "id": _find_column_index(headers, ["id"]),
            "requirement": _find_column_index(headers, ["requirement", "description"]),
            "priority": _find_column_index(headers, ["priority"]),
            "traces_to": _find_column_index(headers, ["traces to", "traces", "trace"]),
            "source": _find_column_index(headers, ["source", "source section"]),
        }

        id_col = col_idx.get("id", -1)
        if id_col < 0:
            continue

        for row in rows:
            if id_col >= len(row):
                continue
            id_value = row[id_col].strip()
            for prefix in id_prefixes:
                # Match prefix at start, then a dash and digits.
                if re.match(rf"^{re.escape(prefix)}-\d+\b", id_value):
                    item = {
                        "id": id_value,
                        "table_headers": table["headers"],
                        "raw_row": row,
                    }
                    for key, idx in col_idx.items():
                        if 0 <= idx < len(row):
                            item[key] = row[idx].strip()
                        else:
                            item[key] = ""
                    results.append(item)
                    break

    return results


def _find_column_index(headers, candidates):
    """Return the index of the first header matching any candidate substring."""
    for candidate in candidates:
        for i, h in enumerate(headers):
            if candidate in h:
                return i
    return -1
