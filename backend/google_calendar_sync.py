"""Google Calendar helpers for the partner schedule integration."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from typing import Any


GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo"
GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3"
GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events"
DEFAULT_CHANNEL_TTL_SECONDS = 6 * 24 * 60 * 60


class GoogleCalendarError(RuntimeError):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def configured_client_ids() -> set[str]:
    values = [
        os.getenv("GOOGLE_WEB_CLIENT_ID", ""),
        os.getenv("GOOGLE_CALENDAR_WEB_CLIENT_ID", ""),
        os.getenv("GOOGLE_ANDROID_CLIENT_ID", ""),
        os.getenv("EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID", ""),
        os.getenv("EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID", ""),
        os.getenv("GOOGLE_OAUTH_CLIENT_IDS", ""),
    ]
    return {
        candidate.strip()
        for value in values
        for candidate in str(value or "").split(",")
        if candidate.strip()
    }


def exchange_authorization_code(
    authorization_code: str,
    client_id: str,
    redirect_uri: str,
    code_verifier: str,
) -> dict[str, Any]:
    allowed_client_ids = configured_client_ids()
    if not allowed_client_ids or client_id not in allowed_client_ids:
        raise GoogleCalendarError("Google Calendar OAuth client is not configured on the server.")

    form = {
        "grant_type": "authorization_code",
        "code": authorization_code,
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "code_verifier": code_verifier,
    }
    web_client_id = (
        os.getenv("GOOGLE_CALENDAR_WEB_CLIENT_ID")
        or os.getenv("GOOGLE_WEB_CLIENT_ID")
        or os.getenv("EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID")
        or ""
    ).strip()
    if client_id == web_client_id:
        client_secret = os.getenv("GOOGLE_WEB_CLIENT_SECRET", "").strip()
        if not client_secret:
            raise GoogleCalendarError("The server is missing GOOGLE_WEB_CLIENT_SECRET for web calendar connections.")
        form["client_secret"] = client_secret

    request = urllib.request.Request(
        GOOGLE_TOKEN_ENDPOINT,
        data=urllib.parse.urlencode(form).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        try:
            reason = json.loads(body).get("error_description") or json.loads(body).get("error")
        except Exception:
            reason = None
        raise GoogleCalendarError(f"Google authorization failed{': ' + str(reason) if reason else '.'}", error.code) from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise GoogleCalendarError("Google authorization service is temporarily unavailable.") from error

    if not isinstance(payload, dict) or not payload.get("access_token"):
        raise GoogleCalendarError("Google did not return a calendar access token.")
    return payload


def google_api_request(
    path: str,
    access_token: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    query: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    url = f"{GOOGLE_CALENDAR_API}{path}"
    if query:
        url += "?" + urllib.parse.urlencode(query)
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
            **({"Content-Type": "application/json"} if data is not None else {}),
            **(headers or {}),
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
            return json.loads(raw.decode("utf-8")) if raw else {}
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        try:
            error_payload = json.loads(body)
            message = str((error_payload.get("error") or {}).get("message") or "").strip()
        except Exception:
            message = ""
        raise GoogleCalendarError(message or f"Google Calendar returned HTTP {error.code}.", error.code) from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise GoogleCalendarError("Google Calendar is temporarily unavailable.") from error


def get_google_email(access_token: str) -> str:
    request = urllib.request.Request(
        GOOGLE_USERINFO_ENDPOINT,
        headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as error:
        raise GoogleCalendarError("The selected Google account could not be verified.") from error
    email = str(payload.get("email") or "").strip().lower()
    if not email or payload.get("email_verified") is False:
        raise GoogleCalendarError("Google did not return a verified email address for this account.")
    return email


def encrypt_refresh_token(refresh_token: str) -> str:
    key = os.getenv("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY", "").strip()
    if not key:
        raise GoogleCalendarError("The server is missing GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY.")
    try:
        from cryptography.fernet import Fernet

        return Fernet(key.encode("ascii")).encrypt(refresh_token.encode("utf-8")).decode("ascii")
    except Exception as error:
        raise GoogleCalendarError("Google Calendar token encryption is not configured correctly.") from error


def decrypt_refresh_token(encrypted_token: str) -> str:
    key = os.getenv("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY", "").strip()
    if not key:
        raise GoogleCalendarError("The server is missing GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY.")
    try:
        from cryptography.fernet import Fernet

        return Fernet(key.encode("ascii")).decrypt(encrypted_token.encode("ascii")).decode("utf-8")
    except Exception as error:
        raise GoogleCalendarError("The saved Google Calendar connection cannot be decrypted.") from error


def refresh_access_token(client_id: str, refresh_token: str) -> str:
    form = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
    }
    web_client_id = (
        os.getenv("GOOGLE_CALENDAR_WEB_CLIENT_ID")
        or os.getenv("GOOGLE_WEB_CLIENT_ID")
        or os.getenv("EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID")
        or ""
    ).strip()
    if client_id == web_client_id:
        client_secret = os.getenv("GOOGLE_WEB_CLIENT_SECRET", "").strip()
        if not client_secret:
            raise GoogleCalendarError("The server is missing GOOGLE_WEB_CLIENT_SECRET for web calendar connections.")
        form["client_secret"] = client_secret
    request = urllib.request.Request(
        GOOGLE_TOKEN_ENDPOINT,
        data=urllib.parse.urlencode(form).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise GoogleCalendarError("Google Calendar authorization expired. Reconnect the partner calendar.", error.code) from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise GoogleCalendarError("Google authorization service is temporarily unavailable.") from error
    token = str(payload.get("access_token") or "")
    if not token:
        raise GoogleCalendarError("Google did not return a refreshed calendar access token.")
    return token


def stable_google_event_id(project_id: str) -> str:
    source = f"nvc:{project_id}"
    hash_value = 5381
    encoded_source = source.encode("utf-16-le")
    for index in range(0, len(encoded_source), 2):
        character_code = int.from_bytes(encoded_source[index:index + 2], "little")
        hash_value = ((hash_value << 5) + hash_value + character_code) & 0xFFFFFFFF
    project_id_length = len(project_id.encode("utf-16-le")) // 2
    return f"nvc{hash_value:x}{project_id_length:x}".lower()


def partner_calendar_event_properties(partner_user_id: str, project_id: str) -> dict[str, Any]:
    """Identify copies owned by this NVC partner, independently of their title."""
    return {
        "private": {
            "nvcManagedBy": "nvc-connect",
            "nvcSyncRole": "partner",
            "nvcSyncUserId": partner_user_id,
            "nvcProjectId": project_id,
        },
    }


def _is_legacy_generated_nvc_event(event: dict[str, Any], event_id: str) -> bool:
    """Match the old client export's stable ID, title prefix, and generated fields."""
    summary = str(event.get("summary") or "")
    description = str(event.get("description") or "")
    generated_markers = (
        (chr(0x1F4C2) + " Category: ", r"[^\n]+"),
        (chr(0x1F4CC) + " Status: ", r"[^\n]+"),
        (chr(0x1F465) + " Volunteers Needed: ", r"\d+(?:\n|$)"),
    )
    return bool(
        re.fullmatch(r"nvc[0-9a-f]{2,16}", event_id)
        and re.match(r"^\[(?:Event|Project)\] .+", summary)
        and all(
            re.search(r"(?:^|\n)" + re.escape(marker) + suffix, description)
            for marker, suffix in generated_markers
        )
    )


