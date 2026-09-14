import docx
from docx.oxml.ns import qn

files = [
    "docs/testings/backup/Alpha_Whitebox_Test_Report.docx",
    "docs/testings/backup/Alpha_Blackbox_Test_Report.docx",
    "docs/testings/backup/Beta_Whitebox_Test_Report.docx",
    "docs/testings/backup/Beta_Blackbox_Test_Report.docx",
]
EMU = 914400
for fname in files:
    doc = docx.Document(fname)
    body = doc.element.body
    extents = body.findall(
        ".//" + qn("wp:extent"),
        {"wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"},
    )
    name = fname.replace("docs/testings/backup/", "BACKUP-")
    big = sum(1 for ext in extents if int(ext.get("cx", 0)) / EMU > 3.0)
    print(f"{name}: {len(extents)} images, {big} large (>3in wide)")
    for i, ext in enumerate(extents[:5]):
        cx = int(ext.get("cx", 0))
        cy = int(ext.get("cy", 0))
        print(f"  img{i+1}: {cx/EMU:.2f}in x {cy/EMU:.2f}in")
    print()
