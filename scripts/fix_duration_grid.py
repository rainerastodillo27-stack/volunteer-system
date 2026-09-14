"""
Fix Duration column width by properly integrating it into the table grid.

Root cause: Duration cell was appended to rows but no <w:gridCol> was added
to <w:tblGrid>, so Word squeezes it into leftover space (~0.24") causing
text to wrap vertically.

Fix:
  - Content width = page width - margins = 15830 twips (A4 landscape, 0.35" margins)
  - Duration column = 1584 twips (1.1")
  - Remaining 8 cols share: 15830 - 1584 = 14246 twips (~1780 twips / 1.24" each)
  - Add Duration gridCol and resize all cells properly

Run from repo root:
    python scripts/fix_duration_grid.py
"""

import shutil
from pathlib import Path
from docx import Document
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

DOCS_DIR = Path("docs/testings")

# Page content width (A4 landscape, 0.35" margins each side)
CONTENT_W_TWIPS = 15830

# Duration column target width
DUR_W_TWIPS = 1584  # 1.1"

# Other columns share the remaining width equally
OTHER_COLS = 8
OTHER_COL_W = (CONTENT_W_TWIPS - DUR_W_TWIPS) // OTHER_COLS  # 1780 twips each

WB_FILES = [
    DOCS_DIR / "Alpha_Whitebox_Test_Report.docx",
    DOCS_DIR / "Beta_Whitebox_Test_Report.docx",
]

COMPACT_MAP = {
    "Alpha_Whitebox_Test_Report.docx": "Alpha_Whitebox_Test_Report_Compact.docx",
    "Beta_Whitebox_Test_Report.docx":  "Beta_Whitebox_Test_Report_Compact.docx",
}
TNR_MAP = {
    "Alpha_Whitebox_Test_Report.docx": "Alpha_Whitebox_Test_Report_TimesNewRoman12.docx",
    "Beta_Whitebox_Test_Report.docx":  "Beta_Whitebox_Test_Report_TimesNewRoman12.docx",
}


def _is_test_table(table):
    if not table.rows:
        return False
    return table.rows[0].cells[0].text.strip().lower() in ("test id", "test case id")


def _duration_col_index(table):
    for i, cell in enumerate(table.rows[0].cells):
        if cell.text.strip().lower() == "duration":
            return i
    return -1


def fix_table_grid(table):
    """
    Rebuild tblGrid and all cell widths so Duration column is properly sized.
    """
    dur_idx = _duration_col_index(table)
    if dur_idx == -1:
        return False

    n_cols = len(table.rows[0].cells)
    if n_cols != 9:
        return False  # unexpected layout

    # Build new column widths list: [OtherCol x8, DurationCol]
    col_widths = [OTHER_COL_W] * OTHER_COLS + [DUR_W_TWIPS]

    tbl = table._tbl

    # ── 1. Rebuild tblGrid ──────────────────────────────────────────────────
    tblGrid = tbl.find(qn("w:tblGrid"))
    if tblGrid is not None:
        tbl.remove(tblGrid)

    new_tblGrid = OxmlElement("w:tblGrid")
    for w in col_widths:
        gc = OxmlElement("w:gridCol")
        gc.set(qn("w:w"), str(w))
        new_tblGrid.append(gc)

    # Insert tblGrid after tblPr
    tblPr = tbl.find(qn("w:tblPr"))
    if tblPr is not None:
        tblPr.addnext(new_tblGrid)
    else:
        tbl.insert(0, new_tblGrid)

    # ── 2. Set table-level width ────────────────────────────────────────────
    tblPr = tbl.find(qn("w:tblPr"))
    if tblPr is not None:
        tblW = tblPr.find(qn("w:tblW"))
        if tblW is None:
            tblW = OxmlElement("w:tblW")
            tblPr.append(tblW)
        tblW.set(qn("w:w"), str(CONTENT_W_TWIPS))
        tblW.set(qn("w:type"), "dxa")

    # ── 3. Update each cell's tcW ───────────────────────────────────────────
    for row in table.rows:
        for c_idx, cell in enumerate(row.cells):
            if c_idx >= len(col_widths):
                break
            tc = cell._tc
            tcPr = tc.get_or_add_tcPr()

            # Remove existing tcW
            for tcW in tcPr.findall(qn("w:tcW")):
                tcPr.remove(tcW)

            new_tcW = OxmlElement("w:tcW")
            new_tcW.set(qn("w:w"), str(col_widths[c_idx]))
            new_tcW.set(qn("w:type"), "dxa")
            tcPr.append(new_tcW)

    return True


def process_file(path: Path):
    print(f"\n[{path.name}]")
    print(f"  Other col width: {OTHER_COL_W} twips = {OTHER_COL_W/1440:.2f}\"")
    print(f"  Duration width:  {DUR_W_TWIPS} twips = {DUR_W_TWIPS/1440:.2f}\"")
    print(f"  Total:           {OTHER_COL_W * OTHER_COLS + DUR_W_TWIPS} twips = {(OTHER_COL_W * OTHER_COLS + DUR_W_TWIPS)/1440:.2f}\"")

    doc = Document(str(path))
    fixed = 0
    for table in doc.tables:
        if _is_test_table(table):
            if fix_table_grid(table):
                fixed += 1
    doc.save(str(path))
    print(f"  Fixed {fixed} tables")


def sync_variants(src: Path):
    name = src.name
    for mapping in (COMPACT_MAP, TNR_MAP):
        dst_name = mapping.get(name)
        if dst_name:
            shutil.copy2(str(src), str(DOCS_DIR / dst_name))
            print(f"  Synced -> {dst_name}")


def main():
    print("=" * 60)
    print("  Fix Duration Column Grid (A4 Landscape, 0.35\" margins)")
    print("=" * 60)
    for path in WB_FILES:
        process_file(path)
        sync_variants(path)
    print("\n" + "=" * 60)
    print("  Done!")
    print("=" * 60)


if __name__ == "__main__":
    main()
