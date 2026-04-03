import type { Payload } from 'payload'

/** Sidecar collection slug — keep in sync with `garminDiveTimeSeries` config and sync scripts. */
export const GARMIN_DIVE_TIME_SERIES_COLLECTION = 'garmin-dive-time-series' as const

/**
 * Load chart JSON for a dive from the sidecar document (not stored on `garmin-dives`).
 */
export async function findDiveTimeSeriesByActivityId(
  payload: Payload,
  garminActivityId: string,
): Promise<unknown | null> {
  const res = await payload.find({
    collection: GARMIN_DIVE_TIME_SERIES_COLLECTION,
    where: { garminActivityId: { equals: garminActivityId } },
    limit: 1,
    pagination: false,
    depth: 0,
  })
  const doc = res.docs[0] as { diveTimeSeries?: unknown } | undefined
  return doc?.diveTimeSeries ?? null
}
