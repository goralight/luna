// Same logic as 2025-03-22 — separate file so this runs if 2025-03-22 already executed
// while `up` still used `payload.find` (strings never appeared in API results).
// Idempotent: after migration, no docs match `description: { $type: 'string' }`.
import { randomUUID } from 'crypto'

function toPayloadId(doc: { _id?: { toHexString?: () => string } }): string {
  const id = doc._id
  if (id != null && typeof id.toHexString === 'function') {
    return id.toHexString()
  }
  return String(id)
}

export const up = async ({ payload, session }: any): Promise<void> => {
  const mongoCollection = payload.db.collections.trips.collection

  const cursor = mongoCollection.find(
    { description: { $type: 'string' } },
    { projection: { _id: 1, description: 1 }, session },
  )

  for await (const raw of cursor) {
    const description = raw.description
    if (typeof description !== 'string') {
      continue
    }

    await payload.update({
      collection: 'trips' as any,
      id: toPayloadId(raw),
      data: {
        description: [{ id: randomUUID(), paragraph: description }],
      },
      depth: 0,
      overrideAccess: true,
    } as any)
  }
}

export const down = async (_args: any): Promise<void> => {}
