"""Inspect Duration cell XML to see what's causing vertical text."""
from pathlib import Path
from docx import Document
from docx.oxml.ns import qn
import lxml.etree as etree

doc = Document("docs/testings/Alpha_Whitebox_Test_Report.docx")

for t_idx, table in enumerate(doc.tables):
    if not table.rows:
        continue
    header_text = table.rows[0].cells[0].text.strip().lower()
    if header_text not in ("test id", "test case id"):
        continue

    # Find Duration column
    dur_idx = -1
    for i, cell in enumerate(table.rows[0].cells):
        if cell.text.strip().lower() == "duration":
            dur_idx = i
            break

    if dur_idx == -1:
        continue

    # Print XML of header Duration cell
    header_cell = table.rows[0].cells[dur_idx]
    print(f"=== Table {t_idx} - Duration header cell XML ===")
    print(etree.tostring(header_cell._tc, pretty_print=True).decode())
    break
