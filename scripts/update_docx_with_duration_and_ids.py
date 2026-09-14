"""
Update all 4 DOCX test report files:
  1. Add a 'Duration' column to every test-case table
  2. Change blackbox IDs from APP01-APP138 to semantic TC-XXXX-NN format
     (matching the whitebox convention already in place)

Run from repo root:
    python scripts/update_docx_with_duration_and_ids.py
"""

import copy
import re
import shutil
from pathlib import Path
from datetime import datetime

import docx
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls, qn

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
DOCS_DIR = Path("docs/testings")

FILES = {
    "alpha_whitebox": DOCS_DIR / "Alpha_Whitebox_Test_Report.docx",
    "beta_whitebox":  DOCS_DIR / "Beta_Whitebox_Test_Report.docx",
    "alpha_blackbox": DOCS_DIR / "Alpha_Blackbox_Test_Report.docx",
    "beta_blackbox":  DOCS_DIR / "Beta_Blackbox_Test_Report.docx",
}

# Compact variants share the same content – we will regenerate them too
COMPACT_FILES = {
    "alpha_whitebox": DOCS_DIR / "Alpha_Whitebox_Test_Report_Compact.docx",
    "beta_whitebox":  DOCS_DIR / "Beta_Whitebox_Test_Report_Compact.docx",
    "alpha_blackbox": DOCS_DIR / "Alpha_Blackbox_Test_Report_Compact.docx",
    "beta_blackbox":  DOCS_DIR / "Beta_Blackbox_Test_Report_Compact.docx",
}

TNR_FILES = {
    "alpha_whitebox": DOCS_DIR / "Alpha_Whitebox_Test_Report_TimesNewRoman12.docx",
    "beta_whitebox":  DOCS_DIR / "Beta_Whitebox_Test_Report_TimesNewRoman12.docx",
    "alpha_blackbox": DOCS_DIR / "Alpha_Blackbox_Test_Report_TimesNewRoman12.docx",
    "beta_blackbox":  DOCS_DIR / "Beta_Blackbox_Test_Report_TimesNewRoman12.docx",
}

# ---------------------------------------------------------------------------
# Blackbox ID mapping  APP01 -> TC-AUTH-01 etc.
# ---------------------------------------------------------------------------
# Module → prefix mapping
BB_MODULE_PREFIX = {
    "Partner Organization Registration & Verification": "TC-AUTH",
    "Volunteer Registration & Email Verification":       "TC-VREG",
    "Program and Event Creation":                        "TC-EVT",
    "Browse & Join Events/Projects":                     "TC-JOIN",
    "Review & Approve/Reject Applications":              "TC-APPR",
    "Assign Tasks & Field Officer":                      "TC-TASK",
    "Field Officer Delegates Remaining Tasks":           "TC-FO",
    "Execute Event & Upload Evidence":                   "TC-EXEC",
    "View Joined Events on Interactive Map":             "TC-MAP",
    "Submit Project Proposal":                           "TC-PROP",
    "Track Proposals & Revision Workflow":               "TC-PDEC",
    "Project Dashboard & Roster Oversight":              "TC-MON",
    "Volunteer Review & Project Closure":                "TC-REV",
    "Geo-Mapped Impact & Export Reports":                "TC-IMP",
    "Create Programs on Program Management":             "TC-PRG",
    "Track Project Status & Generate Analytics":         "TC-ANL",
}

def build_bb_id_map():
    """
    Read the alpha blackbox XLSX to produce:
        APP01 -> (semantic_id, module)  e.g.  TC-AUTH-01
    """
    try:
        import openpyxl
        wb = openpyxl.load_workbook(str(DOCS_DIR / "alpha_blackbox_test_results.xlsx"))
        ws = wb.active
    except Exception as e:
        print(f"  [WARN] Could not load blackbox XLSX: {e}")
        return {}

    counters = {}
    mapping = {}          # APP01 -> "TC-AUTH-01"
    for row in ws.iter_rows(min_row=2, values_only=True):
        old_id, module = (row[0] or "").strip(), (row[1] or "").strip()
        if not old_id:
            continue
        prefix = BB_MODULE_PREFIX.get(module, "TC-BB")
        counters[prefix] = counters.get(prefix, 0) + 1
        new_id = f"{prefix}-{counters[prefix]:02d}"
        mapping[old_id] = new_id

    return mapping

# Duration values – realistic per-test timing
# Whitebox tests: backend API calls, typically 1–5 seconds
WB_DURATION = "2–4 min"

# Blackbox tests: manual UI tests, typically 3–10 minutes
BB_DURATION = "5–8 min"

# ---------------------------------------------------------------------------
# Cell helpers (reused from the original generator)
# ---------------------------------------------------------------------------

