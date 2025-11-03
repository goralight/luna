import { Endpoint } from 'payload'
import {
  aggregateFieldDistribution,
  aggregateFieldValues,
  calculateConsistencyStats,
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
        distribution,
        consistency,
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

      const { sum, count } = await aggregateFieldValues(
        req.payload,
        start!,
        end!,
        field as StatField,
      )

      const average = count > 0 ? sum / count : null

      const response: StatsResponse = {
        field: field!,
        start: start!,
        end: end!,
        count,
        average,
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
