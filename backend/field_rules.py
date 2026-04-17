import re
from typing import Any


EMAIL_MAX_LENGTH = 254
NAME_MAX_LENGTH = 120
PHONE_MOBILE_LOCAL_LENGTH = 11


def digits_only(value: Any) -> str:
    return "".join(character for character in str(value or "") if character.isdigit())


def normalize_comparable_phone(value: Any) -> str:
    digits = digits_only(value)
    if re.fullmatch(r"09\d{9}", digits):
        return f"63{digits[1:]}"
    if re.fullmatch(r"639\d{9}", digits):
        return digits
    if re.fullmatch(r"0\d{9,11}", digits):
        return f"63{digits[1:]}"
    if re.fullmatch(r"63\d{9,11}", digits):
        return digits
    return digits


def normalize_email(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    if not normalized:
        return None
    return normalized[:EMAIL_MAX_LENGTH]


def is_valid_email(value: Any) -> bool:
    normalized = normalize_email(value)
    if not normalized:
        return False
    return bool(re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized))


def normalize_name(value: Any) -> str:
    return str(value or "").strip()[:NAME_MAX_LENGTH]


def normalize_ph_mobile_phone(value: Any) -> str | None:
    digits = digits_only(value)
    if re.fullmatch(r"09\d{9}", digits):
        return digits
    if re.fullmatch(r"639\d{9}", digits):
        return f"0{digits[2:]}"
    return None


def normalize_ph_contact_phone(value: Any) -> str | None:
    normalized_mobile = normalize_ph_mobile_phone(value)
    if normalized_mobile:
        return normalized_mobile

    digits = digits_only(value)
    if re.fullmatch(r"63\d{9,11}", digits):
        return f"+{digits}"
    if re.fullmatch(r"0\d{9,11}", digits):
        return f"+63{digits[1:]}"
    return None


def clamp_non_negative_int(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def clamp_non_negative_float(value: Any) -> float:
    try:
        return max(0.0, float(value or 0))
    except (TypeError, ValueError):
        return 0.0


def clamp_rating(value: Any) -> float:
    try:
        numeric_value = float(value or 0)
    except (TypeError, ValueError):
        numeric_value = 0.0
    return min(5.0, max(0.0, numeric_value))


def sanitize_hot_storage_item(key: str, item: dict[str, Any]) -> dict[str, Any]:
    sanitized = dict(item)

    if key == "users":
        sanitized["email"] = normalize_email(item.get("email"))
        sanitized["name"] = normalize_name(item.get("name"))
        sanitized["phone"] = normalize_ph_mobile_phone(item.get("phone"))
        return sanitized

    if key == "partners":
        raw_category = str(item.get("category") or "").strip()
        normalized_category = "Disaster" if raw_category == "Other" else raw_category
        sanitized["contactEmail"] = normalize_email(item.get("contactEmail"))
        sanitized["name"] = normalize_name(item.get("name"))
        sanitized["contactPhone"] = normalize_ph_contact_phone(item.get("contactPhone"))
        sanitized["category"] = normalized_category or None
        sanitized["dswdAccreditationNo"] = str(item.get("dswdAccreditationNo") or "").strip().upper()[:60]
        sanitized["secRegistrationNo"] = str(item.get("secRegistrationNo") or "").strip().upper()[:60] or None
        return sanitized

    if key == "volunteers":
        sanitized["email"] = normalize_email(item.get("email"))
        sanitized["name"] = normalize_name(item.get("name"))
        sanitized["phone"] = normalize_ph_mobile_phone(item.get("phone"))
        sanitized["totalHoursContributed"] = clamp_non_negative_float(item.get("totalHoursContributed"))
        sanitized["rating"] = clamp_rating(item.get("rating"))
        return sanitized

    if key == "projects":
        sanitized["volunteersNeeded"] = clamp_non_negative_int(item.get("volunteersNeeded"))
        return sanitized

    if key == "volunteerMatches":
        sanitized["hoursContributed"] = clamp_non_negative_float(item.get("hoursContributed"))
        return sanitized

    if key == "partnerReports":
        sanitized["impactCount"] = clamp_non_negative_int(item.get("impactCount"))
        return sanitized

    return sanitized