def is_stale_partner_calendar_event(
    event: dict[str, Any],
    partner_user_id: str,
    approved_project_ids: set[str],
    known_projects_by_event_id: dict[str, dict[str, Any]],
    linked_projects_by_event_id: dict[str, str],
    *,
    approved_event_ids: set[str] | None = None,
) -> bool:
    """Recognize a stale NVC copy without treating ordinary Google items as ours."""
    event_id = str(event.get("id") or "").strip()
    if not event_id or event.get("recurringEventId") or event.get("status") == "cancelled":
        return False
    allowed_event_ids = approved_event_ids
    if allowed_event_ids is None:
        allowed_event_ids = {stable_google_event_id(project_id) for project_id in approved_project_ids}
        allowed_event_ids.update(
            event_id for event_id, project_id in linked_projects_by_event_id.items()
            if project_id in approved_project_ids
        )
    if event_id in allowed_event_ids:
        # Newly approved items need not have a saved link yet.
        return False

    extended = event.get("extendedProperties")
    private = extended.get("private") if isinstance(extended, dict) else None
    private = private if isinstance(private, dict) else {}
    if any(str(key).startswith("nvc") for key in private):
        project_id = str(private.get("nvcProjectId") or "").strip()
        return (
            private.get("nvcManagedBy") == "nvc-connect"
            and private.get("nvcSyncRole") == "partner"
            and private.get("nvcSyncUserId") == partner_user_id
            and bool(project_id)
            and project_id not in approved_project_ids
            and event_id == stable_google_event_id(project_id)
        )

    linked_project_id = linked_projects_by_event_id.get(event_id)
    if linked_project_id:
        # A persisted link identifies legacy server exports that had no marker.
        return linked_project_id not in approved_project_ids

    if _is_legacy_generated_nvc_event(event, event_id):
        # A recognized NVC record can be removed when its proposal is no longer
        # approved, even if its event ID remains in the system's inventory.
        return True

    if event_id in known_projects_by_event_id:
        # An untagged copy of an existing record may belong to another role
        # sharing the Google account. Its original owner cannot be proven.
        return False

    summary = str(event.get("summary") or "")
    description = str(event.get("description") or "")

    # The old app added these exact generated lines. Combined with its stable
    # hash ID and title prefix, this also identifies copies of deleted records.
    # Old unlinked server exports with only a free-form description are ambiguous.
    return bool(
        re.fullmatch(r"nvc[0-9a-f]{2,16}", event_id)
        and re.match(r"^\[(?:Event|Project)\] .+", summary)
        and re.search(r"(?:^|\n)📂 Category: [^\n]+", description)
        and re.search(r"(?:^|\n)📌 Status: [^\n]+", description)
        and re.search(r"(?:^|\n)👥 Volunteers Needed: \d+(?:\n|$)", description)
    )


