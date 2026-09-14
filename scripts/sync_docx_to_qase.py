"""
sync_docx_to_qase.py
====================
Reads the 4 updated DOCX test reports, extracts:
  - Test Case ID, Status, Duration (from table)
  - Evidence screenshot (image embedded after "Evidence Screenshot:" paragraph)

Then:
  1. Ensures every test case exists in the Qase repository
  2. Uploads each screenshot as a Qase attachment
  3. Creates 4 new test runs with correct duration_ms + screenshot attachments

Run from repo root:
    python scripts/sync_docx_to_qase.py
"""

import os
import sys
import json
import time
import uuid
import re
import io
import urllib.request
import urllib.error
import http.client
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn

# ── Config ─────────────────────────────────────────────────────────────────
TOKEN   = "ec05618ac96b74ac1ca37c1bc935896a16471b204f2e533139beaf7c3e6af1c3"
PROJECT = "VSTC"
BASE    = "https://api.qase.io/v1"
DOCS    = Path("docs/testings")

REPORTS = [
    {
        "docx": DOCS / "Alpha_Whitebox_Test_Report.docx",
        "kind": "whitebox",
        "run_title": "Alpha White-Box Backend Test Run (Updated – Semantic IDs + Evidence)",
        "run_desc":  "Updated Alpha WB run: semantic TC-XXX IDs, per-test durations, and screenshot attachments.",
    },
    {
        "docx": DOCS / "Beta_Whitebox_Test_Report.docx",
        "kind": "whitebox",
        "run_title": "Beta White-Box Backend Test Run (Updated – Semantic IDs + Evidence)",
        "run_desc":  "Updated Beta WB run: semantic TC-XXX IDs, per-test durations, and screenshot attachments.",
    },
    {
        "docx": DOCS / "Alpha_Blackbox_Test_Report.docx",
        "kind": "blackbox",
        "run_title": "Alpha Black-Box Test Run (Updated – Semantic IDs + Evidence)",
        "run_desc":  "Updated Alpha BB run: semantic TC-XXX IDs and screenshot attachments.",
    },
    {
        "docx": DOCS / "Beta_Blackbox_Test_Report.docx",
        "kind": "blackbox",
        "run_title": "Beta Black-Box Test Run (Updated – Semantic IDs + Evidence)",
        "run_desc":  "Updated Beta BB run: semantic TC-XXX IDs and screenshot attachments.",
    },
]

# ── Qase API helpers ────────────────────────────────────────────────────────

def api(endpoint, method="GET", data=None, retries=3):
    url = f"{BASE}/{endpoint.lstrip('/')}"
    headers = {
        "Token": TOKEN,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    body = json.dumps(data).encode() if data is not None else None
    for attempt in range(retries):
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            err = e.read().decode()
            print(f"  [HTTP {e.code}] {method} {endpoint}: {err[:120]}")
            return {"status": False, "error": err}
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2)
                continue
            print(f"  [ERR] {method} {endpoint}: {e}")
            return {"status": False, "error": str(e)}


def upload_attachment(img_bytes: bytes, filename: str) -> str | None:
    """Upload image bytes to Qase. Returns hash string or None."""
    boundary = uuid.uuid4().hex
    mime = "image/png" if filename.endswith(".png") else "image/jpeg"

    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {mime}\r\n\r\n"
    ).encode() + img_bytes + f"\r\n--{boundary}--\r\n".encode()

    conn = http.client.HTTPSConnection("api.qase.io", timeout=30)
    headers = {
        "Token": TOKEN,
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Accept": "application/json",
        "Content-Length": str(len(body)),
    }
    try:
        conn.request("POST", f"/v1/attachment/{PROJECT}", body=body, headers=headers)
        resp = conn.getresponse()
        result = json.loads(resp.read().decode())
        if result.get("status"):
            hashes = result.get("result", {}).get("hashes", [])
            return hashes[0] if hashes else None
        return None
    except Exception as e:
        print(f"  [Upload ERR] {e}")
        return None
    finally:
        conn.close()


# ── DOCX extraction ─────────────────────────────────────────────────────────

def _duration_to_ms(dur_str: str) -> int:
    """Convert '0.88s' → 880, '2.37s' → 2370. Default 1200ms."""
    m = re.match(r"(\d+\.?\d*)s", dur_str.strip())
    if m:
        return int(float(m.group(1)) * 1000)
    return 1200


def _get_image_bytes(doc, rId: str):
    """Return (bytes, ext) for a relationship ID in the document part."""
    try:
        rel = doc.part.rels.get(rId)
        if rel is None:
            return None, None
        img_part = rel.target_part
        ext = img_part.partname.split(".")[-1].lower()
        return img_part.blob, ext
    except Exception:
        return None, None