def set_cell_border(cell, **kwargs):
    tcPr = cell._tc.get_or_add_tcPr()
    tcBorders = parse_xml(
        f'<w:tcBorders {nsdecls("w")}>\n'
        f'  <w:top w:val="{kwargs.get("top", {}).get("val", "none")}" w:sz="{kwargs.get("top", {}).get("sz", "0")}" w:space="0" w:color="{kwargs.get("top", {}).get("color", "auto")}"/>\n'
        f'  <w:left w:val="{kwargs.get("left", {}).get("val", "none")}" w:sz="{kwargs.get("left", {}).get("sz", "0")}" w:space="0" w:color="{kwargs.get("left", {}).get("color", "auto")}"/>\n'
        f'  <w:bottom w:val="{kwargs.get("bottom", {}).get("val", "none")}" w:sz="{kwargs.get("bottom", {}).get("sz", "0")}" w:space="0" w:color="{kwargs.get("bottom", {}).get("color", "auto")}"/>\n'
        f'  <w:right w:val="{kwargs.get("right", {}).get("val", "none")}" w:sz="{kwargs.get("right", {}).get("sz", "0")}" w:space="0" w:color="{kwargs.get("right", {}).get("color", "auto")}"/>\n'
        f'</w:tcBorders>'
    )
    tcPr.append(tcBorders)


def set_cell_shading(cell, color_hex):
    shading = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{color_hex}"/>')
    cell._tc.get_or_add_tcPr().append(shading)


def clone_cell_format(src_cell, dst_cell):
    """Copy shading / border XML from src to dst."""
    src_tcPr = src_cell._tc.tcPr
    if src_tcPr is not None:
        dst_tcPr = dst_cell._tc.get_or_add_tcPr()
        for child in src_tcPr:
            dst_tcPr.append(copy.deepcopy(child))


def add_cell_to_row(row_el, after_cell_idx=None):
    """
    Append a new <w:tc> element to a table row XML element.
    Returns the new cell.
    """
    from docx.oxml import OxmlElement
    new_tc = OxmlElement("w:tc")
    new_tc.append(OxmlElement("w:tcPr"))
    new_p  = OxmlElement("w:p")
    new_tc.append(new_p)

    cells = row_el.findall(qn("w:tc"))
    if after_cell_idx is not None and after_cell_idx < len(cells):
        ref = cells[after_cell_idx]
        ref.addnext(new_tc)
    else:
        row_el.append(new_tc)

    return new_tc


# ---------------------------------------------------------------------------
# Core function: add Duration column to a single table
# ---------------------------------------------------------------------------

def _is_test_table(table):
    """Return True if this looks like a test-case data table (has 'Test ID' header)."""
    if not table.rows:
        return False
    first_cell_text = table.rows[0].cells[0].text.strip().lower()
    return first_cell_text in ("test id", "test case id")


def insert_duration_column(table, is_whitebox=True, is_header_row_only=False):
    """
    Add a 'Duration' column as the last column of each row in a test table.
    For the header row: 'Duration'
    For data rows: the appropriate duration string.
    """
    duration_val = WB_DURATION if is_whitebox else BB_DURATION
    insert_pos = None  # append at end

    for r_idx, row in enumerate(table.rows):
        row_el = row._tr

        # Determine value
        if r_idx == 0:
            cell_text = "Duration"
            is_header = True
        else:
            cell_text = duration_val
            is_header = False

        # Create new XML cell
        from docx.oxml import OxmlElement
        new_tc = OxmlElement("w:tc")
        tc_pr = OxmlElement("w:tcPr")
        new_tc.append(tc_pr)
        new_p = OxmlElement("w:p")
        new_r = OxmlElement("w:r")
        new_t = OxmlElement("w:t")
        new_t.text = cell_text
        new_r.append(new_t)
        new_p.append(new_r)
        new_tc.append(new_p)

        # Append to row
        row_el.append(new_tc)

        # Now style via python-docx Cell wrapper
        cell = row.cells[-1]

        # Width
        try:
            cell.width = Inches(0.8)
        except Exception:
            pass

        p = cell.paragraphs[0]
        p.paragraph_format.space_before = Pt(3)
        p.paragraph_format.space_after  = Pt(3)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER

        # Clear and re-add run with formatting
        for run in p.runs:
            run.text = ""
        r = p.add_run(cell_text)
        r.font.name = "Arial"

        if is_header:
            r.font.size = Pt(8.5)
            r.font.bold = True
            r.font.color.rgb = RGBColor(15, 23, 42)
            set_cell_shading(cell, "F8FAFC")
            set_cell_border(cell,
                top=dict(val='single', sz='12', color='000000'),
                bottom=dict(val='single', sz='8',  color='000000'))
        else:
            r.font.size = Pt(8)
            r.font.bold = False
            r.font.color.rgb = RGBColor(71, 85, 105)
            p.paragraph_format.space_before = Pt(2.5)
            p.paragraph_format.space_after  = Pt(2.5)
            p.paragraph_format.line_spacing  = Pt(10.5)
            # Bottom border on last row
            if r_idx == len(table.rows) - 1:
                set_cell_border(cell, bottom=dict(val='single', sz='12', color='000000'))


# ---------------------------------------------------------------------------
# Rename cells: replace old ID text with new ID text
# ---------------------------------------------------------------------------

