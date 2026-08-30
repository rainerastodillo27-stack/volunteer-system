import urllib.request
import urllib.error
import csv
import json
import time

QASE_TOKEN = "fb15339bb45e67a149919fa0d94795ce65fb839078ae95259d8ee15f7b05872a"
PROJECT_CODE = "VSTC"
BASE_URL = "https://api.qase.io/v1"

def qase_request(endpoint, method="GET", data=None):
    url = f"{BASE_URL}{endpoint}"
    headers = {
        "Token": QASE_TOKEN,
        "Content-Type": "application/json",
        "User-Agent": "Volcre-Qase-Uploader/1.0"
    }
    body = json.dumps(data).encode("utf-8") if data else None
    
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_content = e.read().decode("utf-8")
            if e.code == 429: # rate limited
                time.sleep(2)
                continue
            print(f"HTTP Error {e.code} on {endpoint}: {err_content}", flush=True)
            raise e
        except Exception as e:
            if attempt < 3:
                time.sleep(1.5)
                continue
            print(f"Request Error on {endpoint}: {e}", flush=True)
            raise e

SEV_MAP = {"blocker": 1, "critical": 2, "major": 3, "normal": 4, "minor": 5, "trivial": 6, "high": 2, "medium": 4, "low": 5}
PRIO_MAP = {"high": 1, "medium": 2, "low": 3}
TYPE_MAP = {"other": 1, "functional": 2, "smoke": 3, "regression": 4, "security": 5, "usability": 6, "performance": 7, "acceptance": 8, "integration": 2}
BEH_MAP = {"not_set": 1, "positive": 2, "negative": 3, "destructive": 4}
AUTO_MAP = {"not_automated": 0, "to_be_automated": 1, "automated": 2, "manual": 0}

def sync_all():
    print(f"Connecting to Qase Project: {PROJECT_CODE}...", flush=True)
    
    # 1. Fetch all existing suites
    suite_id_map = {}
    suites_res = qase_request(f"/suite/{PROJECT_CODE}?limit=100")
    if suites_res.get("status"):
        for s in suites_res["result"]["entities"]:
            suite_id_map[s["title"]] = s["id"]
            print(f"Existing Suite: '{s['title']}' (ID: {s['id']})", flush=True)

    # 2. Fetch all existing test cases
    existing_titles = set()
    offset = 0
    while True:
        cases_res = qase_request(f"/case/{PROJECT_CODE}?limit=100&offset={offset}")
        if not cases_res.get("status"):
            break
        entities = cases_res["result"]["entities"]
        if not entities:
            break
        for c in entities:
            existing_titles.add(c["title"])
        offset += len(entities)
        if offset >= cases_res["result"]["total"]:
            break

    print(f"Found {len(existing_titles)} existing test cases in Qase.", flush=True)

    # 3. Read CSV
    with open("qase_test_cases_import.csv", mode="r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"Total test cases in CSV to verify: {len(rows)}", flush=True)

    created_count = 0
    skipped_count = 0

    for row in rows:
        suite_name = row["Suite"]
        title = row["Title"]

        # Ensure suite exists
        if suite_name not in suite_id_map:
            print(f"Creating Suite: '{suite_name}'...", flush=True)
            res = qase_request(f"/suite/{PROJECT_CODE}", method="POST", data={"title": suite_name, "description": f"Test suite for {suite_name}"})
            if res.get("status"):
                suite_id = res["result"]["id"]
                suite_id_map[suite_name] = suite_id
                print(f" -> Created Suite '{suite_name}' with ID {suite_id}", flush=True)
            time.sleep(0.2)
        else:
            suite_id = suite_id_map[suite_name]

        # Check if test case already exists
        if title in existing_titles:
            skipped_count += 1
            continue

        # Parse steps
        step_lines = [s.strip() for s in row["Steps"].split("\n") if s.strip()]
        steps_payload = []
        for idx, line in enumerate(step_lines, 1):
            steps_payload.append({
                "action": line,
                "expected_result": row["Expected result"] if idx == len(step_lines) else "Step completed successfully."
            })

        case_payload = {
            "title": title,
            "description": row["Description"],
            "preconditions": row["Preconditions"],
            "suite_id": suite_id,
            "severity": SEV_MAP.get(row["Severity"].lower(), 4),
            "priority": PRIO_MAP.get(row["Priority"].lower(), 2),
            "type": TYPE_MAP.get(row["Type"].lower(), 2),
            "behavior": BEH_MAP.get(row["Behavior"].lower(), 2),
            "automation": AUTO_MAP.get(row["Automation"].lower(), 0),
            "status": 0,
            "steps": steps_payload
        }

        try:
            res = qase_request(f"/case/{PROJECT_CODE}", method="POST", data=case_payload)
            if res.get("status"):
                case_id = res["result"]["id"]
                created_count += 1
                existing_titles.add(title)
                print(f"[{len(existing_titles)}/100] Created Case #{case_id}: {title}", flush=True)
        except Exception as e:
            print(f"Failed to create {title}: {e}", flush=True)

        time.sleep(0.2)

    print(f"\n========================================================", flush=True)
    print(f"SYNC COMPLETE!", flush=True)
    print(f"Total in CSV: {len(rows)}", flush=True)
    print(f"Newly Created: {created_count}", flush=True)
    print(f"Already Existed: {skipped_count}", flush=True)
    print(f"Total in Qase.io ({PROJECT_CODE}): {len(existing_titles)}", flush=True)
    print(f"========================================================", flush=True)

if __name__ == "__main__":
    sync_all()
