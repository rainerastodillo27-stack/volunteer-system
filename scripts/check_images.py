import docx
from docx.oxml.ns import qn

EMU = 914400  # 1 inch in EMU

files = [
    "docs/testings/Alpha_Whitebox_Test_Report.docx",
    "docs/testings/Alpha_Blackbox_Test_Report.docx",
    "docs/testings/Beta_Whitebox_Test_Report.docx",
    "docs/testings/Beta_Blackbox_Test_Report.docx",
]

for fname in files:
    doc = docx.Document(fname)
    body = doc.element.body

    extents = body.findall(
        ".//" + qn("wp:extent"),
        {"wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"},
    )

    print(f"=== {fname.replace('docs/testings/', '')} ===")
    print(f"  Total images: {len(extents)}")
    big = []
    for ext in extents:
        cx = int(ext.get("cx", 0))
        cy = int(ext.get("cy", 0))
        w_in = cx / EMU
        h_in = cy / EMU
        if w_in > 3.0 or h_in > 3.0:
            big.append((round(w_in, 2), round(h_in, 2)))

    if big:
        print(f"  LARGE images (>3in): {len(big)}")
        for w, h in big[:5]:
            print(f"    {w}\" x {h}\"")
    else:
        print("  All images are <= 3in wide/tall")

    # Also show first 5 image sizes
    for i, ext in enumerate(extents[:5]):
        cx = int(ext.get("cx", 0))
        cy = int(ext.get("cy", 0))
        print(f"    img{i+1}: {cx/EMU:.2f}\" x {cy/EMU:.2f}\"")
    print()
