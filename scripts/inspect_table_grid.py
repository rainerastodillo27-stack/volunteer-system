"""Check page size and margins, plus full table column situation."""
from pathlib import Path
from docx import Document
from docx.oxml.ns import qn

doc = Document("docs/testings/Alpha_Whitebox_Test_Report.docx")

# 1. Page setup
for section in doc.sections:
    pw = section.page_width.twips if section.page_width else 0
    ph = section.page_height.twips if section.page_height else 0
    lm = section.left_margin.twips if section.left_margin else 0
    rm = section.right_margin.twips if section.right_margin else 0
    content_w = pw - lm - rm
    print(f"Page: {pw/1440:.2f}\" x {ph/1440:.2f}\"")
    print(f"Margins: L={lm/1440:.2f}\"  R={rm/1440:.2f}\"")
    print(f"Content width: {content_w} twips = {content_w/1440:.2f}\"")
    print()

# 2. Check table-level width setting (tblPr/tblW)
for t_idx, table in enumerate(doc.tables):
    if not table.rows:
        continue
    if table.rows[0].cells[0].text.strip().lower() not in ("test id", "test case id"):
        continue

    tbl = table._tbl
    tblPr = tbl.find(qn("w:tblPr"))
    if tblPr is not None:
        tblW = tblPr.find(qn("w:tblW"))
        if tblW is not None:
            print(f"Table {t_idx} tblW: w={tblW.get(qn('w:w'))} type={tblW.get(qn('w:type'))}")
        tblLayout = tblPr.find(qn("w:tblLayout"))
        if tblLayout is not None:
            print(f"Table {t_idx} tblLayout: type={tblLayout.get(qn('w:type'))}")

    # Count actual cells in row vs gridCols
    tblGrid = tbl.find(qn("w:tblGrid"))
    grid_cols = len(tblGrid.findall(qn("w:gridCol"))) if tblGrid is not None else 0
    actual_cells = len(table.rows[0].cells)
    print(f"Table {t_idx}: gridCols={grid_cols}  actual cells={actual_cells}")

    headers = [c.text.strip()[:20] for c in table.rows[0].cells]
    print(f"Headers: {headers}")
    break
