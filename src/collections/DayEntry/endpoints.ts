import { Endpoint } from 'payload'
import {
  aggregateFieldDistribution,
  calculateConsistencyStats,
  calculateMedian,
  createCachedResponse,
  normalizeStatField,
  fetchAllNumericValues,
  fillDistributionGaps,
  validateStatsParams,
  buildDailyValueMap,
  listAllDatesInRange,
  getWeekWindows,
  getMonthlyWindows,
  formatAverage,
  forEachDayEntry,
  normalizeDateString,
} from './stats-helpers'
import { toUTCDate } from './stats-helpers'
import { DistributionResponse, StatField, StatsQueryParams, StatsResponse } from './types'

export const dayEntryEndpoints: Endpoint[] = [
  {
    path: '/stats',
    method: 'get',
    handler: async (req) => {
      const { start, end, field } = req.query as StatsQueryParams

      const validationError = validateStatsParams(start, end, field)
      if (validationError) {
        return validationError
      }

      // Single data fetch
      const normalized = normalizeStatField(field!)!
      const values = await fetchAllNumericValues(req.payload, start!, end!, normalized)

      // Calculate everything from the values array
      const count = values.length
      const sum = values.reduce((acc, val) => acc + val, 0)
      const average = formatAverage(count > 0 ? sum / count : null, normalized)
      const median = calculateMedian(values)

      // Calculate min and max
      let minmax: { min: number | null; max: number | null }
      if (count > 0) {
        let min = values[0]
        let max = values[0]
        for (let i = 1; i < values.length; i++) {
          if (values[i] < min) min = values[i]
          if (values[i] > max) max = values[i]
        }
        minmax = { min, max }
      } else {
        minmax = { min: null, max: null }
      }

      // Compute distribution for moodRating and dives
      let distribution: Record<string, number> | undefined = undefined
      if (normalized === 'mood' || normalized === 'diving') {
        const rawDistribution = values.reduce(
          (acc, val) => {
            const key = String(val)
            acc[key] = (acc[key] || 0) + 1
            return acc
          },
          {} as Record<string, number>,
        )
        distribution = fillDistributionGaps(rawDistribution, normalized)
      }

      // Calculate consistency statistics
      const consistency = calculateConsistencyStats(values)

      const response = {
        field: normalized,
        start: start!,
        end: end!,
        count,
        average,
        median,
        distribution,
        consistency,
        minmax,
      }

      return createCachedResponse(response)
    },
  },
  {
    path: '/series/notes',
    method: 'get',
    handler: async (req) => {
      const { start, end, field } = req.query as StatsQueryParams
      const validationError = validateStatsParams(start, end, field)
      if (validationError) {
        return validationError
      }
      const normalized = normalizeStatField(field!)!
      // map stat field -> trackers blockType
      const blockTypeByField: Record<StatField, string> = {
        mood: 'mood',
        diving: 'diving',
        weight: 'weight',
        painting: 'painting',
      }
      const blockType = blockTypeByField[normalized]

      const notes: Array<{ date: string; note: string }> = []
      await forEachDayEntry(req.payload, start!, end!, (doc) => {
        const trackers = Array.isArray(doc?.trackers) ? doc.trackers : []
        const block = trackers.find((b: any) => b?.blockType === blockType)
        const text: string | undefined = (block?.note ?? undefined)?.toString()?.trim()
        if (text) {
          notes.push({
            date: normalizeDateString(doc.date),
            note: text,
          })
        }
      })

      return createCachedResponse({
        aggregate: 'notes',
        field: normalized,
        start: start!,
        end: end!,
        notes,
        count: notes.length,
      })
    },
  },
  {
    path: '/series',
    method: 'get',
    handler: async (req) => {
      const { start, end, field } = req.query as { start?: string; end?: string; field?: string }
      const aggregate = (req.query as any)?.aggregate as 'daily' | 'weekly' | 'monthly' | undefined

      if (!aggregate || !['daily', 'weekly', 'monthly'].includes(aggregate)) {
        return Response.json(
          { error: 'Query parameter "aggregate" must be one of: daily, weekly, monthly' },
          { status: 400 },
        )
      }

      // For all aggregates, we require a valid field and date range
      const validationError = validateStatsParams(start, end, field)
      if (validationError) {
        return validationError
      }

      const fieldName = normalizeStatField(field!)!

      const startDt = toUTCDate(start!)
      const endDt = toUTCDate(end!)

      // Precompute daily averages by date and the list of dates in the range
      const dailyValueByDate = await buildDailyValueMap(req.payload, start!, end!, fieldName)
      const allDays = listAllDatesInRange(startDt, endDt)

      if (aggregate === 'daily') {
        const series = allDays.map((date) => ({
          date,
          value: formatAverage(
            dailyValueByDate.has(date) ? dailyValueByDate.get(date)! : null,
            fieldName,
          ),
        }))
        return createCachedResponse({
          aggregate,
          field: fieldName,
          start,
          end,
          series,
          count: series.length,
        })
      }

      if (aggregate === 'weekly') {
        // Partition into contiguous 7-day windows from start date, including trailing partial week.
        const series: Array<{ start: string; end: string; value: number | null; count: number }> =
          []
        const weekWindows = getWeekWindows(startDt, endDt)
        for (const window of weekWindows) {
          const windowDays = allDays.filter((d) => d >= window.start && d < window.endExclusive)
          let sum = 0
          let count = 0
          for (const date of windowDays) {
            if (!dailyValueByDate.has(date)) continue
            sum += dailyValueByDate.get(date)!
            count += 1
          }
          const value = formatAverage(count > 0 ? sum / count : null, fieldName)
          series.push({ start: window.start, end: window.endExclusive, value, count })
        }
        return createCachedResponse({
          aggregate,
          field: fieldName,
          start,
          end,
          series,
          count: series.length,
        })
      }

      // monthly: multiple calendar month buckets across the range
      const monthWindows = getMonthlyWindows(startDt, endDt)
      const series = monthWindows.map((w) => {
        let sum = 0
        let count = 0
        for (const date of allDays) {
          if (date < w.start || date >= w.endExclusive) continue
          if (!dailyValueByDate.has(date)) continue
          sum += dailyValueByDate.get(date)!
          count += 1
        }
        const value = formatAverage(count > 0 ? sum / count : null, fieldName)
        return { start: w.start, end: w.endExclusive, value, count }
      })
      return createCachedResponse({
        aggregate,
        field: fieldName,
        start,
        end,
        series,
        count: series.length,
      })
    },
  },
  {
    path: '/stats/consistency',
    method: 'get',
    handler: async (req) => {
      const { start, end, field } = req.query as StatsQueryParams

      const validationError = validateStatsParams(start, end, field)
      if (validationError) {
        return validationError
      }

      const normalized = normalizeStatField(field!)!
      const values = await fetchAllNumericValues(req.payload, start!, end!, normalized)
      const { standardDeviation, variance, coefficientOfVariation } =
        calculateConsistencyStats(values)

      const response = {
        field: normalized,
        start: start!,
        end: end!,
        count: values.length,
        standardDeviation,
        variance,
        coefficientOfVariation,
      }

      return createCachedResponse(response)
    },
  },
  {
    path: '/stats/average',
    method: 'get',
    handler: async (req) => {
      const { start, end, field } = req.query as StatsQueryParams

      const validationError = validateStatsParams(start, end, field)
      if (validationError) {
        return validationError
      }

      // Get all numeric values for median calculation
      const normalized = normalizeStatField(field!)!
      const values = await fetchAllNumericValues(req.payload, start!, end!, normalized)

      // Aggregate sum and count for average
      const { sum, count } = values.reduce(
        (acc, val) => {
          acc.sum += val
          acc.count += 1
          return acc
        },
        { sum: 0, count: 0 },
      )

      const average = formatAverage(count > 0 ? sum / count : null, normalized)
      const median = calculateMedian(values)

      const response: StatsResponse = {
        field: normalized,
        start: start!,
        end: end!,
        count,
        average,
        median,
      }

      return createCachedResponse(response)
    },
  },
  {
    path: '/stats/distribution',
    method: 'get',
    handler: async (req) => {
      const { start, end, field } = req.query as StatsQueryParams

      const validationError = validateStatsParams(start, end, field)
      if (validationError) {
        return validationError
      }

      const normalized = normalizeStatField(field!)!
      if (normalized !== 'mood' && normalized !== 'diving') {
        return Response.json(
          {
            error: 'Distribution endpoint only supports mood and diving fields',
          },
          { status: 400 },
        )
      }

      const distribution = await aggregateFieldDistribution(req.payload, start!, end!, normalized)

      const filledDistribution = fillDistributionGaps(distribution, normalized)
      const totalCount = Object.values(filledDistribution).reduce((sum, count) => sum + count, 0)

      const response: DistributionResponse = {
        field: normalized,
        start: start!,
        end: end!,
        totalCount,
        distribution: filledDistribution,
      }

      return createCachedResponse(response)
    },
  },
]
