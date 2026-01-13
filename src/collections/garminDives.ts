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
      name: 'location',
      type: 'text',
    },
    {
      name: 'raw',
      type: 'json',
      admin: { description: 'Full raw Garmin activity payload.' },
    },
  ],
}
