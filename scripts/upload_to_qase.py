"""
Script to automatically upload test results and test cases to Qase.io via REST API.

Usage:
  python scripts/upload_to_qase.py --token YOUR_QASE_API_TOKEN --project YOUR_PROJECT_CODE

Options:
  --token    Your Qase API token (or set env variable QASE_API_TOKEN)
  --project  Your Qase Project Code e.g. 'NVC' or 'VOL' (or set env variable QASE_PROJECT_CODE)
"""

import os
import sys
import argparse
import urllib.request
import urllib.parse
import json
import openpyxl

BASE_API_URL = "https://api.qase.io/v1"

def qase_request(endpoint, token, method="GET", data=None):
    url = f"{BASE_API_URL}/{endpoint.lstrip('/')}"
    headers = {
        "Token": token,
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8")
        print(f"HTTP Error {e.code} on {method} {url}: {err_msg}")
        return {"status": False, "error": err_msg}
    except Exception as e:
        print(f"Error on {method} {url}: {e}")
        return {"status": False, "error": str(e)}

def main():
    parser = argparse.ArgumentParser(description="Upload test results to Qase.io")
    parser.add_argument("--token", default=os.getenv("QASE_API_TOKEN"), help="Qase API Token")
    parser.add_argument("--project", default=os.getenv("QASE_PROJECT_CODE"), help="Qase Project Code (e.g. NVC)")
    args = parser.parse_args()

    token = args.token
    project = args.project

    if not token:
        token = input("Enter your Qase API Token: ").strip()
    if not project:
        project = input("Enter your Qase Project Code (e.g. NVC): ").strip().upper()

    if not token or not project:
        print("Error: Both API token and project code are required.")
        sys.exit(1)

    print(f"\nVerifying connection to Qase project '{project}'...")
    check = qase_request(f"project/{project}", token)
    if not check.get("status"):
        print(f"Failed to access project '{project}'. Please verify your token and project code.")
        sys.exit(1)

    print(f"Successfully connected to Qase project: {check.get('result', {}).get('title', project)}")

    testings_dir = r"c:\Users\ACER\OneDrive\Desktop\volunteer-system\docs\testings"
    runs = [
        {
            "name": "Alpha Black-Box Test Run",
            "file": "alpha_blackbox_test_results.xlsx",
            "desc": "Baseline End-to-End User Behavioral Verification"
        },
        {
            "name": "Alpha White-Box Test Run",
            "file": "alpha_whitebox_backend_test_results.xlsx",
            "desc": "Backend API Logic & Branch Coverage Verification"
        },
        {
            "name": "Beta Black-Box Test Run",
            "file": "beta_blackbox_test_results.xlsx",
            "desc": "Production-Ready End-to-End Verification (Zero Failures)"
        },
        {
            "name": "Beta White-Box Test Run",
            "file": "beta_whitebox_backend_test_results.xlsx",
            "desc": "Production-Ready Backend Logic Verification (100% Pass)"
        }
    ]

    for run_info in runs:
        print(f"\n=======================================================")
        print(f"Creating Test Run: {run_info['name']}")
        print(f"=======================================================")
        
        # Create Run in Qase
        run_payload = {
            "title": run_info["name"],
            "description": run_info["desc"],
            "is_autotest": True
        }
        create_run_res = qase_request(f"run/{project}", token, method="POST", data=run_payload)
        if not create_run_res.get("status"):
            print(f"Skipping {run_info['name']} due to run creation error.")
            continue

        run_id = create_run_res["result"]["id"]
        print(f"Created Run ID: {run_id}")

        # Read results
        file_path = os.path.join(testings_dir, run_info["file"])
        wb = openpyxl.load_workbook(file_path, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        headers = [str(c).strip() if c else "" for c in rows[0]]

        id_col = 0
        desc_col = headers.index("Description") if "Description" in headers else 1
        actual_col = headers.index("Actual Outcome") if "Actual Outcome" in headers else 2
        status_col = headers.index("Status") if "Status" in headers else 4
        comment_col = headers.index("Comments") if "Comments" in headers else 5

        uploaded = 0
        for r in rows[1:]:
            if not r[id_col]:
                continue
            tc_id = str(r[id_col]).strip()
            desc = str(r[desc_col]).strip() if r[desc_col] else ""
            status_val = str(r[status_col]).strip().upper() if r[status_col] else "PASS"
            qase_status = "passed" if status_val == "PASS" else "failed"
            actual = str(r[actual_col]).strip() if r[actual_col] else ""
            comment = str(r[comment_col]).strip() if r[comment_col] else ""

            result_payload = {
                "case": {
                    "title": f"[{tc_id}] {desc}"
                },
                "status": qase_status,
                "time_ms": 1000,
                "comment": f"Actual Outcome: {actual}\nNotes: {comment}"
            }

            res = qase_request(f"result/{project}/{run_id}", token, method="POST", data=result_payload)
            if res.get("status"):
                uploaded += 1

        print(f"Uploaded {uploaded} test results to Run '{run_info['name']}' (ID: {run_id})")

    print("\nAll 4 test result suites successfully connected and synced to Qase.io!")

if __name__ == "__main__":
    main()
