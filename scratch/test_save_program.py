import urllib.request, urllib.error, json, sys

BASE = "http://127.0.0.1:8000"
TRACK_ID = "_test_prog_2026"

# GET existing
r = urllib.request.urlopen(f"{BASE}/storage/programTracks", timeout=10)
tracks = json.loads(r.read()).get("value", [])
print(f"Current tracks: {[t['id'] for t in tracks]}")

new_track = {
    "id": TRACK_ID,
    "title": "TEST Script Program",
    "description": "Written by test script",
    "icon": "folder",
    "color": "#6366f1",
    "isActive": True,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z",
}
tracks = [t for t in tracks if t.get("id") != TRACK_ID]
tracks.append(new_track)

body = json.dumps({"value": tracks}).encode()
req = urllib.request.Request(
    f"{BASE}/storage/programTracks",
    data=body,
    headers={"Content-Type": "application/json"},
    method="PUT"
)

try:
    r2 = urllib.request.urlopen(req, timeout=15)
    resp = r2.read().decode()
    print(f"PUT {r2.status}: {resp[:300]}")
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print(f"PUT ERROR {e.code}: {body[:2000]}")
    sys.exit(1)

r3 = urllib.request.urlopen(f"{BASE}/storage/programTracks", timeout=10)
after = json.loads(r3.read()).get("value", [])
found = any(t.get("id") == TRACK_ID for t in after)
print(f"Read-back: {len(after)} tracks, test found = {found}")
print("IDs:", [t["id"] for t in after])