def _date_only(value: str) -> str:
    return value[:10]


def _add_days(value: str, days: int) -> str:
    try:
        return (date.fromisoformat(_date_only(value)) + timedelta(days=days)).isoformat()
    except ValueError:
        return value


def _event_repeat(project: dict[str, Any]) -> str:
    value = str(project.get("repeat") or project.get("repeatRule") or project.get("repeat_rule") or "").strip().lower()
    return {"daily": "Daily", "weekly": "Weekly", "monthly": "Monthly"}.get(value, "Does not repeat")


def _parse_datetime(value: str, time_zone: str | None = None) -> datetime:
    """Interpret stored wall times in the configured calendar zone, never the host zone."""
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo(time_zone or project_timezone()))
    return parsed


def _google_datetime(value: str) -> dict[str, str]:
    if "T" in value:
        parsed = _parse_datetime(value).astimezone(ZoneInfo(project_timezone()))
        return {"dateTime": parsed.isoformat(), "timeZone": project_timezone()}
    return {"date": date.fromisoformat(_date_only(value)).isoformat()}


def project_timezone() -> str:
    return os.getenv("GOOGLE_CALENDAR_TIME_ZONE", "Asia/Manila").strip() or "Asia/Manila"


def _recurrence_rule(project: dict[str, Any]) -> list[str]:
    if not bool(project.get("isEvent") or project.get("is_event")):
        return []
    repeat = _event_repeat(project)
    frequencies = {"Daily": "DAILY", "Weekly": "WEEKLY", "Monthly": "MONTHLY"}
    frequency = frequencies.get(repeat)
    if not frequency:
        return []
    start_value, end_value = project_schedule(project)
    is_all_day = "T" not in start_value and "T" not in end_value
    rule = f"FREQ={frequency}"
    if repeat == "Monthly":
        try:
            day = (
                _parse_datetime(start_value).astimezone(ZoneInfo(project_timezone())).day
                if "T" in start_value else date.fromisoformat(_date_only(start_value)).day
            )
            rule += f";BYMONTHDAY={day},-1;BYSETPOS=1" if day > 28 else f";BYMONTHDAY={day}"
        except ValueError:
            pass
    if is_all_day:
        until = _date_only(end_value).replace("-", "")
    else:
        try:
            calendar_zone = ZoneInfo(project_timezone())
            start = _parse_datetime(start_value).astimezone(calendar_zone)
            series_end = _parse_datetime(end_value).astimezone(calendar_zone)
            # UNTIL bounds occurrence starts. Using the end clock can exclude
            # the final day of an overnight event.
            final_start = datetime.combine(series_end.date(), start.timetz(), tzinfo=calendar_zone)
            until = final_start.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        except ValueError:
            return []
    return [f"RRULE:{rule};UNTIL={until}"]


