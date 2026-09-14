"""
Analyze current DOCX structure to estimate page count and plan image resize.
"""
import docx
from docx.oxml.ns import qn
from docx.shared import Pt

EMU = 914400  # 1 inch in EMU

files = [
    "docs/testings/Alpha_Whitebox_Test_Report.docx",
    "docs/testings/Beta_Whitebox_Test_Report.docx",
    "docs/testings/Alpha_Blackbox_Test_Report.docx",
    "docs/testings/Beta_Blackbox_Test_Report.docx",
]

for fname in files:
    doc = docx.Document(fname)
    body = doc.element.body

    extents = body.findall(
        ".//" + qn("wp:extent"),
        {"wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"},
    )
    name = fname.replace("docs/testings/", "")

    total_w = sum(int(e.get("cx", 0)) for e in extents)
    total_h = sum(int(e.get("cy", 0)) for e in extents)
    avg_w = total_w / len(extents) / EMU if extents else 0
    avg_h = total_h / len(extents) / EMU if extents else 0

    # Count tables
    test_tables = [t for t in doc.tables if t.rows and t.rows[0].cells[0].text.strip().lower() in ("test id","test case id")]

    # Estimate: usable page height ~9.5in (letter, 1in margins top+bottom)
    # Each test table (single row data) ~ 0.8in
    # Each image @ avg_h inches + 0.2in padding
    est_content_per_test = 0.8 + avg_h + 0.2
    est_pages = len(test_tables) * est_content_per_test / 9.5

    print(f"=== {name} ===")
    print(f"  Test tables:   {len(test_tables)}")
    print(f"  Images:        {len(extents)}")
    print(f"  Avg img size:  {avg_w:.2f}\" W x {avg_h:.2f}\" H")
    print(f"  Est pages:     ~{est_pages:.0f}")

    # Sizes we'd need to hit targets
    for target_pages in [100, 115, 130]:
        needed_h = (target_pages * 9.5 / len(test_tables)) - 0.8 - 0.2 if test_tables else 0
        print(f"  To hit ~{target_pages}p:  img height <= {needed_h:.2f}\"")
    print()
