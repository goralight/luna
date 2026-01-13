#!/usr/bin/env python3
import os
import json
from datetime import date, timedelta

import garth
from garminconnect import Garmin
import requests

PAYLOAD_URL = os.getenv("PAYLOAD_URL", "https://your-host/api")
GARMIN_EMAIL = os.getenv("GARMIN_EMAIL")
GARMIN_PASSWORD = os.getenv("GARMIN_PASSWORD")
PAYLOAD_USER_EMAIL = os.getenv("PAYLOAD_USER_EMAIL")
PAYLOAD_USER_PASSWORD = os.getenv("PAYLOAD_USER_PASSWORD")


def get_payload_token() -> str:
    """Log into Payload and return a fresh JWT."""
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
    body = resp.json()
    token = body.get("token")
    if not token:
        raise RuntimeError("No token returned from Payload login response")
    return token


def payload_headers() -> dict:
    token = get_payload_token()
    return {
        "Authorization": f"JWT {token}",
        "Content-Type": "application/json",
    }


def get_last_synced_start_time():
    """Get the most recent dive we’ve stored in Payload."""
    resp = requests.get(
        f"{PAYLOAD_URL}/garmin-dives",
        params={"limit": 1, "sort": "-startTime"},
        headers=payload_headers(),
        timeout=15,
    )
    resp.raise_for_status()
    docs = resp.json().get("docs", [])
    if not docs:
        return None
    return docs[0]["startTime"]  # ISO string


def save_dive_to_payload(activity: dict) -> None:
    data = {
        "garminActivityId": str(activity["activityId"]),
        "title": activity.get("activityName"),
        "startTime": activity.get("startTimeLocal") or activity.get("startTimeGMT"),
        "durationSeconds": activity.get("duration"),
        "maxDepthMeters": activity.get("maxDepth"),  # adjust field names to Garmin’s payload
        "location": activity.get("locationName"),
        "raw": activity,
    }
    resp = requests.post(
        f"{PAYLOAD_URL}/garmin-dives",
        headers=payload_headers(),
        data=json.dumps(data),
        timeout=15,
    )
    # Ignore 409 / duplicate errors if unique index is hit
    if resp.status_code not in (200, 201, 409):
        resp.raise_for_status()


def main() -> None:
    # 1. Authenticate with Garmin via python-garminconnect
    client = Garmin(GARMIN_EMAIL, GARMIN_PASSWORD)
    client.login()  # uses garth under the hood

    # 2. Decide date range: from last synced startTime (or some default) up to today
    last_start = get_last_synced_start_time()
    if last_start:
        # Re-sync the last 2 days in case of missed records
        start_date = (date.fromisoformat(last_start[:10]) - timedelta(days=2))
    else:
        # First-time import: last 90 days, or however far back you want
        start_date = date.today() - timedelta(days=400)

    end_date = date.today()

    activities = client.get_activities_by_date(
        start_date.strftime("%Y-%m-%d"),
        end_date.strftime("%Y-%m-%d"),
    )

    # 3. Filter scuba diving activities and push to Payload
    for act in activities:
        activity_type = (act.get("activityType", {}) or {}).get("typeKey", "").lower()
        if "diving" not in activity_type:  # e.g. "scuba_diving"
            continue
        save_dive_to_payload(act)


if __name__ == "__main__":
    main()
