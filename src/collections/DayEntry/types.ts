export const ALLOWED_STAT_FIELDS = ['moodRating', 'dives', 'weight', 'minutesPainted'] as const
export const PAGINATION_LIMIT = 200
export const CACHE_MAX_AGE = 60

export type StatField = (typeof ALLOWED_STAT_FIELDS)[number]

export interface StatsQueryParams {
  start?: string
  end?: string
  field?: string
}

export interface StatsResponse {
  field: string
  start: string
  end: string
  count: number
  average: number | null
}

export interface DistributionResponse {
  field: string
  start: string
  end: string
  totalCount: number
  distribution: Record<string, number>
}

