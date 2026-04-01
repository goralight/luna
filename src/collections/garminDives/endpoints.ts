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

      return Response.json({
        startTimeLocal: dive.startTimeLocal,
        diveTimeSeries: dive.diveTimeSeries ?? null,
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

