// Types omitted for compatibility across Payload versions
import { randomUUID } from 'crypto'

export const up = async ({ payload }: any): Promise<void> => {
  let currentPage = 1
  let hasMore = true

  while (hasMore) {
    const result = await payload.find({
      collection: 'day-entries' as any,
      limit: 200,
      page: currentPage,
      depth: 0,
    })

    for (const doc of result.docs as any[]) {
      const trackers: any[] = []

      // Build from legacy top-level fields, writing to 'value'
      if (doc.moodRating != null && doc.moodRating !== '') {
        trackers.push({
          id: randomUUID(),
          blockType: 'mood',
          value: String(doc.moodRating),
          note: '',
        })
      }
      if (doc.weight != null) {
        trackers.push({
          id: randomUUID(),
          blockType: 'weight',
          value: doc.weight,
          note: '',
        })
      }
      if (doc.dives != null || (doc.note && String(doc.note).trim() !== '')) {
        trackers.push({
          id: randomUUID(),
          blockType: 'diving',
          value: doc.dives ?? undefined,
          note: doc.note ?? '',
        })
      }
      if (doc.minutesPainted != null) {
        trackers.push({
          id: randomUUID(),
          blockType: 'painting',
          value: doc.minutesPainted,
          note: '',
        })
      }

      await payload.update({
        collection: 'day-entries' as any,
        id: doc.id,
        data: { trackers },
        depth: 0,
        overrideAccess: true,
      } as any)
    }

    const processed = (result.page ?? 1) * result.limit
    hasMore = processed < result.totalDocs
    currentPage++
  }
}

export const down = async ({ payload }: any): Promise<void> => {
  // No rollback for rebuild
}
