#!/usr/bin/env python3
import os
import json
from datetime import date, timedelta
from typing import Any

import garth
from garminconnect import Garmin
import requests

try:
    from garmin_fit_sdk import Decoder, Stream
except ImportError:  # pragma: no cover - optional dependency
    Decoder = None
    Stream = None

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


PRESSURE_FIELD_CANDIDATES = (
    "tank_pressure",
    "cylinder_pressure",
    "gas_pressure",
    "absolute_pressure",
)


def _download_fit_activity(client: Garmin, activity_id: int) -> bytes | None:
    if Decoder is None or Stream is None:
        raise RuntimeError(
            "garmin-fit-sdk is required to parse FIT files. Install with `pip install garmin-fit-sdk`."
        )

    try:
        return client.download_activity(
            activity_id,
            dl_fmt=client.ActivityDownloadFormat.FIT,
        )
    except Exception as exc:
        print(f"Failed to download FIT for activity {activity_id}: {exc}")
        return None


def _extract_cylinder_pressures(fit_blob: bytes) -> tuple[float | None, float | None]:
    try:
        stream = Stream.from_bytes(fit_blob)
        decoder = Decoder(stream)
        messages, errors = decoder.read()
    except Exception as exc:  # pragma: no cover - defensive
        print(f"Unable to decode FIT data: {exc}")
        return None, None

    if errors:
        print(f"FIT decode warnings: {errors}")

    start_pressure: float | None = None
    end_pressure: float | None = None

    for message in messages:
        if message.name != "record":
            continue

        fields = {field.name: field.value for field in message.fields}
        for developer_field in message.developer_fields:
            name = developer_field.name
            if name:
                fields.setdefault(name, developer_field.value)

        pressure_value = next(
            (fields.get(key) for key in PRESSURE_FIELD_CANDIDATES if fields.get(key) is not None),
            None,
        )

        if pressure_value is None:
            continue

        try:
            pressure_float = float(pressure_value)
        except (TypeError, ValueError):
            continue

        if start_pressure is None:
            start_pressure = pressure_float
        end_pressure = pressure_float

    return start_pressure, end_pressure


def fetch_fit_metrics(client: Garmin, activity: dict) -> dict:
    activity_id = activity.get("activityId")
    if activity_id is None:
        return {}

    fit_data = _download_fit_activity(client, int(activity_id))
    print(f"Fit data for activity {activity_id}: {fit_data}")
    if not fit_data:
        return {}

    start_pressure, end_pressure = _extract_cylinder_pressures(fit_data)
    if start_pressure is None and end_pressure is None:
        return {}

    return {
        "cylinderPressure": {
            "start": start_pressure,
            "end": end_pressure,
        }
    }


def save_dive_to_payload(activity: dict, extra_fields: dict | None = None) -> None:
    data = transform_garmin_dive(activity)
    if data is None:
        return

    if extra_fields:
        data.update(extra_fields)

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


def main() -> None:
    print("Starting Garmin dive sync")

    if not GARMIN_EMAIL or not GARMIN_PASSWORD:
        raise RuntimeError("GARMIN_EMAIL and GARMIN_PASSWORD must be set")

    if not PAYLOAD_URL:
        raise RuntimeError("PAYLOAD_URL must be set")

    # 1. Authenticate with Garmin via python-garminconnect
    client = Garmin(GARMIN_EMAIL, GARMIN_PASSWORD)
    client.login()  # uses garth under the hood

    # 2. Decide date range: from last synced startTimeGMT (or some default) up to today
    last_start = get_last_synced_start_time()
    if last_start:
        # Re-sync the last 2 days in case of missed records
        print(f"Last synced dive: {last_start}")
        start_date = date.fromisoformat(last_start[:10]) - timedelta(days=2)
    else:
        # First-time import: last 365 days (adjust as you like)
        days=50
        print(f"No last synced dive found, syncing all dives from the last {days} days")
        start_date = date.today() - timedelta(days=days)

    end_date = date.today()

    print(f"Syncing dives from {start_date} to {end_date}")

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
        extra_fields = {}
        try:
            extra_fields = fetch_fit_metrics(client, act)
        except RuntimeError as exc:
            print(f"Skipping FIT metrics: {exc}")
        save_dive_to_payload(act, extra_fields)


if __name__ == "__main__":
    main()
