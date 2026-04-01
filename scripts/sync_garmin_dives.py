#!/usr/bin/env python3
import os
import json
import time
from datetime import date, timedelta
from typing import Any

from garminconnect import Garmin, GarminConnectConnectionError, GarminConnectTooManyRequestsError
import requests

PAYLOAD_URL = os.getenv("PAYLOAD_URL")
GARMIN_EMAIL = os.getenv("GARMIN_EMAIL")
GARMIN_PASSWORD = os.getenv("GARMIN_PASSWORD")
# Long base64 session from Garth (see python-garminconnect / GARMINTOKENS). Avoids SSO on every run.
GARMINTOKENS = os.getenv("GARMINTOKENS", "").strip()
# Path to a file where the garth session is cached between CI runs (written after each successful sync).
GARMIN_SESSION_FILE = os.getenv("GARMIN_SESSION_FILE", "")
PAYLOAD_USER_EMAIL = os.getenv("PAYLOAD_USER_EMAIL")
PAYLOAD_USER_PASSWORD = os.getenv("PAYLOAD_USER_PASSWORD")

_payload_token_cache: str | None = None


def get_payload_token() -> str:
    """
    Logs into your Payload API and caches the JWT.
    """
    global _payload_token_cache
    if _payload_token_cache is not None:
        return _payload_token_cache

    if not PAYLOAD_USER_EMAIL or not PAYLOAD_USER_PASSWORD:
        raise RuntimeError("PAYLOAD_USER_EMAIL and PAYLOAD_USER_PASSWORD must be set")

    if not PAYLOAD_URL:
        raise RuntimeError("PAYLOAD_URL must be set")

    resp = requests.post(
        f"{PAYLOAD_URL}/users/login",
        headers={"Content-Type": "application/json"},
        data=json.dumps(
            {
                "email": PAYLOAD_USER_EMAIL,
                "password": PAYLOAD_USER_PASSWORD,
            }
        ),
        timeout=15,
    )
    resp.raise_for_status()
    token = resp.json().get("token")
    if not token:
        raise RuntimeError("No token returned from Payload login response")
    _payload_token_cache = token
    return token


def payload_headers() -> dict[str, str]:
    token = get_payload_token()
    return {
        "Authorization": f"JWT {token}",
        "Content-Type": "application/json",
    }


def get_last_synced_start_time() -> str | None:
    """Get the most recent dive we’ve stored in Payload."""
    if not PAYLOAD_URL:
        raise RuntimeError("PAYLOAD_URL must be set")

    resp = requests.get(
        f"{PAYLOAD_URL}/garmin-dives",
        params={"limit": 1, "sort": "-startTimeGMT"},
        headers=payload_headers(),
        timeout=60,
    )
    resp.raise_for_status()
    docs = resp.json().get("docs", [])
    if not docs:
        return None
    return docs[0]["startTimeGMT"]  # ISO string


def _cm_to_m(value: Any) -> float | None:
    """Garmin dive depth fields are commonly in centimetres (cm). Convert to metres (m)."""
    if value is None:
        return None
    try:
        return float(value) / 100.0
    except (TypeError, ValueError):
        return None


def _ms_to_s(value: Any) -> float | None:
    """Convert milliseconds to seconds."""
    if value is None:
        return None
    try:
        return float(value) / 1000.0
    except (TypeError, ValueError):
        return None


def _pick_duration_seconds(activity: dict) -> float | None:
    """
    Garmin dive activities often have multiple 'time' fields:
      - duration / elapsedDuration: total elapsed seconds (incl. pauses)
      - bottomTime: commonly matches what Garmin shows as dive duration in the app (moving/bottom time)

    We'll prefer bottomTime if present, otherwise fall back to duration.
    """
    for key in ("bottomTime", "movingDuration", "duration", "elapsedDuration"):
        val = activity.get(key)
        if val is None:
            continue
        try:
            return float(val)
        except (TypeError, ValueError):
            continue
    return None


