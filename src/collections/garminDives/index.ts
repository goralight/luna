import { CollectionConfig } from 'payload'
import { garminDiveEndpoints } from './endpoints'
import { garminDiveFields } from './fields'
import { findDiveTimeSeriesByActivityId } from './loadDiveTimeSeries'

export const GarminDives: CollectionConfig = {
  slug: 'garmin-dives',
  defaultSort: '-startTimeGMT',
  access: {
    read: () => true,
  },
  admin: {
    useAsTitle: 'title',
    group: 'Diving',
    description:
      'Scuba dives imported from Garmin Connect. Some fields are not ported from Garmin. These are marked with "Not ported from Garmin."',
    defaultColumns: ['diveNumber', 'startTimeGMT', 'durationSeconds', 'maxDepthMeters', 'title', 'location'],
  },
  indexes: [
    { fields: ['startTimeGMT'] },
    { fields: ['startTimeLocal'] },
    { fields: ['maxDepthMeters'] },
    { fields: ['diveType'] },
    { fields: ['diveNumber'] },
  ],
  hooks: {
    beforeValidate: [
      ({ data, originalDoc }) => {
        if (data && typeof data === 'object' && 'diveTimeSeries' in data) {
          delete (data as Record<string, unknown>).diveTimeSeries
        }
        const diveType = (data?.diveType as string | undefined) ?? (originalDoc?.diveType as string | undefined)
        if (diveType === 'recreational' && data) {
          const mutableData = data as Record<string, unknown>
          delete mutableData.diveCourse
        }
      },
    ],
    beforeChange: [
      ({ data }) => {
        if (data && typeof data === 'object' && 'diveTimeSeries' in data) {
          delete (data as Record<string, unknown>).diveTimeSeries
        }
      },
    ],
    afterRead: [
      async ({ doc, findMany, req }) => {
        let next = doc as Record<string, unknown>
        if ((next?.diveType as string | undefined) === 'recreational') {
          next = { ...next }
          delete next.diveCourse
        }
        if (
          !findMany &&
          !req.context?.omitDiveTimeSeriesMerge &&
          next?.garminActivityId != null &&
          String(next.garminActivityId).trim() !== ''
        ) {
          const series = await findDiveTimeSeriesByActivityId(req.payload, String(next.garminActivityId))
          if (series != null) {
            next = { ...next, diveTimeSeries: series }
          }
        }
        return next
      },
    ],
  },
  fields: garminDiveFields,
  endpoints: garminDiveEndpoints,
}

