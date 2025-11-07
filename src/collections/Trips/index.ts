import type { CollectionConfig } from 'payload'
import type { Trip, Place } from '@/payload-types'
import { createCachedResponse, roundToDecimals } from '../DayEntry/stats-helpers'
import { getEmojiFlag } from 'countries-list'
import type { TCountryCode } from 'countries-list'
import countriesList from './countriesList'

export const Trips: CollectionConfig = {
  slug: 'trips',
  access: {
    read: () => true,
  },
  admin: {
    useAsTitle: 'city',
    group: 'Map',
    description:
      'Track your journeys. Each trip represents a visit to a city, within an area or region, and country. For example: Corralejo (city) in Fuerteventura (area), Spain (country); or Bratislava (city) in Slovakia (area and country).',
    defaultColumns: ['city', 'place', 'area', 'startDate', 'endDate'],
  },
  fields: [
    {
      name: 'city', // this is the city of the trip, the title
      type: 'text',
      required: true,
      admin: {
        description: 'This is the city of the trip, the title. eg: Corralejo, Bratislava',
      },
    },
    {
      name: 'place', // this is the country or the place of the trip
      type: 'relationship',
      relationTo: 'places',
      required: true,
      admin: {
        description: 'This is the country or the place of the trip. eg: Spain, Slovakia',
      },
    },
    {
      name: 'area', // this is the region / area of the trip
      type: 'text',
      admin: {
        description:
          'This is the region / area of the trip (can be the same as the place). eg: Fuerteventura, Slovakia',
      },
    },
    // for the above, imagine a trip to Corralejo city, in a area of Fuerteventura, in the country of Spain
    // now think of Slovakia, Bratislava city, in a area of Slovakia, in the country of Slovakia
    {
      name: 'tripType',
      type: 'select',
      options: [
        { label: 'City Break', value: 'city-break' },
        { label: 'Beach Break', value: 'beach-break' },
        { label: 'Diving Trip', value: 'diving-trip' },
        { label: 'Country Tour', value: 'country-tour' },
        // add more if needed
      ],
    },
    {
      name: 'startDate',
      type: 'date',
      required: true,
      admin: {
        date: {
          displayFormat: 'dd/MM/yyyy',
        },
      },
    },
    {
      name: 'endDate',
      type: 'date',
      required: true,
      admin: {
        date: {
          displayFormat: 'dd/MM/yyyy',
        },
      },
    },
    {
      name: 'rating',
      type: 'select',
      options: [
        { label: '0', value: '0' },
        { label: '1', value: '1' },
        { label: '2', value: '2' },
        { label: '3', value: '3' },
        { label: '4', value: '4' },
        { label: '5', value: '5' },
      ],
    },
    {
      name: 'images',
      type: 'array',
      fields: [
        {
          name: 'image',
          type: 'relationship',
          relationTo: 'media',
          maxRows: 4,
          hasMany: true,
        },
        {
          name: 'alt',
          type: 'text',
          required: true,
        },
      ],
    },
    {
      name: 'description',
      type: 'textarea',
      required: true,
    },
    {
      name: 'favoriteMemory',
      type: 'textarea',
    },
    {
      name: 'accommodation',
      type: 'text',
    },
    {
      name: 'weather',
      type: 'text',
    },
    {
      name: 'placesVisited',
      type: 'array',
      fields: [
        {
          name: 'place',
          type: 'text',
          required: true,
        },
      ],
    },
    {
      name: 'recommend',
      type: 'select',
      options: [
        { label: 'Yes', value: 'yes' },
        { label: 'Maybe', value: 'maybe' },
        { label: 'No', value: 'no' },
      ],
    },
  ],
  endpoints: [
    {
      path: '/stats',
      method: 'get',
      handler: async (req) => {
        const limit = 100
        let page = 1
        let hasMore = true

        let tripCount = 0

        const countryCounts: Record<
          string,
          { count: number; name: string | null; alpha2: string | null }
        > = {}
        const regionCounts: Record<Place['region'], number> = {} as Record<Place['region'], number>
        const tripTypeCounts: Record<NonNullable<Trip['tripType']>, number> = {} as Record<
          NonNullable<Trip['tripType']>,
          number
        >

        while (hasMore) {
          const result = await req.payload.find({
            collection: 'trips',
            limit,
            page,
            depth: 1,
            sort: '-startDate',
          })

          for (const trip of result.docs as Trip[]) {
            tripCount += 1

            const place: Trip['place'] = trip.place
            const placeId: string | undefined = typeof place === 'string' ? place : place?.id
            if (placeId) {
              const placeName: string | null =
                typeof place === 'object' && place ? (place.name ?? null) : null
              const placeAlpha2: string | null =
                typeof place === 'object' && place ? (place.alpha2 ?? null) : null
              const cKey = String(placeId)
              countryCounts[cKey] = {
                count: (countryCounts[cKey]?.count ?? 0) + 1,
                name: countryCounts[cKey]?.name ?? placeName,
                alpha2: countryCounts[cKey]?.alpha2 ?? placeAlpha2,
              }
              const region: Place['region'] | undefined =
                typeof place === 'object' && place ? place.region : undefined
              if (region) {
                regionCounts[region] = (regionCounts[region] ?? 0) + 1
              }
            }

            const tripType: Trip['tripType'] | undefined = trip.tripType
            if (tripType) {
              const key = tripType as NonNullable<Trip['tripType']>
              tripTypeCounts[key] = (tripTypeCounts[key] ?? 0) + 1
            }
          }

          const processed = (result.page ?? 1) * result.limit
          hasMore = processed < result.totalDocs
          page += 1
        }

        function getTopKey<T extends string>(counts: Record<T, number>): T | null {
          let top: T | null = null
          let topCount = -1
          for (const k in counts) {
            const c = counts[k]
            if (c > topCount) {
              top = k as T
              topCount = c
            }
          }
          return top
        }

        let topCountryCount = -1
        let topCountry: { name: string | null; alpha2: string | null } | null = null
        for (const id in countryCounts) {
          const { count, name, alpha2 } = countryCounts[id]
          if (count > topCountryCount) {
            topCountryCount = count
            topCountry = { name: name ?? null, alpha2: alpha2 ?? null }
          }
        }
        const mostVisitedCountry = topCountry
          ? {
              name: topCountry.name,
              emoji: topCountry.alpha2 ? getEmojiFlag(topCountry.alpha2 as TCountryCode) : null,
            }
          : null

        const mostVisitedRegion = getTopKey(regionCounts)
        const mostCommonTripType = getTopKey(tripTypeCounts)

        const visitedCountryCount = await req.payload.count({
          collection: 'places',
        })
        const totalWorldCountries = countriesList.length
        const coverage = totalWorldCountries
          ? roundToDecimals((visitedCountryCount.totalDocs / totalWorldCountries) * 100, 1)
          : 0

        return createCachedResponse({
          countryCount: visitedCountryCount.totalDocs,
          tripCount,
          mostVisitedCountry,
          mostVisitedRegion,
          mostCommonTripType,
          coverage,
        })
      },
    },
    {
      path: '/by-place/:alpha3',
      method: 'get',
      handler: async (req) => {
        const alpha3FromPath = (req as any)?.routeParams?.alpha3 ?? (req as any)?.params?.alpha3
        const code = alpha3FromPath?.toUpperCase()
        if (!code || !/^[A-Z]{3}$/.test(code)) {
          return Response.json(
            { error: 'Path parameter ":alpha3" (ISO-3166-1 alpha-3) is required' },
            { status: 400 },
          )
        }

        const placeLookup = await req.payload.find({
          collection: 'places',
          where: { code: { equals: code } },
          limit: 1,
        })
        const placeId = placeLookup.docs[0]?.id
        if (!placeId) {
          return Response.json({ error: `No place found for alpha3 code ${code}` }, { status: 404 })
        }

        const result = await req.payload.find({
          collection: 'trips',
          where: { place: { equals: placeId } },
          limit: 1000,
          sort: '-startDate',
          depth: 1,
        })

        return createCachedResponse(result.docs)
      },
    },
  ],
}
