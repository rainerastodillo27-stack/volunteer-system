"""Generate a live, value-safe PostgreSQL data dictionary as HTML."""

from __future__ import annotations

import argparse
import html
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from psycopg import sql
from psycopg.rows import dict_row

from .db import get_postgres_connection


TABLE_PURPOSES = {
    "admin_planning_calendars": "Admin planning lanes with their planning entries embedded in planning_items.",
    "event_email_reminders": "Operational record of event reminder emails already scheduled or sent.",
    "events": "Volunteer events connected to programs/projects, including venue, capacity, skills, and tasks.",
    "messages": "Direct messages between system users.",
    "partner_project_applications": "Partner proposals and their administrative review history.",
    "partners": "Registered partner organizations and accreditation/contact information.",
    "programs": "Canonical catalog of top-level NVC programs; this replaces the former program_tracks table.",
    "project_group_messages": "Project-scoped group conversation and proposal-response messages.",
    "projects": "Projects and proposal-created initiatives under programs.",
    "reports": "Canonical table for submitted and published reports, distinguished by generated_at.",
    "skills": "Derived searchable skill directory built from volunteers, projects, events, and tasks.",
    "status_updates": "Chronological project or event status history.",
    "tasks": "Derived task directory built from internal project/event tasks.",
    "users": "Authentication accounts, roles, approval state, and normalized contact information.",
    "volunteer_event_joins": "Volunteer membership and participation state for events/projects.",
    "volunteer_matches": "Administrative volunteer-to-project matching decisions.",
    "volunteer_time_logs": "Attendance, time-in/out, completion evidence, and completion reports.",
    "volunteers": "Volunteer profiles, skills, availability, background, and registration review state.",
}

KEY_LABELS = {"p": "PK", "f": "FK", "u": "UNIQUE", "c": "CHECK", "x": "EXCLUDE"}


def _display_type(column: dict[str, Any]) -> str:
    data_type = str(column["data_type"])
    udt_name = str(column["udt_name"])
    if data_type == "ARRAY":
        return f"{udt_name.removeprefix('_')}[]"
    if data_type == "USER-DEFINED":
        return udt_name
    return data_type


def _column_description(column_name: str) -> str:
    specific = {
        "id": "Stable record identifier.",
        "email": "Normalized lowercase email address.",
        "phone": "Canonical Philippine mobile number: exactly 11 digits in 09XXXXXXXXX format.",
        "contact_phone": "Canonical partner Philippine mobile number: exactly 11 digits in 09XXXXXXXXX format.",
        "contact_email": "Normalized lowercase partner contact email.",
        "password": "Bcrypt account password hash; never exposed to clients.",
        "planning_items": "JSON array of planning entries owned by this calendar.",
        "generated_at": "When populated, identifies a generated/published report.",
        "internal_tasks": "JSON array of tasks owned by the project/event.",
        "notification_settings": "JSON array of configured event notification rules.",
        "location": "Serialized structured location information.",
        "attachments": "Serialized attachment metadata.",
        "metrics": "Serialized report measurement values.",
    }
    if column_name in specific:
        return specific[column_name]
    if column_name.endswith("_id"):
        return f"Identifier linking this record to {column_name[:-3].replace('_', ' ')}."
    if column_name.endswith("_at"):
        return f"Recorded date/time for {column_name[:-3].replace('_', ' ')}."
    if column_name.startswith("is_"):
        return f"Boolean flag indicating {column_name[3:].replace('_', ' ')}."
    return column_name.replace("_", " ").capitalize() + "."


def _load_schema(connection: Any) -> tuple[list[str], dict[str, list[dict[str, Any]]]]:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            select table_name, column_name, ordinal_position, column_default,
                   is_nullable, data_type, udt_name, character_maximum_length,
                   numeric_precision, numeric_scale
            from information_schema.columns
            where table_schema = 'public'
            order by table_name, ordinal_position
            """
        )
        by_table: dict[str, list[dict[str, Any]]] = {}
        for row in cursor.fetchall():
            by_table.setdefault(str(row["table_name"]), []).append(dict(row))
    return sorted(by_table), by_table


def _load_constraints(connection: Any) -> dict[str, list[dict[str, str]]]:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            select c.conrelid::regclass::text as table_name,
                   c.conname as constraint_name,
                   c.contype::text as constraint_type,
                   pg_get_constraintdef(c.oid) as definition
            from pg_constraint c
            where c.connamespace = 'public'::regnamespace
            order by c.conrelid::regclass::text, c.conname
            """
        )
        result: dict[str, list[dict[str, str]]] = {}
        for row in cursor.fetchall():
            result.setdefault(str(row["table_name"]), []).append(
                {
                    "name": str(row["constraint_name"]),
                    "type": KEY_LABELS.get(str(row["constraint_type"]), str(row["constraint_type"])),
                    "definition": str(row["definition"]),
                }
            )
        return result


