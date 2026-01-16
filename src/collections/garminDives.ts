import { isValid, parse } from 'date-fns'
import type { CollectionConfig, Where } from 'payload'

export const GarminDives: CollectionConfig = {
  slug: 'garmin-dives',
  defaultSort: '-startTimeGMT',
  access: {
    read: () => true,
  },
  admin: {
    useAsTitle: 'title',
    group: 'Diving',
    description: 'Scuba dives imported from Garmin Connect.',
    defaultColumns: ['startTimeGMT', 'durationSeconds', 'maxDepthMeters', 'title', 'location'],
  },
  indexes: [
    { fields: ['startTimeGMT'] },
    { fields: ['startTimeLocal'] },
    { fields: ['maxDepthMeters'] },
    { fields: ['isWorkingDive'] },
    { fields: ['workingDiveCourse'] },
  ],
  fields: [
    {
      name: 'garminActivityId',
      type: 'text',
      required: true,
      unique: true,
    },
    {
      name: 'isWorkingDive',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      admin: {
        description: 'Whether the dive is a working dive. Not ported from Garmin.',
      },
    },
    {
      name: 'workingDiveCourse',
      type: 'select',
      label: 'Diving course',
      index: true,
      options: [
        { label: 'OW', value: 'ow' },
        { label: 'AOW', value: 'aow' },
        { label: 'Drysuit', value: 'drysuit' },
        { label: 'Deep', value: 'deep' },
        { label: 'Wreck', value: 'wreck' },
        { label: 'Night', value: 'night' },
        { label: 'Rescue', value: 'rescue' },
      ],
      admin: {
        condition: (_, siblingData) => siblingData?.isWorkingDive === true,
        description: 'Select the course for this working dive.',
      },
    },
    {
      name: 'notes',
      type: 'textarea',
      admin: {
        description: 'Additional notes about the dive. Not ported from Garmin.',
        width: 'full',
      },
    },
    {
      name: 'startTimeLocal',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'startTimeGMT',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'title',
      type: 'text',
    },
    {
      name: 'durationSeconds',
      type: 'number',
    },
    {
      name: 'maxDepthMeters',
      type: 'number',
      index: true,
    },
    {
      name: 'avgDepthMeters',
      type: 'number',
    },
    {
      name: 'location',
      type: 'text',
    },
    {
      name: 'coordinates',
      label: 'Coordinates',
      type: 'group',
      fields: [
        {
          name: 'latitude',
          label: 'Latitude',
          type: 'number',
        },
        {
          name: 'longitude',
          label: 'Longitude',
          type: 'number',
        },
      ],
    },
    {
      name: 'temperature',
      label: 'Temperature',
      type: 'group',
      fields: [
        {
          name: 'min',
          label: 'Min Temperature',
          type: 'number',
          admin: {
            description: 'Minimum recorded temperature (°C)',
          },
        },
        {
          name: 'max',
          label: 'Max Temperature',
          type: 'number',
          admin: {
            description: 'Maximum recorded temperature (°C)',
          },
        },
      ],
    },
    {
      name: 'surfaceIntervalSeconds',
      type: 'number',
    },
    {
      name: 'gases',
      type: 'array',
      label: 'Dive Gases',
      fields: [
        {
          name: 'oxygenPercent',
          type: 'number',
          required: true,
          min: 0,
          max: 100,
          admin: {
            description: 'Oxygen percentage (O₂)',
          },
        },
        {
          name: 'heliumPercent',
          type: 'number',
          required: true,
          min: 0,
          max: 100,
          admin: {
            description: 'Helium percentage (He)',
          },
        },
      ],
    },
  ],
  endpoints: [
    {
      path: '/basic-stats',
      method: 'get',
      handler: async (req) => {
        const deepDiveCutoffMeters = 30
        const intermediateDivesStartMeters = 18

        const dives = await req.payload.find({
          collection: 'garmin-dives',
          limit: 0,
          pagination: false,
          select: {
            durationSeconds: true,
            maxDepthMeters: true,
            isWorkingDive: true,
          },
        })

        let totalDives = 0
        let deepestDepthMeters = 0
        let totalDeepDives = 0
        let totalIntermediateDives = 0
        let totalBottomTimeSeconds = 0
        let totalWorkingDives = 0

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
          if (dive.isWorkingDive) {
            totalWorkingDives += 1
          }
        }

        // Keep the response shape similar to what you had before
        return Response.json({
          totalDives,
          deepestDepthMeters: deepestDepthMeters.toFixed(1),
          totalBottomTimeSeconds: totalBottomTimeSeconds.toFixed(0),
          workingDives: {
            count: totalWorkingDives,
            percentage: ((totalWorkingDives / totalDives) * 100).toFixed(1),
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
        // Free‑text search (q preferred, but also accept search)
        const rawQuery = typeof req.query?.q === 'string' ? req.query.q : ''

        const search = rawQuery.trim()

        // TODO: Add dive type searching once we have a way to store dive types
        const rawDiveType = typeof req.query?.type === 'string' ? req.query.type.trim() : ''
        const diveType = rawDiveType
        void diveType

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

        const where: Where | undefined =
          search === ''
            ? undefined
            : {
                or: [
                  // Text fields: use the raw search term
                  { title: { like: search } },
                  { location: { like: search } },
                  // Date fields: use month-aware search if it resolved, else raw
                  { startTimeLocal: { like: dateSearch } },
                  { startTimeGMT: { like: dateSearch } },
                ],
              }

        const result = await req.payload.find({
          collection: 'garmin-dives',
          sort: '-startTimeGMT',
          page,
          limit,
          ...(where ? { where } : {}),
        })

        return Response.json(result)
      },
    },
  ],
}
