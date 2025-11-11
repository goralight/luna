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
      const trackers = Array.isArray(doc.trackers) ? doc.trackers : []
      if (trackers.length === 0) continue

      const cleaned = trackers.map((b: any) => {
        const blockType = b?.blockType
        let value: string | number | undefined = undefined
        switch (blockType) {
          case 'mood':
            value =
              b?.value != null
                ? String(b.value)
                : b?.moodRating != null && b.moodRating !== ''
                  ? String(b.moodRating)
                  : undefined
            break
          case 'weight':
            value = b?.value != null ? b.value : b?.weight != null ? b.weight : undefined
            break
          case 'diving':
            value = b?.value != null ? b.value : b?.dives != null ? b.dives : undefined
            break
          case 'painting':
            value =
              b?.value != null ? b.value : b?.minutesPainted != null ? b.minutesPainted : undefined
            break
          default:
            break
        }
        return {
          id: randomUUID(),
          blockType,
          value: value as any,
          note: b?.note ?? '',
        }
      })

      await payload.update({
        collection: 'day-entries' as any,
        id: doc.id,
        data: { trackers: cleaned },
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
  // No-op: force migration not reverted
}