def _load_indexes(connection: Any) -> dict[str, list[dict[str, str]]]:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            select tablename, indexname, indexdef
            from pg_indexes
            where schemaname = 'public'
            order by tablename, indexname
            """
        )
        result: dict[str, list[dict[str, str]]] = {}
        for row in cursor.fetchall():
            result.setdefault(str(row["tablename"]), []).append(
                {"name": str(row["indexname"]), "definition": str(row["indexdef"])}
            )
        return result


def _column_keys(constraints: list[dict[str, str]], column_name: str) -> str:
    keys: list[str] = []
    marker = f"({column_name})"
    for constraint in constraints:
        if constraint["type"] in {"PK", "FK", "UNIQUE"} and marker in constraint["definition"]:
            keys.append(constraint["type"])
    return ", ".join(keys) or "—"


def _load_observed_stats(
    connection: Any, table_name: str, columns: list[dict[str, Any]]
) -> tuple[int, dict[str, dict[str, Any]]]:
    expressions: list[sql.Composable] = [sql.SQL("count(*) as row_count")]
    aliases: list[tuple[str, str]] = []
    for index, column in enumerate(columns):
        identifier = sql.Identifier(str(column["column_name"]))
        non_null_alias = f"c{index}_nonnull"
        expressions.append(sql.SQL("count({}) as {}").format(identifier, sql.Identifier(non_null_alias)))
        aliases.append((str(column["column_name"]), non_null_alias))
        data_type = str(column["data_type"])
        if data_type in {"text", "character varying", "character", "json", "jsonb"}:
            metric_alias = f"c{index}_maxchars"
            expressions.append(
                sql.SQL("coalesce(max(length({}::text)), 0) as {}").format(identifier, sql.Identifier(metric_alias))
            )
        elif data_type == "ARRAY":
            metric_alias = f"c{index}_maxitems"
            expressions.append(
                sql.SQL("coalesce(max(cardinality({})), 0) as {}").format(identifier, sql.Identifier(metric_alias))
            )
        elif data_type in {"smallint", "integer", "bigint", "numeric", "decimal", "real", "double precision"}:
            min_alias = f"c{index}_min"
            max_alias = f"c{index}_max"
            expressions.append(sql.SQL("min({}) as {}").format(identifier, sql.Identifier(min_alias)))
            expressions.append(sql.SQL("max({}) as {}").format(identifier, sql.Identifier(max_alias)))
        elif data_type == "boolean":
            metric_alias = f"c{index}_true"
            expressions.append(
                sql.SQL("count(*) filter (where {} is true) as {}").format(identifier, sql.Identifier(metric_alias))
            )

    query = sql.SQL("select {} from {}").format(sql.SQL(", ").join(expressions), sql.Identifier(table_name))
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(query)
        aggregate = dict(cursor.fetchone())

    row_count = int(aggregate["row_count"])
    stats: dict[str, dict[str, Any]] = {}
    for index, (column_name, non_null_alias) in enumerate(aliases):
        column = columns[index]
        non_null = int(aggregate[non_null_alias])
        item: dict[str, Any] = {"non_null": non_null, "nulls": row_count - non_null}
        data_type = str(column["data_type"])
        if data_type in {"text", "character varying", "character", "json", "jsonb"}:
            item["observed"] = f"{int(aggregate[f'c{index}_maxchars'])} chars"
        elif data_type == "ARRAY":
            item["observed"] = f"{int(aggregate[f'c{index}_maxitems'])} items"
        elif data_type in {"smallint", "integer", "bigint", "numeric", "decimal", "real", "double precision"}:
            minimum = aggregate[f"c{index}_min"]
            maximum = aggregate[f"c{index}_max"]
            item["observed"] = "—" if minimum is None else f"{minimum} to {maximum}"
        elif data_type == "boolean":
            item["observed"] = f"{int(aggregate[f'c{index}_true'])} true"
        else:
            item["observed"] = "—"
        stats[column_name] = item
    return row_count, stats


def _escape(value: Any) -> str:
    return html.escape("—" if value in (None, "") else str(value))


def _render_html(
    database_name: str,
    generated_at: str,
    tables: list[str],
    columns_by_table: dict[str, list[dict[str, Any]]],
    constraints_by_table: dict[str, list[dict[str, str]]],
    indexes_by_table: dict[str, list[dict[str, str]]],
    stats_by_table: dict[str, tuple[int, dict[str, dict[str, Any]]]],
) -> str:
    total_columns = sum(len(columns) for columns in columns_by_table.values())
    sections: list[str] = []
    for table_number, table_name in enumerate(tables, start=1):
        columns = columns_by_table[table_name]
        constraints = constraints_by_table.get(table_name, [])
        indexes = indexes_by_table.get(table_name, [])
        row_count, column_stats = stats_by_table[table_name]
        rows: list[str] = []
        for column in columns:
            column_name = str(column["column_name"])
            stat = column_stats[column_name]
            default = column.get("column_default")
            if default and len(str(default)) > 60:
                default = str(default)[:57] + "..."
            rows.append(
                "<tr>"
                f"<td class='mono'>{_escape(column_name)}</td>"
                f"<td>{_escape(_display_type(column))}</td>"
                f"<td>{'Yes' if column['is_nullable'] == 'YES' else 'No'}</td>"
                f"<td>{_escape(_column_keys(constraints, column_name))}</td>"
                f"<td class='num'>{stat['non_null']}</td>"
                f"<td class='num'>{stat['nulls']}</td>"
                f"<td class='observed'>{_escape(stat['observed'])}</td>"
                f"<td class='mono small'>{_escape(default)}</td>"
                f"<td>{_escape(_column_description(column_name))}</td>"
                "</tr>"
            )

        constraint_rows = "".join(
            f"<tr><td class='mono'>{_escape(item['name'])}</td><td>{_escape(item['type'])}</td>"
            f"<td class='mono small'>{_escape(item['definition'])}</td></tr>"
            for item in constraints
        ) or "<tr><td colspan='3'>No database constraints declared.</td></tr>"
        index_rows = "".join(
            f"<tr><td class='mono'>{_escape(item['name'])}</td>"
            f"<td class='mono small'>{_escape(item['definition'])}</td></tr>"
            for item in indexes
        ) or "<tr><td colspan='2'>No indexes declared.</td></tr>"
        sections.append(
            f"""
            <section class="table-section">
              <div class="section-heading">
                <div><span class="table-number">{table_number:02d}</span><h2>{_escape(table_name)}</h2></div>
                <div class="row-count">{row_count:,} current row{'s' if row_count != 1 else ''}</div>
              </div>
              <p class="purpose">{_escape(TABLE_PURPOSES.get(table_name, 'Operational application table.'))}</p>
              <h3>Columns and observed data profile</h3>
              <table>
                <thead><tr><th>Column</th><th>DB type</th><th>Nullable</th><th>Key</th><th>Used</th><th>Null</th><th>Actual observed size/range</th><th>Default</th><th>Meaning</th></tr></thead>
                <tbody>{''.join(rows)}</tbody>
              </table>
              <div class="two-column">
                <div><h3>Constraints</h3><table><thead><tr><th>Name</th><th>Type</th><th>Definition</th></tr></thead><tbody>{constraint_rows}</tbody></table></div>
                <div><h3>Indexes</h3><table><thead><tr><th>Name</th><th>Definition</th></tr></thead><tbody>{index_rows}</tbody></table></div>
              </div>
            </section>
            """
        )

    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>NVC Volunteer System — Live Database Data Dictionary</title>
<style>
@page {{ size: A4 landscape; margin: 10mm; }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; color: #14231b; font-family: Arial, Helvetica, sans-serif; font-size: 8px; line-height: 1.35; }}
.cover {{ min-height: 180mm; padding: 22mm 18mm; background: linear-gradient(135deg,#0f5132,#16794a 60%,#d9a928); color: white; page-break-after: always; }}
.eyebrow {{ text-transform: uppercase; letter-spacing: 2px; font-size: 10px; font-weight: 700; opacity: .82; }}
.cover h1 {{ margin: 14mm 0 4mm; max-width: 190mm; font-size: 34px; line-height: 1.02; }}
.cover .subtitle {{ max-width: 185mm; font-size: 14px; opacity: .92; }}
.summary {{ display: flex; gap: 10px; margin-top: 18mm; }}
.summary div {{ min-width: 42mm; padding: 5mm; border: 1px solid rgba(255,255,255,.35); border-radius: 8px; background: rgba(255,255,255,.10); }}
.summary strong {{ display:block; font-size: 22px; }}
.method {{ margin-top: 14mm; max-width: 210mm; padding: 5mm; border-left: 4px solid #ffd65a; background: rgba(0,0,0,.12); }}
.table-section {{ page-break-before: always; }}
.section-heading {{ display:flex; justify-content:space-between; align-items:center; border-bottom: 2px solid #16794a; padding-bottom: 4px; }}
.section-heading > div:first-child {{ display:flex; align-items:center; gap:8px; }}
.table-number {{ display:inline-flex; width:24px; height:24px; align-items:center; justify-content:center; background:#16794a; color:white; border-radius:5px; font-weight:bold; }}
h2 {{ display:inline; font-size: 18px; color:#0f5132; }}
h3 {{ margin: 10px 0 4px; color:#0f5132; font-size: 10px; text-transform:uppercase; letter-spacing:.5px; }}
.row-count {{ padding:4px 8px; border-radius:12px; background:#e7f4ec; color:#0f5132; font-weight:bold; }}
.purpose {{ margin: 5px 0 8px; font-size: 9px; }}
table {{ width:100%; border-collapse:collapse; table-layout:auto; }}
th {{ background:#e7f4ec; color:#0f5132; text-align:left; font-size:7px; text-transform:uppercase; letter-spacing:.2px; }}
th, td {{ border:1px solid #cad8cf; padding:3px 4px; vertical-align:top; overflow-wrap:anywhere; }}
tr:nth-child(even) td {{ background:#f7faf8; }}
.mono {{ font-family:Consolas, 'Courier New', monospace; }} .small {{ font-size:7px; }} .num {{ text-align:right; }}
.observed {{ font-weight:700; color:#8a5a00; white-space:nowrap; }}
.two-column {{ display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:4px; }}
.footer-note {{ color:#53645a; font-size:7px; }}
</style></head><body>
<section class="cover">
  <div class="eyebrow">Negrense Volunteers for Change</div>
  <h1>Live Database<br>Data Dictionary</h1>
  <p class="subtitle">PostgreSQL schema, constraints, indexes, and observed field sizes for the Volunteer System.</p>
  <div class="summary"><div><strong>{len(tables)}</strong>tables</div><div><strong>{total_columns}</strong>columns</div><div><strong>{_escape(database_name)}</strong>database</div></div>
  <div class="method"><strong>Length methodology</strong><br>
  “Actual observed size” is calculated from the live records at generation time. Text values show the longest stored character count; arrays show the largest item count; numeric fields show the observed minimum-to-maximum range. Empty columns show 0 characters/items or an em dash. No record values, passwords, emails, phone numbers, images, or other personal data are included.</div>
  <p style="margin-top:14mm">Generated {html.escape(generated_at)} (UTC)</p>
</section>
{''.join(sections)}
</body></html>"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="docs/database-data-dictionary.html")
    args = parser.parse_args()
    output_path = Path(args.output).resolve()

    with get_postgres_connection() as connection:
        tables, columns_by_table = _load_schema(connection)
        constraints = _load_constraints(connection)
        indexes = _load_indexes(connection)
        stats = {
            table: _load_observed_stats(connection, table, columns_by_table[table])
            for table in tables
        }
        with connection.cursor() as cursor:
            cursor.execute("select current_database()")
            database_name = str(cursor.fetchone()[0])

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    document = _render_html(
        database_name, generated_at, tables, columns_by_table, constraints, indexes, stats
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(document, encoding="utf-8")
    print(f"[OK] tables documented: {len(tables)}")
    print(f"[OK] columns documented: {sum(len(items) for items in columns_by_table.values())}")
    print(f"[OK] HTML: {output_path}")


if __name__ == "__main__":
    main()
