import { CollectionConfig } from 'payload'

/**
 * Heavy FIT-derived chart columns per dive. Keyed by Garmin activity id so sync and API stay aligned
 * with `garmin-dives` without loading megabytes in the admin dive editor.
 */
export const GarminDiveTimeSeries: CollectionConfig = {
  slug: 'garmin-dive-time-series',
  defaultSort: '-updatedAt',
  access: {
    read: () => true,
  },
  admin: {
    useAsTitle: 'garminActivityId',
    group: 'Diving',
    description:
      'Dive depth/temperature/SAC/tank samples from FIT. One row per Garmin activity; linked by garminActivityId.',
    defaultColumns: ['garminActivityId', 'updatedAt'],
  },
  indexes: [{ fields: ['garminActivityId'] }],
  fields: [
    {
      name: 'garminActivityId',
      type: 'text',
      required: true,
      unique: true,
      admin: {
        description: 'Same value as garmin-dives.garminActivityId for this dive.',
      },
    },
    {
      name: 'diveTimeSeries',
      type: 'json',
      required: true,
      label: 'Dive time series (from FIT)',
      admin: {
        description:
          'Columnar samples for charts. Written by scripts/sync-garmin-dives-fit.js or backfill.',
      },
    },
  ],
}
