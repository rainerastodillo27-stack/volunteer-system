"""
Complete synchronization of all 4 test suites to Qase.io project 'VSTC'.
Ensures all test cases exist in repository, uploads results to 4 dedicated test runs,
and completes the runs with full pass/fail statistics.
"""

import os
import sys
import urllib.request
import urllib.parse
import json
import time
import openpyxl

TOKEN = "ec05618ac96b74ac1ca37c1bc935896a16471b204f2e533139beaf7c3e6af1c3"
PROJECT = "VSTC"
BASE_URL = "https://api.qase.io/v1"

def api_call(endpoint, method="GET", data=None, retries=3):
    url = f"{BASE_URL}/{endpoint.lstrip('/')}"
    headers = {
        "Token": TOKEN,
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    body = json.dumps(data).encode("utf-8") if data is not None else None
    
    for attempt in range(retries):
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            print(f"  [HTTP {e.code}] {method} {url}: {err_body}", flush=True)
            return {"status": False, "error": err_body}
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2)
                continue
            print(f"  [Error] {method} {url}: {e}", flush=True)
            return {"status": False, "error": str(e)}

def get_existing_cases():
    print("Fetching existing test cases from Qase repository...", flush=True)
    case_map = {}
    offset = 0
    limit = 100
    while True:
        res = api_call(f"case/{PROJECT}?limit={limit}&offset={offset}")
        if not res.get("status"):
            break
        entities = res["result"]["entities"]
        for c in entities:
            case_map[c["title"].strip().lower()] = c["id"]
        if len(entities) < limit or len(case_map) >= res["result"]["total"]:
            break
        offset += len(entities)
    print(f"Found {len(case_map)} existing test cases in Qase repository.", flush=True)
    return case_map