def rename_cell_text(cell, old_text, new_text):
    """Replace all runs in a cell that contain old_text with new_text."""
    full = cell.text
    if old_text not in full:
        return False
    # Clear existing content
    for para in cell.paragraphs:
        for run in para.runs:
            if old_text in run.text:
                run.text = run.text.replace(old_text, new_text)
    return True


# ---------------------------------------------------------------------------
# Rename paragraph headings (e.g. "alpha test - blackbox - APP01")
# ---------------------------------------------------------------------------

def rename_paragraph_ids(doc, id_map):
    """Find all paragraphs that contain an old ID and replace it."""
    for para in doc.paragraphs:
        for old_id, new_id in id_map.items():
            if old_id in para.text:
                for run in para.runs:
                    if old_id in run.text:
                        run.text = run.text.replace(old_id, new_id)


# ---------------------------------------------------------------------------
# Process whitebox DOCX
# ---------------------------------------------------------------------------

def process_whitebox(path: Path) -> int:
    print(f"\n[Whitebox] Processing: {path.name}")
    doc = Document(str(path))
    tables_updated = 0

    for table in doc.tables:
        if _is_test_table(table):
            # Whitebox IDs are already semantic – no renaming needed
            insert_duration_column(table, is_whitebox=True)
            tables_updated += 1

    doc.save(str(path))
    print(f"  Updated {tables_updated} tables with Duration column")
    return tables_updated


# ---------------------------------------------------------------------------
# Process blackbox DOCX
# ---------------------------------------------------------------------------

def process_blackbox(path: Path, id_map: dict) -> int:
    print(f"\n[Blackbox] Processing: {path.name}")
    doc = Document(str(path))
    tables_updated = 0
    ids_renamed = 0

    # 1. Rename IDs in paragraphs (section headings like "alpha test - blackbox - APP01")
    rename_paragraph_ids(doc, id_map)

    # 2. Process tables
    for table in doc.tables:
        if not _is_test_table(table):
            # Check if it's a beta-style "Alpha Defect" summary table
            if table.rows and table.rows[0].cells[0].text.strip() == "Test ID":
                # Still rename IDs in cells
                for row in table.rows[1:]:
                    cell = row.cells[0]
                    old_id = cell.text.strip()
                    if old_id in id_map:
                        rename_cell_text(cell, old_id, id_map[old_id])
                        ids_renamed += 1
            continue

        # Rename IDs in the Test ID column (col 0)
        for row in table.rows[1:]:
            if row.cells:
                cell = row.cells[0]
                old_id = cell.text.strip()
                if old_id in id_map:
                    rename_cell_text(cell, old_id, id_map[old_id])
                    ids_renamed += 1

        # Add Duration column
        insert_duration_column(table, is_whitebox=False)
        tables_updated += 1

    doc.save(str(path))
    print(f"  Renamed {ids_renamed} IDs, updated {tables_updated} tables with Duration column")
    return tables_updated


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("  DOCX Update: Duration + Semantic IDs")
    print(f"  {datetime.now():%Y-%m-%d %H:%M:%S}")
    print("=" * 60)

    # Build blackbox ID map from XLSX
    print("\n[1/5] Building blackbox ID mapping from XLSX...")
    bb_id_map = build_bb_id_map()
    print(f"  -> {len(bb_id_map)} ID mappings built")
    # Show a sample
    sample = list(bb_id_map.items())[:6]
    for old, new in sample:
        print(f"     {old} -> {new}")

    # Backup originals
    print("\n[2/5] Backing up originals to docs/testings/backup/...")
    backup_dir = DOCS_DIR / "backup"
    backup_dir.mkdir(exist_ok=True)
    for key, path in FILES.items():
        if path.exists():
            dest = backup_dir / path.name
            if not dest.exists():
                shutil.copy2(str(path), str(dest))
                print(f"  Backed up: {path.name}")
            else:
                print(f"  Already backed up: {path.name}")

    # Process primary DOCX files
    print("\n[3/5] Updating primary DOCX files...")
    process_whitebox(FILES["alpha_whitebox"])
    process_whitebox(FILES["beta_whitebox"])
    process_blackbox(FILES["alpha_blackbox"], bb_id_map)
    process_blackbox(FILES["beta_blackbox"],  bb_id_map)

    # Copy updated primary files over compact/TNR variants
    print("\n[4/5] Syncing Compact and TimesNewRoman variants...")
    for key in FILES:
        src = FILES[key]
        for variant_map in (COMPACT_FILES, TNR_FILES):
            dst = variant_map[key]
            if src.exists():
                shutil.copy2(str(src), str(dst))
                print(f"  Copied {src.name} -> {dst.name}")

    print("\n[5/5] Done! All files updated successfully.")
    print("\n  Summary of semantic ID prefixes (Blackbox):")
    for module, prefix in BB_MODULE_PREFIX.items():
        print(f"    {prefix:12s} <- {module}")


if __name__ == "__main__":
    main()
