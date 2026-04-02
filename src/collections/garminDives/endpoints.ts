import { isValid, parse } from 'date-fns'
import { Endpoint, Where } from 'payload'
import type { GarminDive } from '../../payload-types'
import type { AdjacentDiveSummary } from './types'

const GARMIN_DIVES_COLLECTION = 'garmin-dives'

type DateTimePathOk = { ok: true; param: string; lookup: string }
type DateTimePathErr = { ok: false; status: number; body: Record<string, string> }

function parseByDateTimePathParam(req: Parameters<Endpoint['handler']>[0]): DateTimePathOk | DateTimePathErr {
  const dateTimeFromPath =
    (req as { routeParams?: { dateTime?: string }; params?: { dateTime?: string } })?.routeParams?.dateTime ??
    (req as { params?: { dateTime?: string } })?.params?.dateTime ??
    null
  const param = typeof dateTimeFromPath === 'string' ? dateTimeFromPath.trim() : ''
  if (param === '') {
    return {
      ok: false,
      status: 400,
      body: { error: 'Pass the date/time as YYYY-MM-DD_HH-MM at the end of the URL.' },
    }
  }

  const match = param.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})$/)
  if (!match) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Invalid format. Use YYYY-MM-DD_HH-MM (example: 2025-12-24_10-22).' },
    }
  }

  const [, datePart, hourPart, minutePart] = match
  const lookup = `${datePart} ${hourPart}:${minutePart}`
  return { ok: true, param, lookup }
}

/** Query ?series=… maps to diveTimeSeries JSON keys (columnar arrays). */
const DIVE_TIME_SERIES_QUERY_TO_KEY = {
  depth: 'depthM',
  temperature: 'temperatureC',
  tankPressure: 'tankPressureBar',
  volumeSac: 'volumeSacLitersPerMin',
} as const

type DiveTimeSeriesSeriesQuery = keyof typeof DIVE_TIME_SERIES_QUERY_TO_KEY

function parseDiveTimeSeriesSeriesQuery(req: Parameters<Endpoint['handler']>[0]): DiveTimeSeriesSeriesQuery | null | 'invalid' {
  const raw = req.query?.series
  const first = Array.isArray(raw) ? raw[0] : raw
  if (typeof first !== 'string') return null
  const trimmed = first.trim()
  if (trimmed === '') return null
  const lower = trimmed.toLowerCase()
  const entries = Object.entries(DIVE_TIME_SERIES_QUERY_TO_KEY) as [DiveTimeSeriesSeriesQuery, string][]
  const found = entries.find(([q]) => q.toLowerCase() === lower)
  if (!found) return 'invalid'
  return found[0]
}

function filterDiveTimeSeriesToSingleSeries(
  full: Record<string, unknown>,
  dataKey: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const metaKey of ['schemaVersion', 'anchorTimeGmt', 'sampleCount'] as const) {
    if (metaKey in full) out[metaKey] = full[metaKey]
  }
  if ('epochMs' in full) out.epochMs = full.epochMs
  if (dataKey in full) out[dataKey] = full[dataKey]

  const unitsFull = full.units
  if (unitsFull && typeof unitsFull === 'object' && !Array.isArray(unitsFull)) {
    const u = unitsFull as Record<string, unknown>
    const filteredUnits: Record<string, unknown> = {}
    if ('epochMs' in u) filteredUnits.epochMs = u.epochMs
    if (dataKey in u) filteredUnits[dataKey] = u[dataKey]
    if (Object.keys(filteredUnits).length > 0) out.units = filteredUnits
  }

  return out
}

