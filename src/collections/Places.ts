import { Place } from '@/payload-types'
import { CollectionConfig } from 'payload'
import { createCachedResponse } from './DayEntry/stats-helpers'

export const Places: CollectionConfig = {
  slug: 'places',
  access: {
    read: () => true,
  },
  admin: {
    useAsTitle: 'name',
    group: 'Map',
  },
  fields: [
    {
      name: 'code',
      type: 'text',
      required: true,
      unique: true,
      validate: (v: string | null | undefined) =>
        /^[A-Z]{3}$/.test(v ?? '') || 'Use ISO-3166-1 alpha-3 (e.g., GBR, USA, FRA).',
      admin: {
        description:
          'Use ISO-3166-1 alpha-3 (e.g., GBR, USA, FRA). https://www.iso.org/obp/ui/#home',
      },
    },
    { name: 'name', type: 'text', required: true },
    {
      name: 'alpha2',
      type: 'text',
      required: true,
      admin: {
        description: 'Use ISO-3166-1 alpha-2 (e.g., GB, US, FR). https://www.iso.org/obp/ui/#home',
      },
    },
    {
      name: 'region',
      type: 'select',
      options: [
        { label: 'Europe', value: 'EU' },
        { label: 'North America', value: 'NA' },
        { label: 'South America', value: 'SA' },
        { label: 'Asia', value: 'AS' },
        { label: 'Africa', value: 'AF' },
        { label: 'Oceania', value: 'OC' },
      ],
      defaultValue: 'EU',
      unique: false,
      required: true,
    },
  ],
  indexes: [
    { fields: ['code'], unique: true },
    { fields: ['alpha2'], unique: true },
    { fields: ['region'] },
    { fields: ['name'], unique: true },
    { fields: ['code', 'region', 'name', 'alpha2'] },
  ],
  hooks: {
    beforeChange: [
      ({ data }) => {
        if (data?.code) data.code = data.code.toUpperCase()
        if (data?.alpha2) data.alpha2 = data.alpha2.toUpperCase()
        return data
      },
    ],
  },
  endpoints: [
    {
      path: '/by-regions',
      method: 'get',
      handler: async (req) => {
        const { docs } = await req.payload.find({
          collection: 'places',
          limit: 1000,
        })

        const summary: Record<string, { count: number; places: Place[] }> = {}

        for (const place of docs) {
          const region = place.region
          if (!summary[region]) {
            summary[region] = { count: 0, places: [] }
          }
          summary[region].places.push(place)
          summary[region].count += 1
        }

        return createCachedResponse(summary)
      },
    },
  ],
}
