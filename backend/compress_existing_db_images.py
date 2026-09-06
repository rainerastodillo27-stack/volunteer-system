"""
One-time database migration script to compress existing oversized Base64 images
in projects, events, and partner_project_applications tables.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import json
import time
from backend.db import get_connection, load_environment
from backend.image_compression import compress_base64_image, get_image_size_kb

load_environment()

def _compress_raw_or_uri(raw: str, max_bytes: int = 80_000, max_width: int = 800) -> str | None:
    if not raw or not isinstance(raw, str):
        return None
    
    prefix = ""
    if "," in raw and ("data:image" in raw[:50] or "data:application" in raw[:50]):
        prefix, b64 = raw.split(",", 1)
        prefix += ","
    else:
        b64 = raw
    
    if len(b64) <= max_bytes:
        return None  # Already small enough
    
    compressed = compress_base64_image(b64, max_size_bytes=max_bytes, max_width=max_width)
    if compressed:
        return f"{prefix}{compressed}" if prefix else compressed
    return None

def compress_project_images():
    print("--- Scanning projects and events for oversized images ---")
    with get_connection() as conn:
        with conn.cursor() as cur:
            for tbl, id_col in [("projects", "projects_id"), ("events", "events_id")]:
                try:
                    cur.execute(f"select {id_col}, title, image_url from {tbl} where length(image_url) > 80000")
                    rows = cur.fetchall()
                    print(f"Found {len(rows)} oversized images in {tbl}")
                    for item_id, title, img_url in rows:
                        orig_len = len(img_url)
                        compressed = _compress_raw_or_uri(img_url, max_bytes=60_000, max_width=800)
                        if compressed and len(compressed) < orig_len:
                            cur.execute(f"update {tbl} set image_url = %s where {id_col} = %s", (compressed, item_id))
                            print(f"  [{tbl}] {item_id} ({title}): {orig_len/1024:.1f} KB -> {len(compressed)/1024:.1f} KB")
                        else:
                            print(f"  [{tbl}] {item_id}: Could not compress, keeping original")
                except Exception as e:
                    print(f"  Error processing {tbl}: {e}")
        conn.commit()

def compress_partner_application_attachments():
    print("--- Scanning partner_project_applications for oversized attachments ---")
    with get_connection() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute("select partner_project_applications_id, proposal_details from partner_project_applications")
                rows = cur.fetchall()
                print(f"Found {len(rows)} partner applications")
                for app_id, details in rows:
                    if not details:
                        continue
                    parsed = details
                    if isinstance(details, str):
                        try:
                            parsed = json.loads(details)
                        except Exception:
                            continue
                    
                    if not isinstance(parsed, dict):
                        continue
                    
                    attachments = parsed.get("attachments")
                    if not isinstance(attachments, list) or not attachments:
                        continue
                    
                    changed = False
                    new_attachments = []
                    for att in attachments:
                        if isinstance(att, dict):
                            att_url = att.get("url") or att.get("uri") or att.get("data")
                            if isinstance(att_url, str) and len(att_url) > 80000:
                                orig_len = len(att_url)
                                compressed = _compress_raw_or_uri(att_url, max_bytes=60_000, max_width=800)
                                if compressed and len(compressed) < orig_len:
                                    new_att = dict(att)
                                    if "url" in new_att:
                                        new_att["url"] = compressed
                                    elif "uri" in new_att:
                                        new_att["uri"] = compressed
                                    elif "data" in new_att:
                                        new_att["data"] = compressed
                                    new_attachments.append(new_att)
                                    changed = True
                                    print(f"  [application] {app_id} dict attachment: {orig_len/1024:.1f} KB -> {len(compressed)/1024:.1f} KB")
                                else:
                                    new_attachments.append(att)
                            else:
                                new_attachments.append(att)
                        elif isinstance(att, str) and len(att) > 80000:
                            orig_len = len(att)
                            compressed = _compress_raw_or_uri(att, max_bytes=60_000, max_width=800)
                            if compressed and len(compressed) < orig_len:
                                new_attachments.append(compressed)
                                changed = True
                                print(f"  [application] {app_id} attachment: {orig_len/1024:.1f} KB -> {len(compressed)/1024:.1f} KB")
                            else:
                                new_attachments.append(att)
                        else:
                            new_attachments.append(att)
                    
                    if changed:
                        parsed["attachments"] = new_attachments
                        updated_json = json.dumps(parsed)
                        cur.execute(
                            "update partner_project_applications set proposal_details = %s where partner_project_applications_id = %s",
                            (updated_json, app_id)
                        )
            except Exception as e:
                print(f"  Error processing partner_project_applications: {e}")
        conn.commit()


def _compress_attachment_list(attachments):
    """Compress only oversized image data URIs and retain all other files."""
    if not isinstance(attachments, list):
        return attachments, False

    changed = False
    compressed_attachments = []
    for attachment in attachments:
        if isinstance(attachment, dict):
            url_key = next((key for key in ("url", "uri", "data") if isinstance(attachment.get(key), str)), None)
            raw_url = attachment.get(url_key) if url_key else None
            compressed = (
                _compress_raw_or_uri(raw_url, max_bytes=60_000, max_width=800)
                if isinstance(raw_url, str) and len(raw_url) > 80_000
                else None
            )
            if compressed and len(compressed) < len(raw_url):
                updated_attachment = dict(attachment)
                updated_attachment[url_key] = compressed
                compressed_attachments.append(updated_attachment)
                changed = True
            else:
                compressed_attachments.append(attachment)
            continue

        if isinstance(attachment, str) and len(attachment) > 80_000:
            compressed = _compress_raw_or_uri(attachment, max_bytes=60_000, max_width=800)
            if compressed and len(compressed) < len(attachment):
                compressed_attachments.append(compressed)
                changed = True
                continue

        compressed_attachments.append(attachment)

    return compressed_attachments, changed


def compress_proposal_message_attachments():
    """Remove duplicate oversized proposal images from direct-message cards."""
    print("--- Scanning proposal message cards for oversized attachments ---")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select messages_id, content
                from public.messages
                where content like '___PROPOSAL_CARD___:%%'
                """
            )
            rows = cur.fetchall()
            print(f"Found {len(rows)} proposal message cards")

            for message_id, content in rows:
                if not isinstance(content, str):
                    continue
                try:
                    card = json.loads(content[len("___PROPOSAL_CARD___:"):])
                except (TypeError, ValueError, json.JSONDecodeError):
                    continue
                if not isinstance(card, dict):
                    continue

                changed = False
                top_attachments, top_changed = _compress_attachment_list(card.get("attachments"))
                if top_changed:
                    card["attachments"] = top_attachments
                    changed = True

                details = card.get("proposalDetails")
                if isinstance(details, dict):
                    nested_attachments, nested_changed = _compress_attachment_list(details.get("attachments"))
                    if nested_changed:
                        card["proposalDetails"] = {**details, "attachments": nested_attachments}
                        changed = True

                if changed:
                    updated_content = f"___PROPOSAL_CARD___:{json.dumps(card)}"
                    cur.execute(
                        "update public.messages set content = %s where messages_id = %s",
                        (updated_content, message_id),
                    )
                    print(f"  [message] {message_id}: compressed proposal attachments")
        conn.commit()

if __name__ == "__main__":
    t0 = time.perf_counter()
    compress_project_images()
    compress_partner_application_attachments()
    compress_proposal_message_attachments()
    print(f"Compression completed in {time.perf_counter() - t0:.2f}s")