export const garminDiveEndpoints: Endpoint[] = [
  {
    path: '/basic-stats',
    method: 'get',
    handler: async (req) => {
      const deepDiveCutoffMeters = 30
      const intermediateDivesStartMeters = 18

      const dives = await req.payload.find({
        collection: GARMIN_DIVES_COLLECTION,
        limit: 0,
        pagination: false,
        select: {
          durationSeconds: true,
          maxDepthMeters: true,
          diveType: true,
        },
      })

      let totalDives = 0
      let deepestDepthMeters = 0
      let totalDeepDives = 0
      let totalIntermediateDives = 0
      let totalBottomTimeSeconds = 0
      let totalInstructingDives = 0
      let totalRecreationalDives = 0

      for (const dive of dives.docs) {
        totalDives += 1

        const depth = dive.maxDepthMeters ?? 0
        totalBottomTimeSeconds += dive.durationSeconds ?? 0
        if (depth > deepestDepthMeters) {
          deepestDepthMeters = depth
        }
        if (depth > deepDiveCutoffMeters) {
          totalDeepDives += 1
        }
        if (depth > intermediateDivesStartMeters) {
          totalIntermediateDives += 1
        }
        if (dive.diveType === 'instructing') {
          totalInstructingDives += 1
        }
        if (dive.diveType === 'recreational') {
          totalRecreationalDives += 1
        }
      }

      // Keep the response shape similar to what you had before
      return Response.json({
        totalDives,
        deepestDepthMeters: deepestDepthMeters.toFixed(1),
        totalBottomTimeSeconds: totalBottomTimeSeconds.toFixed(0),
        instructingDives: {
          count: totalInstructingDives,
          percentage: ((totalInstructingDives / totalDives) * 100).toFixed(1),
        },
        recreationalDives: {
          count: totalRecreationalDives,
          percentage: ((totalRecreationalDives / totalDives) * 100).toFixed(1),
        },
        intermediateDives: {
          intermediateDivesStartMeters,
          count: totalIntermediateDives,
          percentage: ((totalIntermediateDives / totalDives) * 100).toFixed(1),
        },
        deepDives: {
          deepDiveCutoffMeters,
          count: totalDeepDives,
          percentage: ((totalDeepDives / totalDives) * 100).toFixed(1),
        },
      })
    },
  },
  {
    path: '/search',
    method: 'get',
    handler: async (req) => {
      // Free-text search (q preferred, but also accept search)
      const rawQuery = typeof req.query?.q === 'string' ? req.query.q : ''

      const search = rawQuery.trim()

      const rawDiveType = typeof req.query?.diveType === 'string' ? req.query.diveType.trim() : ''
      const normalizedDiveType = rawDiveType.toLowerCase()
      const validDiveTypeFilters = new Set(['course', 'instructing', 'recreational'])
      const diveTypeFilter =
        normalizedDiveType !== '' && validDiveTypeFilters.has(normalizedDiveType)
          ? normalizedDiveType
          : null

      const DEFAULT_LIMIT = 7

      const parsePositiveInt = (value: unknown, fallback: number): number => {
        if (typeof value !== 'string') return fallback
        const n = Number.parseInt(value, 10)
        if (!Number.isFinite(n) || n <= 0) return fallback
        return n
      }

      const page = parsePositiveInt(req.query?.page, 1)
      const limit = parsePositiveInt(req.query?.limit, DEFAULT_LIMIT)

      // Month-name handling for ISO date fields
      let dateSearch = search
      if (search !== '') {
        const parsedShort = parse(search, 'MMM', new Date()) // jan, feb, …
        const parsedLong = parse(search, 'MMMM', new Date()) // january, february, …
        const monthDate = isValid(parsedShort)
          ? parsedShort
          : isValid(parsedLong)
            ? parsedLong
            : null

        if (monthDate) {
          const month = String(monthDate.getMonth() + 1).padStart(2, '0') // 01–12
          dateSearch = `-${month}-` // matches YYYY-MM-DD for that month
        }
      }

      const filtersToApply: Where[] = []

      if (search !== '') {
        filtersToApply.push({
          or: [
            // Text fields: use the raw search term
            { title: { like: search } },
            { location: { like: search } },
            // Date fields: use month-aware search if it resolved, else raw
            { startTimeLocal: { like: dateSearch } },
            { startTimeGMT: { like: dateSearch } },
          ],
        })
      }

      if (diveTypeFilter) {
        filtersToApply.push({ diveType: { equals: diveTypeFilter } })
      }

      const where: Where | undefined =
        filtersToApply.length === 0
          ? undefined
          : filtersToApply.length === 1
            ? filtersToApply[0]
            : { and: filtersToApply }

      const result = await req.payload.find({
        collection: GARMIN_DIVES_COLLECTION,
        sort: '-startTimeGMT',
        page,
        limit,
        ...(where ? { where } : {}),
      })

      return Response.json(result)
    },
  },
  {
    path: '/by-date-time/:dateTime/dive-time-series',
    method: 'get',
    handler: async (req) => {
      const parsed = parseByDateTimePathParam(req)
      if (!parsed.ok) {
        return Response.json(parsed.body, { status: parsed.status })
      }
      const { param, lookup } = parsed

      const result = await req.payload.find({
        collection: GARMIN_DIVES_COLLECTION,
        limit: 1,
        pagination: false,
        select: { diveTimeSeries: true, startTimeLocal: true },
        where: {
          startTimeLocal: {
            like: lookup,
          },
        },
      })

      const dive = result.docs?.[0] as GarminDive | undefined
      if (!dive) {
        return Response.json({ error: `No dive found for ${param}.` }, { status: 404 })
      }

      const seriesQuery = parseDiveTimeSeriesSeriesQuery(req)
      if (seriesQuery === 'invalid') {
        const allowed = Object.keys(DIVE_TIME_SERIES_QUERY_TO_KEY).join(', ')
        return Response.json(
          { error: `Invalid series. Use one of: ${allowed}.` },
          { status: 400 },
        )
      }

      let diveTimeSeries: GarminDive['diveTimeSeries'] = dive.diveTimeSeries ?? null
      if (seriesQuery !== null && diveTimeSeries !== null && typeof diveTimeSeries === 'object' && !Array.isArray(diveTimeSeries)) {
        const dataKey = DIVE_TIME_SERIES_QUERY_TO_KEY[seriesQuery]
        diveTimeSeries = filterDiveTimeSeriesToSingleSeries(diveTimeSeries as Record<string, unknown>, dataKey)
      }

      return Response.json({
        startTimeLocal: dive.startTimeLocal,
        diveTimeSeries,
      })
    },
  },
  {
    path: '/by-date-time/:dateTime',
    method: 'get',
    handler: async (req) => {
      const parsed = parseByDateTimePathParam(req)
      if (!parsed.ok) {
        return Response.json(parsed.body, { status: parsed.status })
      }
      const { param, lookup } = parsed

      const result = await req.payload.find({
        collection: GARMIN_DIVES_COLLECTION,
        limit: 1,
        pagination: false,
        select: {
          diveTimeSeries: false,
        },
        where: {
          startTimeLocal: {
            like: lookup,
          },
        },
      })

      const dive = result.docs?.[0] as GarminDive | undefined
      if (!dive) {
        return Response.json({ error: `No dive found for ${param}.` }, { status: 404 })
      }

      const currentStartTimeLocal = dive.startTimeLocal.trim()

      let previousDive: AdjacentDiveSummary | null = null
      let nextDive: AdjacentDiveSummary | null = null

      if (currentStartTimeLocal.length > 0) {
        const [youngerResult, olderResult] = await Promise.all([
          req.payload.find({
            collection: GARMIN_DIVES_COLLECTION,
            limit: 1,
            pagination: false,
            sort: 'startTimeLocal',
            where: {
              startTimeLocal: {
                greater_than: currentStartTimeLocal,
              },
            },
          }),
          req.payload.find({
            collection: GARMIN_DIVES_COLLECTION,
            limit: 1,
            pagination: false,
            sort: '-startTimeLocal',
            where: {
              startTimeLocal: {
                less_than: currentStartTimeLocal,
              },
            },
          }),
        ])

        const toSummary = (diveCandidate: GarminDive | undefined): AdjacentDiveSummary | null => {
          if (typeof diveCandidate?.startTimeLocal !== 'string') return null
          const trimmed = diveCandidate.startTimeLocal.trim()
          return trimmed === '' ? null : { startTimeLocal: trimmed }
        }

        const youngerDive = youngerResult?.docs?.[0] as GarminDive | undefined
        const olderDive = olderResult?.docs?.[0] as GarminDive | undefined

        previousDive = toSummary(youngerDive)
        nextDive = toSummary(olderDive)
      }

      const diveWithAdjacents: GarminDive & {
        previousDive: AdjacentDiveSummary | null
        nextDive: AdjacentDiveSummary | null
      } = { ...dive, previousDive, nextDive }

      return Response.json(diveWithAdjacents)
    },
  },
]

