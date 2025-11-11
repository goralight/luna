// Types omitted for compatibility across Payload versions

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

      // Mood
      if (doc.moodRating != null && doc.moodRating !== '') {
        trackers.push({
          blockType: 'mood',
          value: String(doc.moodRating),
          note: '',
        })
      }

      // Weight
      if (doc.weight != null) {
        trackers.push({
          blockType: 'weight',
          value: doc.weight,
          note: '',
        })
      }

      // Diving - include legacy note here per requirement
      if (doc.dives != null || (doc.note && String(doc.note).trim() !== '')) {
        trackers.push({
          blockType: 'diving',
          value: doc.dives ?? undefined,
          note: doc.note ?? '',
        })
      }

      // Painting
      if (doc.minutesPainted != null) {
        trackers.push({
          blockType: 'painting',
          value: doc.minutesPainted,
          note: '',
        })
      }

      // Only update if we actually constructed something
      await payload.update({
        collection: 'day-entries' as any,
        id: doc.id,
        data: {
          trackers,
        },
        depth: 0,
      })
    }

    const processed = (result.page ?? 1) * result.limit
    hasMore = processed < result.totalDocs
    currentPage++
  }
}

export const down = async ({ payload }: any): Promise<void> => {
  // Best-effort revert: clear trackers array
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
      await payload.update({
        collection: 'day-entries' as any,
        id: doc.id,
        data: { trackers: [] },
        depth: 0,
      })
    }
    const processed = (result.page ?? 1) * result.limit
    hasMore = processed < result.totalDocs
    currentPage++
  }
}
