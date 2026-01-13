import type { CollectionConfig } from 'payload'

export const GarminDives: CollectionConfig = {
  slug: 'garmin-dives',
  access: {
    read: () => true,
  },
  admin: {
    useAsTitle: 'title',
    group: 'Health',
    description: 'Scuba dives imported from Garmin Connect.',
    defaultColumns: ['startTime', 'durationSeconds', 'maxDepthMeters', 'location'],
  },
  fields: [
    {
      name: 'garminActivityId',
      type: 'text',
      required: true,
      unique: true,
    },
    {
      name: 'title',
      type: 'text',
    },
    {
      name: 'startTime',
      type: 'date',
      required: true,
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
    {
      name: 'raw',
      type: 'json',
      admin: { description: 'Full raw Garmin activity payload.' },
    },
  ],
}
