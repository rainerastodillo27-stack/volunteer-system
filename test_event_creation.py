import requests
import json
from datetime import datetime, timedelta

# Get existing projects/events to create a new event
base_url = "http://127.0.0.1:8000"

# Fetch existing events
print("[1] Fetching existing events...")
response = requests.post(
    f"{base_url}/storage/batch",
    json={"keys": ["events"]},
    timeout=120
)
data = response.json()
events = data.get("items", {}).get("events", [])
print(f"    Found {len(events)} existing events")

# Get the first project to link to
print("[2] Fetching projects...")
response = requests.post(
    f"{base_url}/storage/batch",
    json={"keys": ["projects"]},
    timeout=120
)
data = response.json()
projects = data.get("items", {}).get("projects", [])
if projects:
    first_project_id = projects[0]["id"]
    print(f"    Found {len(projects)} projects, using: {first_project_id}")
else:
    print("    No projects found!")
    first_project_id = None

# Create a new test event
print("[3] Creating new test event...")
new_event = {
    "id": f"test-event-{int(datetime.now().timestamp())}",
    "title": f"UI Test Event - {datetime.now().strftime('%H:%M:%S')}",
    "description": "Created via API for UI testing",
    "projectId": first_project_id or "test-project",
    "isEvent": True,
    "startDate": (datetime.now() + timedelta(days=1)).isoformat(),
    "endDate": (datetime.now() + timedelta(days=1, hours=2)).isoformat(),
    "status": "planning",
    "createdAt": datetime.now().isoformat(),
    "updatedAt": datetime.now().isoformat(),
}

# Save the event
print(f"    Event ID: {new_event['id']}")
print(f"    Event Title: {new_event['title']}")

# Update events list
all_events = events + [new_event]

# Send back to storage
response = requests.post(
    f"{base_url}/storage/setItem",
    json={"key": "events", "value": all_events},
    timeout=120
)

if response.status_code == 200:
    print("    ✓ Event created successfully!")
else:
    print(f"    ✗ Failed to save event: {response.status_code}")

print("\n[4] Verification - fetching fresh event list...")
response = requests.post(
    f"{base_url}/storage/batch",
    json={"keys": ["events"]},
    timeout=120
)
fresh_events = response.json().get("items", {}).get("events", [])
print(f"    Total events now: {len(fresh_events)}")

# Find and print our new event
for e in fresh_events:
    if "UI Test Event" in e.get("title", ""):
        print(f"    ✓ Found created event: {e['id']}")
        break