def extract_tests_from_docx(docx_path: Path, kind: str) -> list[dict]:
    """
    Walk document body and extract per-test dicts:
      tc_id, status, duration_ms, img_bytes, img_ext, description
    """
    print(f"  Parsing {docx_path.name}...")
    doc = Document(str(docx_path))
    body = doc.element.body
    children = list(body)

    TC_HEADING_RE = re.compile(
        r"(?:alpha|beta)\s+test\s*[-–]\s*(?:whitebox|blackbox)\s*[-–]\s*(TC-[A-Z]+-\d+)",
        re.IGNORECASE,
    )

    results = []
    i = 0

    while i < len(children):
        el = children[i]
        tag = el.tag.split("}")[-1] if "}" in el.tag else el.tag

        if tag != "p":
            i += 1
            continue

        # Get text of paragraph
        p_text = "".join(r.text for r in el.iter(qn("w:t"))).strip()
        m = TC_HEADING_RE.match(p_text)
        if not m:
            i += 1
            continue

        tc_id = m.group(1)

        # Scan forward for the test table, then image
        status = "passed"
        duration_ms = 1200
        img_bytes = None
        img_ext = "png"
        description = ""

        j = i + 1
        table_found = False

        while j < len(children) and j < i + 20:
            el2 = children[j]
            tag2 = el2.tag.split("}")[-1] if "}" in el2.tag else el2.tag

            if tag2 == "tbl":
                # Parse test table: find Status and Duration columns
                rows = el2.findall(qn("w:tr"))
                if len(rows) >= 1:
                    # Get headers from first row
                    hdr_cells = rows[0].findall(qn("w:tc"))
                    headers = []
                    for c in hdr_cells:
                        txt = "".join(t.text for t in c.iter(qn("w:t"))).strip().lower()
                        headers.append(txt)

                    # Get data rows
                    for data_row in rows[1:]:
                        data_cells = data_row.findall(qn("w:tc"))
                        row_vals = []
                        for c in data_cells:
                            txt = "".join(t.text for t in c.iter(qn("w:t"))).strip()
                            row_vals.append(txt)

                        # Map by header
                        for h_idx, h in enumerate(headers):
                            if h_idx >= len(row_vals):
                                break
                            if "status" in h:
                                raw = row_vals[h_idx].upper()
                                status = "passed" if raw in ("PASS", "PASSED") else "failed"
                            if "duration" in h:
                                duration_ms = _duration_to_ms(row_vals[h_idx])
                            if "description" in h or "test name" in h:
                                description = row_vals[h_idx]

                table_found = True
                j += 1
                continue

            if tag2 == "p" and table_found:
                p2_text = "".join(r.text for r in el2.iter(qn("w:t"))).strip()

                # Check for image in this paragraph
                blips = el2.findall(
                    ".//" + qn("a:blip"),
                    {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"},
                )
                if blips:
                    rId = blips[0].get(
                        "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed"
                    )
                    img_bytes, img_ext = _get_image_bytes(doc, rId)
                    break  # done with this test case

                # Stop if we hit the next test heading
                if TC_HEADING_RE.match(p2_text):
                    break

            j += 1

        results.append({
            "tc_id": tc_id,
            "description": description,
            "status": status,
            "duration_ms": duration_ms,
            "img_bytes": img_bytes,
            "img_ext": img_ext or "png",
        })

        i += 1

    print(f"  Extracted {len(results)} test cases")
    passed = sum(1 for r in results if r["status"] == "passed")
    failed = len(results) - passed
    print(f"  Pass: {passed}  Fail: {failed}")
    return results


# ── Qase sync ───────────────────────────────────────────────────────────────

def get_existing_cases() -> dict:
    print("Fetching existing Qase cases...", flush=True)
    case_map = {}
    offset, limit = 0, 100
    while True:
        res = api(f"case/{PROJECT}?limit={limit}&offset={offset}")
        if not res.get("status"):
            break
        entities = res["result"]["entities"]
        for c in entities:
            case_map[c["title"].strip().lower()] = c["id"]
        if len(entities) < limit or len(case_map) >= res["result"]["total"]:
            break
        offset += len(entities)
    print(f"  Found {len(case_map)} existing cases", flush=True)
    return case_map


def ensure_cases_exist(tests: list, case_map: dict) -> dict:
    """Create any missing test cases in Qase repo."""
    created = 0
    for t in tests:
        full_title = f"[{t['tc_id']}] {t['description']}"
        key = full_title.lower()
        if key not in case_map:
            payload = {
                "title": full_title,
                "description": t["description"],
                "severity": 3,
            }
            res = api(f"case/{PROJECT}", method="POST", data=payload)
            if res.get("status"):
                case_map[key] = res["result"]["id"]
                created += 1
            time.sleep(0.15)
    if created:
        print(f"  Created {created} new test cases in Qase")
    return case_map


def upload_screenshots(tests: list) -> dict:
    """Upload screenshots and return {tc_id: attachment_hash}."""
    hashes = {}
    total = sum(1 for t in tests if t["img_bytes"])
    if total == 0:
        print("  No screenshots to upload")
        return hashes

    print(f"  Uploading {total} screenshots to Qase...")
    uploaded = 0
    for t in tests:
        if not t["img_bytes"]:
            continue
        filename = f"{t['tc_id']}.{t['img_ext']}"
        h = upload_attachment(t["img_bytes"], filename)
        if h:
            hashes[t["tc_id"]] = h
            uploaded += 1
        if uploaded % 10 == 0:
            print(f"    {uploaded}/{total} uploaded...")
        time.sleep(0.2)  # rate limit safety

    print(f"  Uploaded {uploaded}/{total} screenshots")
    return hashes


def create_run_and_upload(cfg: dict, tests: list, case_map: dict, att_hashes: dict):
    """Create a Qase test run and bulk-upload results."""
    run_res = api(
        f"run/{PROJECT}",
        method="POST",
        data={
            "title": cfg["run_title"],
            "description": cfg["run_desc"],
            "is_autotest": False,
        },
    )
    if not run_res.get("status"):
        print(f"  [FAIL] Could not create run: {run_res.get('error')}")
        return None

    run_id = run_res["result"]["id"]
    print(f"  Created run #{run_id}: {cfg['run_title']}")

    # Build results payload
    results_payload = []
    for t in tests:
        full_title = f"[{t['tc_id']}] {t['description']}"
        case_id = case_map.get(full_title.lower())
        comment = f"Test Case: {t['tc_id']}\nDuration: {t['duration_ms']}ms"

        item = {
            "status": t["status"],
            "time_ms": t["duration_ms"],
            "comment": comment,
        }
        if case_id:
            item["case_id"] = case_id
        else:
            item["case"] = {"title": full_title}

        # Attach screenshot hash if available
        if t["tc_id"] in att_hashes:
            item["attachments"] = [att_hashes[t["tc_id"]]]

        results_payload.append(item)

    # Bulk upload in batches of 50
    batch_size = 50
    total_uploaded = 0
    for i in range(0, len(results_payload), batch_size):
        batch = results_payload[i : i + batch_size]
        res = api(
            f"result/{PROJECT}/{run_id}/bulk",
            method="POST",
            data={"results": batch},
        )
        if res.get("status"):
            total_uploaded += len(batch)
            print(f"  Batch {i//batch_size + 1}: {total_uploaded}/{len(tests)} results uploaded")
        else:
            print(f"  Batch {i//batch_size + 1} failed: {res.get('error', '')[:100]}")
        time.sleep(0.5)

    # Complete run
    api(f"run/{PROJECT}/{run_id}/complete", method="POST")
    print(f"  Run #{run_id} completed!")

    passed = sum(1 for t in tests if t["status"] == "passed")
    failed = len(tests) - passed
    return {"id": run_id, "total": len(tests), "passed": passed, "failed": failed}


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  Sync Updated DOCX Reports → Qase.io")
    print("=" * 60)

    # Verify connection
    check = api(f"project/{PROJECT}")
    if not check.get("status"):
        print(f"Cannot reach Qase project '{PROJECT}'. Check token/project code.")
        sys.exit(1)
    print(f"Connected: {check['result']['title']} ({PROJECT})\n")

    case_map = get_existing_cases()
    run_summaries = []

    for cfg in REPORTS:
        print(f"\n{'='*60}")
        print(f"  {cfg['docx'].name}")
        print("=" * 60)

        # 1. Extract test data + images from DOCX
        tests = extract_tests_from_docx(cfg["docx"], cfg["kind"])
        if not tests:
            print("  No tests found, skipping.")
            continue

        # 2. Ensure all cases exist in Qase repo
        print("\n  Ensuring test cases exist in Qase...")
        case_map = ensure_cases_exist(tests, case_map)

        # 3. Upload screenshots
        print("\n  Uploading evidence screenshots...")
        att_hashes = upload_screenshots(tests)

        # 4. Create run + upload results
        print("\n  Creating test run + uploading results...")
        summary = create_run_and_upload(cfg, tests, case_map, att_hashes)
        if summary:
            run_summaries.append({"title": cfg["run_title"], **summary})

    # Final summary
    print(f"\n{'='*60}")
    print("  ALL DONE — Qase Sync Complete")
    print("=" * 60)
    for s in run_summaries:
        pct = s["passed"] / s["total"] * 100 if s["total"] else 0
        status_icon = "✅" if s["failed"] == 0 else "⚠️"
        print(f"  {status_icon} Run #{s['id']}: {s['title']}")
        print(f"     {s['passed']}/{s['total']} passed ({pct:.1f}%)")


if __name__ == "__main__":
    main()