def extract_gases(activity: dict) -> list[dict]:
    gases = (
        activity.get("summarizedDiveInfo", {})
        .get("summarizedDiveGases", [])
    )

    result: list[dict] = []
    for gas in gases:
        oxygen = gas.get("oxygenContent")
        if oxygen is None:
            continue

        helium = gas.get("heliumContent")
        if helium is None:
            helium = 0  # treat missing helium as 0%

        result.append(
            {
                "oxygenPercent": oxygen,
                "heliumPercent": helium,
            }
        )

    return result


def extract_temperature(activity: dict) -> dict:
    return {
        "min": activity.get("minTemperature"),
        "max": activity.get("maxTemperature"),
    }


def extract_coordinates(activity: dict) -> dict:
    return {
        "latitude": activity.get("startLatitude"),
        "longitude": activity.get("startLongitude"),
    }


def transform_garmin_dive(activity: dict) -> dict | None:
    """
    Transform raw Garmin activity payload into the shape you want to store.
    Returns None if required fields are missing.

    Conversions applied:
      - durationSeconds: prefer bottomTime (seconds), else duration (seconds)
      - maxDepthMeters/avgDepthMeters: cm -> m
      - surfaceIntervalSeconds: ms -> s
    """
    start_local = activity.get("startTimeLocal")
    start_gmt = activity.get("startTimeGMT")
    if not start_local or not start_gmt:
        print('Skipping activity without proper timestamps: ', activity)
        # Skip activities without proper timestamps
        return None

    duration_seconds = _pick_duration_seconds(activity)

    data = {
        "garminActivityId": str(activity["activityId"]),
        "title": activity.get("activityName"),
        "durationSeconds": duration_seconds,
        "maxDepthMeters": _cm_to_m(activity.get("maxDepth")),
        "avgDepthMeters": _cm_to_m(activity.get("avgDepth")),
        "surfaceIntervalSeconds": _ms_to_s(activity.get("surfaceInterval")),
        "gases": extract_gases(activity),
        "location": activity.get("locationName"),
        "temperature": extract_temperature(activity),
        "coordinates": extract_coordinates(activity),
        "startTimeLocal": start_local,
        "startTimeGMT": start_gmt,
        "diveType": "recreational",
    }
    return data


def save_dive_to_payload(activity: dict) -> None:
    data = transform_garmin_dive(activity)
    if data is None:
        return

    resp = requests.post(
        f"{PAYLOAD_URL}/garmin-dives",
        headers=payload_headers(),
        data=json.dumps(data),
        timeout=60,
    )

    if resp.status_code in (200, 201):
        return

    # Ignore duplicate-key failures on garminActivityId
    if resp.status_code == 400 and "Value must be unique" in resp.text:
        return

    print("Payload returned error:", resp.status_code, resp.text)
    resp.raise_for_status()


# Retry delays (seconds) for Garmin 429 / timeout errors.
# Garmin rate-limits CI IP ranges on both the SSO and OAuth2 exchange endpoints.
# Delays are intentionally long — the exchange endpoint can stay blocked for 15+ minutes.
_SSO_RETRY_DELAYS = [300, 600, 900, 1200]   # 5 min, 10 min, 15 min, 20 min
_API_RETRY_DELAYS = [300, 600, 900]          # 5 min, 10 min, 15 min

# Exception types that indicate a transient Garmin-side block worth retrying.
_GARMIN_TRANSIENT_ERRORS = (GarminConnectTooManyRequestsError, GarminConnectConnectionError)


def _load_session_tokens() -> str:
    """
    Return a serialised garth session string, checking in priority order:
      1. GARMIN_SESSION_FILE  — written back after each successful run (CI cache)
      2. GARMINTOKENS env var — long-lived secret set manually
    Returns an empty string if neither source has usable data.
    """
    if GARMIN_SESSION_FILE and os.path.exists(GARMIN_SESSION_FILE):
        data = open(GARMIN_SESSION_FILE).read().strip()
        if len(data) > 512:
            print("Loaded Garmin session from cache file")
            return data
    return GARMINTOKENS


