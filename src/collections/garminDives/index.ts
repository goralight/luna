import { CollectionConfig } from 'payload'
import { garminDiveEndpoints } from './endpoints'
import { garminDiveFields } from './fields'

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
        const diveType = (data?.diveType as string | undefined) ?? (originalDoc?.diveType as string | undefined)
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
  fields: garminDiveFields,
  endpoints: garminDiveEndpoints,
}