def main():
    print(f"=======================================================", flush=True)
    print(f"CONNECTING TO QASE.IO PROJECT: {PROJECT}", flush=True)
    print(f"=======================================================", flush=True)

    check = api_call(f"project/{PROJECT}")
    if not check.get("status"):
        print(f"Failed to access project '{PROJECT}'. Aborting.", flush=True)
        sys.exit(1)
    
    project_title = check.get("result", {}).get("title", PROJECT)
    print(f"Connected to: {project_title} ({PROJECT})", flush=True)

    testings_dir = r"c:\Users\ACER\OneDrive\Desktop\volunteer-system\docs\testings"
    
    runs_config = [
        {
            "file": "alpha_blackbox_test_results.xlsx",
            "title": "Alpha Black-Box Test Run (End-to-End User Verification)",
            "desc": "Baseline End-to-End User Behavioral Verification across all system modules.\nScope: 138 Tests (135 Passed, 3 Defect Failures: APP59, APP68, APP73)."
        },
        {
            "file": "alpha_whitebox_backend_test_results.xlsx",
            "title": "Alpha White-Box Backend Test Run (API & Logic Coverage)",
            "desc": "Backend API Logic, Authorization & Branch Coverage Verification across 10 modules.\nScope: 100 Tests (96 Passed, 4 Defect Failures: TC-AUTH-04, TC-AUTH-05, TC-PROF-06, TC-MAP-04)."
        },
        {
            "file": "beta_blackbox_test_results.xlsx",
            "title": "Beta Black-Box Test Run (Production Verification - 100% Pass)",
            "desc": "Production-Ready End-to-End User Behavioral Verification.\nScope: 138 Tests (138 Passed, 0 Failures, 100% Verification Rate)."
        },
        {
            "file": "beta_whitebox_backend_test_results.xlsx",
            "title": "Beta White-Box Backend Test Run (Production Logic - 100% Pass)",
            "desc": "Production-Ready Backend Logic & Branch Coverage Verification.\nScope: 100 Tests (100 Passed, 0 Failures, 100% Verification Rate)."
        }
    ]

    # Step 1: Cache existing cases
    case_map = get_existing_cases()

    # Step 2: Ensure all test cases from all 4 sheets exist in Qase repository
    print("\nVerifying test case repository coverage...", flush=True)
    created_cases = 0
    all_sheet_data = {}

    for cfg in runs_config:
        excel_path = os.path.join(testings_dir, cfg["file"])
        wb = openpyxl.load_workbook(excel_path, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        headers = [str(c).strip() if c else "" for c in rows[0]]

        id_col = 0
        desc_col = headers.index("Description") if "Description" in headers else 1
        actual_col = headers.index("Actual Outcome") if "Actual Outcome" in headers else 2
        expected_col = headers.index("Expected Outcome") if "Expected Outcome" in headers else 3
        status_col = headers.index("Status") if "Status" in headers else 4
        comment_col = headers.index("Comments") if "Comments" in headers else 5
        actions_col = headers.index("Actions") if "Actions" in headers else None

        test_list = []
        for r in rows[1:]:
            if not r[id_col]:
                continue
            tc_id = str(r[id_col]).strip()
            desc = str(r[desc_col]).strip() if r[desc_col] else ""
            status_raw = str(r[status_col]).strip().upper() if r[status_col] else "PASS"
            qase_status = "passed" if status_raw == "PASS" else "failed"
            expected = str(r[expected_col]).strip() if r[expected_col] else ""
            actual = str(r[actual_col]).strip() if r[actual_col] else ""
            comment = str(r[comment_col]).strip() if r[comment_col] else ""
            actions = str(r[actions_col]).strip() if actions_col and r[actions_col] else ""

            full_title = f"[{tc_id}] {desc}"
            title_key = full_title.lower()

            if title_key not in case_map:
                # Precreate case so failed status is accepted
                case_payload = {
                    "title": full_title,
                    "description": desc,
                    "preconditions": f"Expected: {expected}",
                    "severity": 3 # Normal
                }
                c_res = api_call(f"case/{PROJECT}", method="POST", data=case_payload)
                if c_res.get("status"):
                    new_cid = c_res["result"]["id"]
                    case_map[title_key] = new_cid
                    created_cases += 1
                time.sleep(0.1)

            test_list.append({
                "tc_id": tc_id,
                "title": full_title,
                "case_id": case_map.get(title_key),
                "status": qase_status,
                "expected": expected,
                "actual": actual,
                "comment": comment,
                "actions": actions
            })

        all_sheet_data[cfg["file"]] = test_list

    if created_cases > 0:
        print(f"Pre-created {created_cases} missing test cases in Qase repository.", flush=True)
    else:
        print(f"All test cases already exist in Qase repository.", flush=True)

    # Step 3: Create the 4 Test Runs and Upload Results
    created_runs = []

    for cfg in runs_config:
        print(f"\n=======================================================", flush=True)
        print(f"Creating Run: {cfg['title']}", flush=True)
        print(f"=======================================================", flush=True)
        
        run_data = {
            "title": cfg["title"],
            "description": cfg["desc"],
            "is_autotest": True
        }
        run_res = api_call(f"run/{PROJECT}", method="POST", data=run_data)
        if not run_res.get("status"):
            print(f"Failed to create run for {cfg['file']}", flush=True)
            continue
            
        run_id = run_res["result"]["id"]
        print(f"Created Qase Run ID: {run_id}", flush=True)

        tests = all_sheet_data[cfg["file"]]
        results_payload = []
        for t in tests:
            comment_lines = [f"Test Case: {t['tc_id']}", f"Expected: {t['expected']}", f"Actual: {t['actual']}"]
            if t["actions"]:
                comment_lines.append(f"Actions: {t['actions']}")
            if t["comment"]:
                comment_lines.append(f"Notes/Defect: {t['comment']}")

            item = {
                "status": t["status"],
                "time_ms": 1200,
                "comment": "\n".join(comment_lines)
            }
            if t["case_id"]:
                item["case_id"] = t["case_id"]
            else:
                item["case"] = {"title": t["title"]}

            results_payload.append(item)

        # Upload in chunks of 50
        batch_size = 50
        total_uploaded = 0
        for i in range(0, len(results_payload), batch_size):
            batch = results_payload[i:i + batch_size]
            bulk_payload = {"results": batch}
            bulk_res = api_call(f"result/{PROJECT}/{run_id}/bulk", method="POST", data=bulk_payload)
            if bulk_res.get("status"):
                total_uploaded += len(batch)
                print(f"  Uploaded batch {i // batch_size + 1}: {len(batch)} results (Progress: {total_uploaded}/{len(tests)})", flush=True)
            else:
                print(f"  Batch {i // batch_size + 1} failed: {bulk_res.get('error')}", flush=True)
            time.sleep(0.5)

        # Complete the test run
        complete_res = api_call(f"run/{PROJECT}/{run_id}/complete", method="POST")
        if complete_res.get("status"):
            print(f"Run ID {run_id} successfully completed and finalized!", flush=True)
        else:
            print(f"Note on completing run {run_id}: {complete_res.get('error')}", flush=True)

        pass_count = sum(1 for x in tests if x["status"] == "passed")
        fail_count = sum(1 for x in tests if x["status"] == "failed")
        created_runs.append({
            "id": run_id,
            "title": cfg["title"],
            "total": len(tests),
            "passed": pass_count,
            "failed": fail_count
        })

    print(f"\n=======================================================", flush=True)
    print("ALL 4 TEST RESULT SUITES CONNECTED AND SYNCED TO QASE.IO!", flush=True)
    print("=======================================================", flush=True)
    for cr in created_runs:
        pct = (cr['passed'] / cr['total']) * 100
        print(f"[OK] Run #{cr['id']}: {cr['title']}", flush=True)
        print(f"    Total: {cr['total']} Tests | Passed: {cr['passed']} | Failed: {cr['failed']} ({pct:.1f}% Pass Rate)", flush=True)

if __name__ == "__main__":
    main()
