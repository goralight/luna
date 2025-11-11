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
      const trackers = Array.isArray(doc.trackers) ? [...doc.trackers] : []
      let changed = false
      const next = trackers.map((b) => {
        const block = { ...b }
        switch (block?.blockType) {
          case 'mood': {
            if (block.value == null && block.moodRating != null && block.moodRating !== '') {
              block.value = String(block.moodRating)
              changed = true
            }
            if ('moodRating' in block) {
              delete (block as any).moodRating
              changed = true
            }
            break
          }
          case 'weight': {
            if (block.value == null && block.weight != null) {
              block.value = block.weight
              changed = true
            }
            if ('weight' in block) {
              delete (block as any).weight
              changed = true
            }
            break
          }
          case 'diving': {
            if (block.value == null && block.dives != null) {
              block.value = block.dives
              changed = true
            }
            if ('dives' in block) {
              delete (block as any).dives
              changed = true
            }
            break
          }
          case 'painting': {
            if (block.value == null && block.minutesPainted != null) {
              block.value = block.minutesPainted
              changed = true
            }
            if ('minutesPainted' in block) {
              delete (block as any).minutesPainted
              changed = true
            }
            break
          }
          default:
            break
        }
        return block
      })

      if (changed) {
        await payload.update({
          collection: 'day-entries' as any,
          id: doc.id,
          data: { trackers: next },
          depth: 0,
          overrideAccess: true,
        } as any)
      }
    }

    const processed = (result.page ?? 1) * result.limit
    hasMore = processed < result.totalDocs
    currentPage++
  }
}

export const down = async ({ payload }: any): Promise<void> => {
  // No-op: we won't revert this fix migration
}
