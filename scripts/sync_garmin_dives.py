#!/usr/bin/env python3
import os
import json
from datetime import date, timedelta
from typing import Any

import garth  # noqa: F401  # imported because garminconnect uses it under the hood
from garminconnect import Garmin
import requests

PAYLOAD_URL = os.getenv("PAYLOAD_URL")
GARMIN_EMAIL = os.getenv("GARMIN_EMAIL")
GARMIN_PASSWORD = os.getenv("GARMIN_PASSWORD")
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
        activity
        .get("summarizedDiveInfo", {})
        .get("summarizedDiveGases", [])
    )

    return [
        {
            "oxygenPercent": gas.get("oxygenContent"),
            "heliumPercent": gas.get("heliumContent"),
        }
        for gas in gases
        if gas.get("oxygenContent") is not None
    ]

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

def transform_garmin_dive(activity: dict) -> dict:
    """
    Transform raw Garmin activity payload into the shape you want to store.

    Conversions applied:
      - durationSeconds: prefer bottomTime (seconds), else duration (seconds)
      - maxDepthMeters/avgDepthMeters: cm -> m
      - surfaceIntervalSeconds: ms -> s
    """
    duration_seconds = _pick_duration_seconds(activity)

    data = {
        "garminActivityId": str(activity["activityId"]),
        "title": activity.get("activityName"),
        # Store seconds in seconds (Garmin gives seconds as float)
        "durationSeconds": duration_seconds,
        # Depth fields are in cm -> convert to metres
        "maxDepthMeters": _cm_to_m(activity.get("maxDepth")),
        "avgDepthMeters": _cm_to_m(activity.get("avgDepth")),
        # Surface interval is ms -> convert to seconds
        "surfaceIntervalSeconds": _ms_to_s(activity.get("surfaceInterval")),
        "gases": extract_gases(activity),
        "location": activity.get("locationName"),
        "temperature": extract_temperature(activity),
        "coordinates": extract_coordinates(activity),
        "startTimeLocal": activity.get("startTimeLocal"),
	      "startTimeGMT": activity.get("startTimeGMT"),
        # Keep the original payload for debugging / backfills
    }
    return data


def save_dive_to_payload(activity: dict) -> None:
    data = transform_garmin_dive(activity)

    resp = requests.post(
        f"{PAYLOAD_URL}/garmin-dives",
        headers=payload_headers(),
        data=json.dumps(data),
        timeout=60,
    )

    # Ignore 409 / duplicate errors if unique index is hit
    if resp.status_code not in (200, 201, 409):
        resp.raise_for_status()


def main() -> None:
    print("Starting Garmin dive sync")

    # 1. Authenticate with Garmin via python-garminconnect
    client = Garmin(GARMIN_EMAIL, GARMIN_PASSWORD)
    client.login()  # uses garth under the hood

    # 2. Decide date range: from last synced startTimeGMT (or some default) up to today
    last_start = get_last_synced_start_time()
    if last_start:
        # Re-sync the last 2 days in case of missed records
        start_date = date.fromisoformat(last_start[:10]) - timedelta(days=2)
    else:
        # First-time import: last 365 days (adjust as you like)
        start_date = date.today() - timedelta(days=365)

    end_date = date.today()

    activities = client.get_activities_by_date(
        start_date.strftime("%Y-%m-%d"),
        end_date.strftime("%Y-%m-%d"),
    )

    # 3. Filter scuba diving activities and push to Payload
    print(f"Found {len(activities)} activities")
    print("Looping through activities and filtering for diving activities")

    for act in activities:
        activity_type = (act.get("activityType", {}) or {}).get("typeKey", "").lower()
        if "diving" not in activity_type:
            continue
        save_dive_to_payload(act)


if __name__ == "__main__":
    main()
