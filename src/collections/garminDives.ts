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
    description: 'Scuba dives imported from Garmin Connect. Some fields are not ported from Garmin. These are marked with "Not ported from Garmin."',
    defaultColumns: ['startTimeGMT', 'durationSeconds', 'maxDepthMeters', 'title', 'location'],
  },
  indexes: [
    { fields: ['startTimeGMT'] },
    { fields: ['startTimeLocal'] },
    { fields: ['maxDepthMeters'] },
    { fields: ['diveType'] },
  ],
  hooks: {
    beforeValidate: [
      ({ data, originalDoc }) => {
        const diveType =
          (data?.diveType as string | undefined) ?? (originalDoc?.diveType as string | undefined)
        if (diveType === 'recreational' && data) {
          const mutableData = data as Record<string, unknown>
          delete mutableData.diveCourse
        }
      },
    ],
    afterRead: [
      ({ doc }) => {
        if ((doc?.diveType as string | undefined) === 'recreational') {
          const mutableDoc = doc as Record<string, unknown>
          delete mutableDoc.diveCourse
          return mutableDoc
        }
        return doc
      },
    ],
  },
  fields: [
    {
      name: 'garminActivityId',
      type: 'text',
      required: true,
      unique: true,
    },
    {
      name: 'diveType',
      type: 'select',
      required: true,
      defaultValue: 'recreational',
      options: [
        { label: 'Recreational', value: 'recreational' },
        { label: 'Course', value: 'course' },
        { label: 'Instructing', value: 'instructing' },
      ],
      admin: {
        description: 'What type of dive this was. Not ported from Garmin.',
      },
    },
    {
      name: 'diveCourse',
      type: 'select',
      label: 'Diving course',
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
        condition: (_, siblingData) =>
          siblingData?.diveType === 'course' || siblingData?.diveType === 'instructing',
        description: 'Select the course when logging training or instructing dives. Not ported from Garmin.',
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
      name: 'cylinder',
      type: 'group',
      label: 'Cylinder',
      defaultValue: {
        selection: '12l',
        shape: 'long',
      },
      fields: [
        {
          name: 'type',
          type: 'select',
          label: 'Cylinder',
          defaultValue: '12l',
          options: [
            { label: '12L', value: '12l' },
            { label: '15L', value: '15l' },
            { label: '10L', value: '10l' },
            { label: 'Twin-set 12L', value: 'twin-set-12l' },
            { label: 'Twin-set 10L', value: 'twin-set-10l' },
            { label: 'Twin-set 8L', value: 'twin-set-8l' },

          ],
          admin: {
            description: 'Select the cylinder used for the dive. Not ported from Garmin.',
          },
        },
        {
          name: 'shape',
          type: 'select',
          label: 'Cylinder Shape',
          defaultValue: 'long',
          options: [
            { label: 'Long', value: 'long' },
            { label: 'Dumpy', value: 'dumpy' },
          ],
          admin: {
            condition: (_, siblingData: { selection?: string } | null | undefined) => {
              const selectedCylinder = siblingData?.selection
              return selectedCylinder === '12l' || selectedCylinder === '15l' || selectedCylinder === '10l'
            },
            description: 'Select the shape of the cylinder used for the dive. Not ported from Garmin.',
          },
        },
      ],
    },
    {
      name: 'redundantCylinder',
      type: 'select',
      label: 'Redundant Cylinder',
      defaultValue: 'none',
      options: [
        { label: 'None', value: 'none' },
        { label: '3L Pony', value: '3l-pony' },
        { label: '6L Pony', value: '6l-pony' },

      ],
      admin: {
        description: 'Select the redundant cylinder used for the dive. Not ported from Garmin.',
      },
    },
    {
      name: 'cylinderPressure',
      label: 'Cylinder Pressure (bar)',
      admin: {
        description: 'The pressure of the cylinder at the start and end of the dive. Not ported from Garmin.',
      },
      type: 'group',
      fields: [
        {
          name: 'start',
          type: 'number',
        },
        {
          name: 'end',
          type: 'number',
        },
      ],
    },
    {
      name: 'weight',
      label: 'Weight',
      type: 'group',
      admin: {
        description: 'Lead distribution used for the dive (kg). Not ported from Garmin.',
      },
      fields: [
        {
          name: 'trim',
          type: 'group',
          fields: [
            {
              name: 'leftKg',
              type: 'number',
              min: 0,
              defaultValue: 1,
            },
            {
              name: 'rightKg',
              type: 'number',
              min: 0,
              defaultValue: 1,
            },
          ],
        },
        {
          name: 'pouch',
          type: 'group',
          fields: [
            {
              name: 'leftKg',
              type: 'number',
              min: 0,
              defaultValue: 3,
            },
            {
              name: 'rightKg',
              type: 'number',
              min: 0,
              defaultValue: 3,
            },
          ],
        },
        {
          name: 'beltKg',
          label: 'Belt Weight Kg',
          type: 'number',
          min: 0,
          defaultValue: 0,
        },
      ],
    },
    {
      name: 'exposureProtection',
      type: 'select',
      label: 'Exposure Protection',
      defaultValue: 'Santi E.Lite Drysuit',
      options: [
        { label: 'None', value: 'none' },
        { label: 'Santi E.Lite Drysuit', value: 'Santi E.Lite Drysuit' },
        { label: '5mm Beuchat Wetsuit', value: '5mm Beuchat Wetsuit' },
      ],
      admin: {
        description: 'Select the exposure protection used for the dive. Not ported from Garmin.',
      },
    },
    {
      name: 'startTimeLocal',
      type: 'text',
      required: true,
    },
    {
      name: 'startTimeGMT',
      type: 'text',
      required: true,
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
