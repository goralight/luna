import { CollectionConfig, PayloadComponent } from 'payload'
import CalendarListView from '@/admin/CalendarListView'
import { dayEntryFields } from './fields'
import { dayEntryEndpoints } from './endpoints'

export const DayEntries: CollectionConfig = {
  slug: 'day-entries',
  access: {
    read: () => true,
  },
  admin: {
    useAsTitle: 'date',
    components: {
      views: {
        list: {
          // TODO: need to figure this out
          Component: CalendarListView as unknown as PayloadComponent,
        },
      },
    },
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

