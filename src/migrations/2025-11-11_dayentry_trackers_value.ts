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
              delete block.moodRating
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
              delete block.weight
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
              delete block.dives
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
              delete block.minutesPainted
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
        })
      }
    }

    const processed = (result.page ?? 1) * result.limit
    hasMore = processed < result.totalDocs
    currentPage++
  }
}

export const down = async ({ payload }: any): Promise<void> => {
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
            if (block.moodRating == null && block.value != null) {
              block.moodRating = String(block.value)
              changed = true
            }
            if ('value' in block) {
              delete block.value
              changed = true
            }
            break
          }
          case 'weight': {
            if (block.weight == null && block.value != null) {
              block.weight = block.value
              changed = true
            }
            if ('value' in block) {
              delete block.value
              changed = true
            }
            break
          }
          case 'diving': {
            if (block.dives == null && block.value != null) {
              block.dives = block.value
              changed = true
            }
            if ('value' in block) {
              delete block.value
              changed = true
            }
            break
          }
          case 'painting': {
            if (block.minutesPainted == null && block.value != null) {
              block.minutesPainted = block.value
              changed = true
            }
            if ('value' in block) {
              delete block.value
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
        })
      }
    }

    const processed = (result.page ?? 1) * result.limit
    hasMore = processed < result.totalDocs
    currentPage++
  }
}
