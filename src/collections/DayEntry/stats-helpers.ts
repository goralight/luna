import { ALLOWED_STAT_FIELDS, CACHE_MAX_AGE, PAGINATION_LIMIT, StatField } from './types'

// Validation helpers

export function validateStatsParams(
  start: string | undefined,
  end: string | undefined,
  field: string | undefined,
): Response | null {
  if (!start || !end) {
    return Response.json(
      { error: 'Query parameters "start" and "end" are required (format: YYYY-MM-DD)' },
      { status: 400 },
    )
  }

  if (!isValidStatField(field)) {
    return Response.json(
      {
        error: `Invalid field parameter. Allowed fields: ${ALLOWED_STAT_FIELDS.join(', ')}`,
      },
      { status: 400 },
    )
  }

  return null
}

export function isValidStatField(field: string | undefined): field is StatField {
  return ALLOWED_STAT_FIELDS.includes(field as StatField)
}

// Data aggregation logic

export async function aggregateFieldValues(
  payload: any,
  startDate: string,
  endDate: string,
  fieldName: StatField,
): Promise<{ sum: number; count: number }> {
  let sum = 0
  let count = 0
  let currentPage = 1
  let hasMorePages = true

  while (hasMorePages) {
    const result = await fetchDayEntriesPage(payload, startDate, endDate, currentPage)

    for (const document of result.docs) {
      const fieldValue = extractNumericValue(document, fieldName)
      if (fieldValue !== null) {
        sum += fieldValue
        count++
      }
    }

    const processedEntries = (result.page ?? 1) * result.limit
    hasMorePages = processedEntries < result.totalDocs
    currentPage++
  }

  return { sum, count }
}

export async function aggregateFieldDistribution(
  payload: any,
  startDate: string,
  endDate: string,
  fieldName: StatField,
): Promise<Record<string, number>> {
  const distribution: Record<string, number> = {}
  let currentPage = 1
  let hasMorePages = true

  while (hasMorePages) {
    const result = await fetchDayEntriesPage(payload, startDate, endDate, currentPage)

    for (const document of result.docs) {
      const fieldValue = extractFieldValue(document, fieldName)
      if (fieldValue !== null) {
        const valueKey = String(fieldValue)
        distribution[valueKey] = (distribution[valueKey] ?? 0) + 1
      }
    }

    const processedEntries = (result.page ?? 1) * result.limit
    hasMorePages = processedEntries < result.totalDocs
    currentPage++
  }

  return distribution
}

export async function fetchDayEntriesPage(
  payload: any,
  startDate: string,
  endDate: string,
  page: number,
) {
  return await payload.find({
    collection: 'day-entries' as any,
    where: {
      and: [{ date: { greater_than_equal: startDate } }, { date: { less_than_equal: endDate } }],
    },
    limit: PAGINATION_LIMIT,
    page,
    sort: 'date',
    depth: 0,
  })
}

export function extractNumericValue(document: any, fieldName: string): number | null {
  const value = document[fieldName]
  if (value == null) {
    return null
  }

  const numericValue = Number(value)
  return Number.isNaN(numericValue) ? null : numericValue
}

export function extractFieldValue(document: any, fieldName: string): string | number | null {
  const value = document[fieldName]
  return value ?? null
}

export function fillDistributionGaps(
  distribution: Record<string, number>,
  fieldName: StatField,
): Record<string, number> {
  const minMaxMap = {
    moodRating: { min: 1, max: 10 },
    dives: { min: 1, max: 5 },
  }

  const { min, max } = minMaxMap[fieldName as keyof typeof minMaxMap]
  const filled: Record<string, number> = {}
  for (let i = min; i <= max; i++) {
    const key = String(i)
    filled[key] = distribution[key] ?? 0
  }
  return filled
}

export async function fetchAllNumericValues(
  payload: any,
  startDate: string,
  endDate: string,
  field: StatField,
): Promise<number[]> {
  const values: number[] = []
  let currentPage = 1
  let hasMorePages = true

  while (hasMorePages) {
    const result = await fetchDayEntriesPage(payload, startDate, endDate, currentPage)
    for (const document of result.docs) {
      const fieldValue = extractNumericValue(document, field)
      if (fieldValue !== null) {
        values.push(fieldValue)
      }
    }
    const processedEntries = (result.page ?? 1) * result.limit
    hasMorePages = processedEntries < result.totalDocs
    currentPage++
  }

  return values
}

export function calculateMedian(values: number[]): number | null {
  if (values.length === 0) {
    return null
  }

  const sorted = [...values].sort((a, b) => a - b)
  const count = sorted.length

  if (count % 2 === 1) {
    return sorted[Math.floor(count / 2)]
  } else {
    return (sorted[count / 2 - 1] + sorted[count / 2]) / 2
  }
}

export function calculateConsistencyStats(values: number[]): {
  standardDeviation: number | null
  variance: number | null
  coefficientOfVariation: number | null
} {
  if (values.length === 0) {
    return {
      standardDeviation: null,
      variance: null,
      coefficientOfVariation: null,
    }
  }

  const n = values.length
  const mean = values.reduce((sum, v) => sum + v, 0) / n
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n
  const standardDeviation = Math.sqrt(variance)
  const coefficientOfVariation = mean !== 0 ? standardDeviation / mean : null

  return {
    standardDeviation,
    variance,
    coefficientOfVariation,
  }
}

export function createCachedResponse(data: any): Response {
  return Response.json(data, {
    headers: {
      'Cache-Control': `private, max-age=${CACHE_MAX_AGE}`,
    },
  })
}