def format_project_as_google_event(project: dict[str, Any]) -> dict[str, Any]:
    start_value = str(project.get("startDate") or project.get("start_date") or "")
    end_value = str(project.get("endDate") or project.get("end_date") or start_value)
    if not start_value or not end_value:
        raise GoogleCalendarError("The linked event has no valid start and end schedule.")
    is_all_day = "T" not in start_value and "T" not in end_value
    is_recurring = bool(project.get("isEvent") or project.get("is_event")) and _event_repeat(project) != "Does not repeat"
    if ("T" in start_value) != ("T" in end_value):
        raise GoogleCalendarError("The linked schedule mixes all-day dates and timed dates.")
    try:
        calendar_zone = ZoneInfo(project_timezone())
        if is_all_day:
            if date.fromisoformat(_date_only(end_value)) < date.fromisoformat(_date_only(start_value)):
                raise ValueError("Schedule ends before it starts")
        else:
            start = _parse_datetime(start_value).astimezone(calendar_zone)
            series_end = _parse_datetime(end_value).astimezone(calendar_zone)
            invalid_order = series_end.date() < start.date() if is_recurring else series_end <= start
            if invalid_order:
                raise ValueError("Schedule ends before it starts")
        event_start = _google_datetime(start_value)
    except ValueError as error:
        raise GoogleCalendarError("The linked event has no valid start and end schedule.") from error
    if is_recurring and is_all_day:
        event_end = {"date": _add_days(start_value, 1)}
    elif is_recurring:
        try:
            occurrence_end = start.replace(
                hour=series_end.hour,
                minute=series_end.minute,
                second=series_end.second,
                microsecond=series_end.microsecond,
            )
            if occurrence_end <= start:
                occurrence_end += timedelta(days=1)
            event_end = {"dateTime": occurrence_end.isoformat(), "timeZone": project_timezone()}
        except ValueError:
            event_end = _google_datetime(end_value)
    elif is_all_day:
        event_end = {"date": _add_days(end_value, 1)}
    else:
        event_end = _google_datetime(end_value)

    location = project.get("location") if isinstance(project.get("location"), dict) else {}
    location_parts = [
        str(value).strip()
        for value in (
            location.get("address"),
            project.get("locationVenue"),
            project.get("locationCity"),
            project.get("locationRegion"),
        )
        if str(value or "").strip()
    ]
    description = str(project.get("description") or "")
    body: dict[str, Any] = {
        "summary": f"[{'Event' if project.get('isEvent') or project.get('is_event') else 'Project'}] {str(project.get('title') or 'NVC schedule')}",
        "description": description,
        "start": event_start,
        "end": event_end,
    }
    if location_parts:
        body["location"] = ", ".join(location_parts)
    else:
        body["location"] = ""
    recurrence = _recurrence_rule(project)
    if recurrence:
        body["recurrence"] = recurrence
    return body


def project_schedule(project: dict[str, Any]) -> tuple[str, str]:
    start = str(project.get("startDate") or project.get("start_date") or "")
    end = str(project.get("endDate") or project.get("end_date") or start)
    return start, end