def _save_session_tokens(client: Garmin) -> None:
    """Persist the (potentially refreshed) garth session for the next run."""
    if not GARMIN_SESSION_FILE:
        return
    with open(GARMIN_SESSION_FILE, "w") as f:
        f.write(client.garth.dumps())
    print("Garmin session saved for next run")


def _create_garmin_client() -> Garmin:
    """
    Authenticate against Garmin Connect, trying in order:
      1. Cached / secret garth session (no SSO required)
      2. Email + password SSO login with exponential backoff on 429
    """
    tokens = _load_session_tokens()
    has_token = len(tokens) > 512
    has_password = bool(GARMIN_EMAIL and GARMIN_PASSWORD)

    if not has_token and not has_password:
        raise RuntimeError(
            "Provide GARMIN_EMAIL + GARMIN_PASSWORD, or set GARMINTOKENS to a Garth "
            "session string (run garmin.garth.dumps() locally after one successful login)."
        )

    if has_token:
        client = Garmin()
        client.garth.loads(tokens)
        return client

    # SSO login — only reached when no cached/secret token is available.
    # This will 429 from shared CI IPs but should succeed after backing off.
    last_exc: Exception | None = None
    for attempt, delay in enumerate([0] + _SSO_RETRY_DELAYS):
        if delay:
            print(
                f"SSO rate limited — waiting {delay}s before retry "
                f"({attempt}/{len(_SSO_RETRY_DELAYS)})..."
            )
            time.sleep(delay)
        try:
            client = Garmin(GARMIN_EMAIL, GARMIN_PASSWORD)
            client.login()
            return client
        except _GARMIN_TRANSIENT_ERRORS as exc:
            print(f"SSO failed (attempt {attempt + 1}): {exc}")
            last_exc = exc

    raise last_exc  # type: ignore[misc]


def _get_activities_with_retry(client: Garmin, start: date, end: date) -> list:
    """
    Fetch activities, retrying on 429.
    The first call may trigger an OAuth2 refresh which can itself be rate-limited
    on CI IP ranges; backing off long enough for the window to reset is the fix.
    """
    last_exc: Exception | None = None
    for attempt, delay in enumerate([0] + _API_RETRY_DELAYS):
        if delay:
            print(
                f"Rate limited by Garmin — waiting {delay}s before retry "
                f"({attempt}/{len(_API_RETRY_DELAYS)})..."
            )
            time.sleep(delay)
        try:
            return client.get_activities_by_date(
                start.strftime("%Y-%m-%d"),
                end.strftime("%Y-%m-%d"),
            )
        except _GARMIN_TRANSIENT_ERRORS as exc:
            print(f"Garmin request failed (attempt {attempt + 1}): {exc}")
            last_exc = exc

    raise last_exc  # type: ignore[misc]


def main() -> None:
    print("Starting Garmin dive sync")

    if not PAYLOAD_URL:
        raise RuntimeError("PAYLOAD_URL must be set")

    # 1. Authenticate (prefers cached session → secret token → SSO with retry).
    client = _create_garmin_client()

    # 2. Decide date range: from last synced startTimeGMT (or some default) up to today
    last_start = get_last_synced_start_time()
    if last_start:
        # Re-sync the last 2 days in case of missed records
        print(f"Last synced dive: {last_start}")
        start_date = date.fromisoformat(last_start[:10]) - timedelta(days=2)
    else:
        # First-time import: last 365 days (adjust as you like)
        days = 780
        print(f"No last synced dive found, syncing all dives from the last {days} days")
        start_date = date.today() - timedelta(days=days)

    end_date = date.today()

    print(f"Syncing dives from {start_date} to {end_date}")

    activities = _get_activities_with_retry(client, start_date, end_date)

    # 3. Persist the (potentially refreshed) session so the next CI run reuses it.
    _save_session_tokens(client)

    # 4. Filter scuba diving activities and push to Payload
    print(f"Found {len(activities)} activities")
    print("Looping through activities and filtering for diving activities")

    for act in activities:
        activity_type = (act.get("activityType", {}) or {}).get("typeKey", "").lower()
        if "diving" not in activity_type:
            continue
        save_dive_to_payload(act)


if __name__ == "__main__":
    main()
