import type { GarminDive } from '../../payload-types'

export type AdjacentDiveSummary = {
  startTimeLocal: string
}

/** `garmin-dives` document after `afterRead` merges sidecar `diveTimeSeries` (not a stored field on the collection). */
export type GarminDiveWithMergedTimeSeries = GarminDive & {
  diveTimeSeries?: unknown
}

