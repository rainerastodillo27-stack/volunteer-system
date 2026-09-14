"""
Resize all images in the 4 test report DOCXs to a target size that
reduces page count toward the 100-130 page range.

Strategy:
  - Max image width:  3.20 inches  (was ~6.4-7.09 inches)
  - Max image height: 2.20 inches  (was ~2.4-6.65 inches)
  - Preserves aspect ratio (scale down only, never up)

Run from repo root:
    python scripts/resize_docx_images.py
"""

import shutil
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn

DOCS_DIR = Path("docs/testings")
EMU = 914400  # 1 inch in EMU

# Target maximum dimensions (in inches)
MAX_W_IN = 3.20
MAX_H_IN = 2.20

MAX_W_EMU = int(MAX_W_IN * EMU)
MAX_H_EMU = int(MAX_H_IN * EMU)

FILES = [
    DOCS_DIR / "Alpha_Whitebox_Test_Report.docx",
    DOCS_DIR / "Beta_Whitebox_Test_Report.docx",
    DOCS_DIR / "Alpha_Blackbox_Test_Report.docx",
    DOCS_DIR / "Beta_Blackbox_Test_Report.docx",
]

COMPACT_MAP = {
    "Alpha_Whitebox_Test_Report.docx": "Alpha_Whitebox_Test_Report_Compact.docx",
    "Beta_Whitebox_Test_Report.docx":  "Beta_Whitebox_Test_Report_Compact.docx",
    "Alpha_Blackbox_Test_Report.docx": "Alpha_Blackbox_Test_Report_Compact.docx",
    "Beta_Blackbox_Test_Report.docx":  "Beta_Blackbox_Test_Report_Compact.docx",
}
TNR_MAP = {
    "Alpha_Whitebox_Test_Report.docx": "Alpha_Whitebox_Test_Report_TimesNewRoman12.docx",
    "Beta_Whitebox_Test_Report.docx":  "Beta_Whitebox_Test_Report_TimesNewRoman12.docx",
    "Alpha_Blackbox_Test_Report.docx": "Alpha_Blackbox_Test_Report_TimesNewRoman12.docx",
    "Beta_Blackbox_Test_Report.docx":  "Beta_Blackbox_Test_Report_TimesNewRoman12.docx",
}

NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
NS_A  = "http://schemas.openxmlformats.org/drawingml/2006/main"


def resize_images_in_doc(doc_path: Path) -> int:
    """
    Resize all inline images in the document so they fit within
    MAX_W_EMU x MAX_H_EMU while maintaining aspect ratio.
    Returns count of images resized.
    """
    doc = Document(str(doc_path))
    body = doc.element.body
    resized = 0
    skipped = 0

    # Find all <wp:extent> elements — these define rendered image dimensions
    extents = body.findall(f".//{qn('wp:extent')}", {"wp": NS_WP})

    for ext in extents:
        cx = int(ext.get("cx", 0))
        cy = int(ext.get("cy", 0))

        if cx == 0 or cy == 0:
            skipped += 1
            continue

        # Determine scale factor needed to fit within bounds
        scale_w = MAX_W_EMU / cx if cx > MAX_W_EMU else 1.0
        scale_h = MAX_H_EMU / cy if cy > MAX_H_EMU else 1.0
        scale = min(scale_w, scale_h)  # use the more restrictive

        if scale >= 1.0:
            skipped += 1
            continue  # already within bounds

        new_cx = int(cx * scale)
        new_cy = int(cy * scale)
        ext.set("cx", str(new_cx))
        ext.set("cy", str(new_cy))
        resized += 1

        # Also update any sibling <a:ext> (for the drawing canvas) to match
        # Walk up to find the enclosing <wp:inline> or <wp:anchor>
        parent = ext.getparent()
        if parent is not None:
            for a_ext in parent.iter(qn("a:ext")):
                a_ext.set("cx", str(new_cx))
                a_ext.set("cy", str(new_cy))

    doc.save(str(doc_path))
    print(f"  Resized: {resized}, Already OK: {skipped}")
    return resized


def sync_variants(src: Path):
    name = src.name
    for mapping in (COMPACT_MAP, TNR_MAP):
        dst_name = mapping.get(name)
        if dst_name:
            shutil.copy2(str(src), str(DOCS_DIR / dst_name))
            print(f"  Synced -> {dst_name}")


def main():
    print("=" * 60)
    print(f"  Resize Images  (max {MAX_W_IN}\" W  x  {MAX_H_IN}\" H)")
    print("=" * 60)

    for path in FILES:
        print(f"\n[{path.name}]")
        resize_images_in_doc(path)
        sync_variants(path)

    print("\n" + "=" * 60)
    print("  Done! Open in Word to check page count.")
    print(f"  Target: images <= {MAX_W_IN}\" wide  x  {MAX_H_IN}\" tall")
    print("=" * 60)


if __name__ == "__main__":
    main()
