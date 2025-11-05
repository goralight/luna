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

// Date helpers (UTC-safe)

export function toUTCDate(dateString: string): Date {
  const [y, m, d] = dateString.split('-').map((n) => Number(n))
  return new Date(Date.UTC(y, m - 1, d))
}

export function formatDateUTC(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDaysUTC(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000)
}

export function normalizeDateString(value: string | Date): string {
  if (value instanceof Date) {
    return formatDateUTC(value)
  }
  // Slice string input directly to avoid timezone shifts
  return String(value).slice(0, 10)
}

// Iteration helpers

export async function forEachDayEntry(
  payload: any,
  startDate: string,
  endDate: string,
  handle: (doc: any) => void | Promise<void>,
): Promise<void> {
  let currentPage = 1
  let hasMorePages = true
  while (hasMorePages) {
    const result = await fetchDayEntriesPage(payload, startDate, endDate, currentPage)
    for (const document of result.docs) {
      // eslint-disable-next-line no-await-in-loop
      await handle(document)
    }
    const processedEntries = (result.page ?? 1) * result.limit
    hasMorePages = processedEntries < result.totalDocs
    currentPage++
  }
}

export async function buildDailyValueMap(
  payload: any,
  startDate: string,
  endDate: string,
  field: StatField,
): Promise<Map<string, number>> {
  const perDay: Map<string, { sum: number; count: number }> = new Map()

  await forEachDayEntry(payload, startDate, endDate, (doc) => {
    const dateKey = normalizeDateString(doc.date)
    const numericValue = extractNumericValue(doc, field)
    if (numericValue == null) return
    const aggregator = perDay.get(dateKey) ?? { sum: 0, count: 0 }
    aggregator.sum += numericValue
    aggregator.count += 1
    perDay.set(dateKey, aggregator)
  })

  const result: Map<string, number> = new Map()
  for (const [date, agg] of perDay.entries()) {
    result.set(date, agg.count > 0 ? agg.sum / agg.count : NaN)
  }
  return result
}

export function listAllDatesInRange(start: Date, end: Date): string[] {
  const dates: string[] = []
  const startUTC = toUTCDate(formatDateUTC(start))
  const endUTC = toUTCDate(formatDateUTC(end))
  for (
    let cursor = startUTC;
    cursor.getTime() <= endUTC.getTime();
    cursor = addDaysUTC(cursor, 1)
  ) {
    dates.push(formatDateUTC(cursor))
  }
  return dates
}

export function getFullWeekWindowsFromStart(
  allDates: string[],
): Array<{ start: string; endExclusive: string }> {
  const windows: Array<{ start: string; endExclusive: string }> = []
  const fullWeeks = Math.floor(allDates.length / 7)
  for (let w = 0; w < fullWeeks; w++) {
    const i = w * 7
    const start = allDates[i]
    const endExclusive = formatDateUTC(addDaysUTC(toUTCDate(start), 7))
    windows.push({ start, endExclusive })
  }
  return windows
}

// Week windows aligned to the provided start date, including the trailing partial week
export function getWeekWindows(
  start: Date,
  end: Date,
): Array<{ start: string; endExclusive: string }> {
  const windows: Array<{ start: string; endExclusive: string }> = []
  let cursor = toUTCDate(formatDateUTC(start))
  const rangeEndExclusive = addDaysUTC(toUTCDate(formatDateUTC(end)), 1)
  while (cursor.getTime() < rangeEndExclusive.getTime()) {
    const windowStart = new Date(cursor.getTime())
    const windowEndExclusive = new Date(
      Math.min(addDaysUTC(windowStart, 7).getTime(), rangeEndExclusive.getTime()),
    )
    windows.push({
      start: formatDateUTC(windowStart),
      endExclusive: formatDateUTC(windowEndExclusive),
    })
    cursor = windowEndExclusive
  }
  return windows
}

export function getMonthlyWindows(
  start: Date,
  end: Date,
): Array<{ start: string; endExclusive: string }> {
  const windows: Array<{ start: string; endExclusive: string }> = []
  const rangeEndExclusive = addDaysUTC(toUTCDate(formatDateUTC(end)), 1)
  let monthCursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
  while (monthCursor.getTime() < rangeEndExclusive.getTime()) {
    const currentMonthStart = new Date(
      Date.UTC(monthCursor.getUTCFullYear(), monthCursor.getUTCMonth(), 1),
    )
    const nextMonthStart = new Date(
      Date.UTC(monthCursor.getUTCFullYear(), monthCursor.getUTCMonth() + 1, 1),
    )

    const bucketStart = new Date(
      Math.max(currentMonthStart.getTime(), toUTCDate(formatDateUTC(start)).getTime()),
    )
    const bucketEndExclusive = new Date(
      Math.min(nextMonthStart.getTime(), rangeEndExclusive.getTime()),
    )

    if (bucketStart.getTime() < bucketEndExclusive.getTime()) {
      windows.push({
        start: formatDateUTC(bucketStart),
        endExclusive: formatDateUTC(bucketEndExclusive),
      })
    }

    monthCursor = nextMonthStart
  }
  return windows
}

// Formatting helpers

export function roundToDecimals(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}

export function formatAverage(value: number | null, field: StatField): number | null {
  if (value == null) return null
  const decimals = field === 'weight' ? 2 : 1
  return roundToDecimals(value, decimals)
}
