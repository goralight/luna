import { CollectionConfig, PayloadComponent } from 'payload'
import { dayEntryFields } from './fields'
import { dayEntryEndpoints } from './endpoints'

let CalendarListViewComponent: PayloadComponent | undefined = undefined
if (!process.env.PAYLOAD_MIGRATING) {
  try {
    const mod = await import('@/admin/CalendarListView')
    CalendarListViewComponent = (mod as any).default as PayloadComponent
  } catch {
    CalendarListViewComponent = undefined
  }
}

export const DayEntries: CollectionConfig = {
  slug: 'day-entries',
  access: {
    read: () => true,
  },
  hooks: {
    beforeValidate: [
      ({ data, operation }: any) => {
        if (operation !== 'create') return data
        const trackers = Array.isArray(data?.trackers) ? data.trackers : []
        const hasMood = trackers.some((b: any) => b?.blockType === 'mood')
        const hasWeight = trackers.some((b: any) => b?.blockType === 'weight')
        const next = [...trackers]
        if (!hasMood) next.push({ blockType: 'mood', value: undefined, note: '' })
        if (!hasWeight) next.push({ blockType: 'weight', value: undefined, note: '' })
        return { ...data, trackers: next }
      },
    ],
  },
  admin: {
    useAsTitle: 'date',
    ...(CalendarListViewComponent
      ? {
          components: {
            views: {
              list: {
                // TODO: need to figure this out
                Component: CalendarListViewComponent as unknown as PayloadComponent,
              },
            },
          },
        }
      : {}),
  },
  indexes: [
    { fields: ['user', 'date'] },
    { fields: ['date', 'moodRating', 'note'] },
    { fields: ['date', 'weight', 'note'] },
    { fields: ['date', 'dives', 'note'] },
    { fields: ['date', 'minutesPainted', 'note'] },
  ],
  fields: dayEntryFields,
  endpoints: dayEntryEndpoints,
}