def schedule_from_google_event(
    event: dict[str, Any],
    project: dict[str, Any],
) -> tuple[str, str] | None:
    """Read supported series dates and times without importing recurrence changes.

    NVC stores an inclusive series end date and an occurrence's end clock in
    ``endDate``. Google stores the first occurrence's end and a separate UNTIL
    bound. These values must be combined so editing the daily end time is not
    lost. Individual occurrence exceptions cannot be represented by this model.
    """
    if event.get("recurringEventId") or str(event.get("status") or "") == "cancelled":
        return None
    start = event.get("start") if isinstance(event.get("start"), dict) else {}
    end = event.get("end") if isinstance(event.get("end"), dict) else {}
    start_value = str(start.get("dateTime") or start.get("date") or "").strip()
    end_value = str(end.get("dateTime") or end.get("date") or "").strip()
    if not start_value or not end_value:
        return None

    is_all_day = bool(start.get("date"))
    if is_all_day != bool(end.get("date")):
        return None
    recurrence = event.get("recurrence") or []
    expected_repeat = _event_repeat(project) if bool(project.get("isEvent") or project.get("is_event")) else "Does not repeat"
    expected_frequency = {"Daily": "DAILY", "Weekly": "WEEKLY", "Monthly": "MONTHLY"}.get(expected_repeat)
    if bool(recurrence) != bool(expected_frequency):
        # Adding/removing a repeat rule is outside dates-and-times-only sync.
        return None

    try:
        calendar_zone = ZoneInfo(project_timezone())
        if is_all_day:
            start_date = date.fromisoformat(start_value)
            occurrence_end_date = date.fromisoformat(end_value)
            if occurrence_end_date <= start_date:
                return None
            start_result = start_date.isoformat()
        else:
            start_time = _parse_datetime(start_value, str(start.get("timeZone") or project_timezone())).astimezone(calendar_zone)
            end_time = _parse_datetime(end_value, str(end.get("timeZone") or start.get("timeZone") or project_timezone())).astimezone(calendar_zone)
            if end_time <= start_time:
                return None
            start_date = start_time.date()
            start_result = start_time.isoformat(timespec="seconds")

        if not recurrence:
            if is_all_day:
                # Google's final all-day date is exclusive; NVC's is inclusive.
                return start_result, (occurrence_end_date - timedelta(days=1)).isoformat()
            return start_result, end_time.isoformat(timespec="seconds")

        if not isinstance(recurrence, list) or len(recurrence) != 1:
            return None
        rule = str(recurrence[0]).upper()
        if not rule.startswith("RRULE:"):
            return None
        parts = dict(part.split("=", 1) for part in rule[6:].split(";") if "=" in part)
        if parts.get("FREQ") != expected_frequency or parts.get("INTERVAL", "1") != "1":
            return None
        # NVC has no representation for custom occurrence sets or COUNT limits.
        allowed_parts = {"FREQ", "UNTIL", "INTERVAL", "WKST"}
        if expected_frequency == "WEEKLY":
            allowed_parts.add("BYDAY")
            weekday = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")[start_date.weekday()]
            if parts.get("BYDAY", weekday) != weekday:
                return None
        elif expected_frequency == "MONTHLY":
            allowed_parts.update({"BYMONTHDAY", "BYSETPOS"})
            month_days = parts.get("BYMONTHDAY", str(start_date.day))
            if month_days not in {str(start_date.day), f"{start_date.day},-1"}:
                return None
            if parts.get("BYSETPOS", "1") != "1":
                return None
        if set(parts) - allowed_parts:
            return None
        if is_all_day and (occurrence_end_date - start_date).days != 1:
            return None
        if not is_all_day and end_time - start_time > timedelta(days=1):
            return None

        until_value = parts.get("UNTIL", "")
        if re.fullmatch(r"\d{8}", until_value):
            final_date = datetime.strptime(until_value, "%Y%m%d").date()
        elif re.fullmatch(r"\d{8}T\d{6}Z", until_value):
            until = datetime.strptime(until_value, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
            final_date = until.astimezone(calendar_zone).date()
        elif until_value:
            return None
        else:
            _, previous_end = project_schedule(project)
            final_date = (
                _parse_datetime(previous_end).astimezone(calendar_zone).date()
                if "T" in previous_end else date.fromisoformat(previous_end[:10])
            )
        if final_date < start_date:
            return None
        if is_all_day:
            return start_result, final_date.isoformat()
        # Preserve the Google occurrence end clock even when UNTIL still holds
        # the old end time after an edit to the entire recurring series.
        final_end = datetime.combine(final_date, end_time.timetz(), tzinfo=calendar_zone)
        return start_result, final_end.isoformat(timespec="seconds")
    except (ValueError, TypeError, ZoneInfoNotFoundError):
        return None


def normalize_schedule_value(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if "T" not in text:
        return text[:10]
    try:
        return _parse_datetime(text).astimezone(timezone.utc).isoformat(timespec="seconds")
    except (ValueError, ZoneInfoNotFoundError):
        return text
