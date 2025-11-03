import { Endpoint } from 'payload'
import {
  aggregateFieldDistribution,
  aggregateFieldValues,
  calculateConsistencyStats,
  calculateMedian,
  createCachedResponse,
  fetchAllNumericValues,
  fillDistributionGaps,
  validateStatsParams,
} from './stats-helpers'
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
      const values = await fetchAllNumericValues(req.payload, start!, end!, field as StatField)

      // Calculate everything from the values array
      const count = values.length
      const sum = values.reduce((acc, val) => acc + val, 0)
      const average = count > 0 ? sum / count : null
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
      if (field === 'moodRating' || field === 'dives') {
        const rawDistribution = values.reduce(
          (acc, val) => {
            const key = String(val)
            acc[key] = (acc[key] || 0) + 1
            return acc
          },
          {} as Record<string, number>,
        )
        distribution = fillDistributionGaps(rawDistribution, field as StatField)
      }

      // Calculate consistency statistics
      const consistency = calculateConsistencyStats(values)

      const response = {
        field: field!,
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
    path: '/stats/consistency',
    method: 'get',
    handler: async (req) => {
      const { start, end, field } = req.query as StatsQueryParams

      const validationError = validateStatsParams(start, end, field)
      if (validationError) {
        return validationError
      }

      const values = await fetchAllNumericValues(req.payload, start!, end!, field as StatField)
      const { standardDeviation, variance, coefficientOfVariation } =
        calculateConsistencyStats(values)

      const response = {
        field: field!,
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
      const values = await fetchAllNumericValues(req.payload, start!, end!, field as StatField)

      // Aggregate sum and count for average
      const { sum, count } = values.reduce(
        (acc, val) => {
          acc.sum += val
          acc.count += 1
          return acc
        },
        { sum: 0, count: 0 },
      )

      const average = count > 0 ? sum / count : null
      const median = calculateMedian(values)

      const response: StatsResponse = {
        field: field!,
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

      if (field !== 'moodRating' && field !== 'dives') {
        return Response.json(
          {
            error: 'Distribution endpoint only supports moodRating and dives fields',
          },
          { status: 400 },
        )
      }

      const distribution = await aggregateFieldDistribution(
        req.payload,
        start!,
        end!,
        field as StatField,
      )

      const filledDistribution = fillDistributionGaps(distribution, field as StatField)
      const totalCount = Object.values(filledDistribution).reduce((sum, count) => sum + count, 0)

      const response: DistributionResponse = {
        field: field!,
        start: start!,
        end: end!,
        totalCount,
        distribution: filledDistribution,
      }

      return createCachedResponse(response)
    },
  },
]
