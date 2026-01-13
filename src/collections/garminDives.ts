import type { CollectionConfig } from 'payload'

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
  indexes: [{ fields: ['startTimeGMT'] }, { fields: ['startTimeLocal'] }],
  fields: [
    {
      name: 'garminActivityId',
      type: 'text',
      required: true,
      unique: true,
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
}
