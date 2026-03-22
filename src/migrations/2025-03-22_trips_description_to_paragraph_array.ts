// Types omitted for compatibility across Payload versions
// Legacy `description` strings are stripped by Payload when the field is an array in config,
// so we read raw BSON from the Mongo driver, then write via the Local API.
// If this migration already ran with the old `payload.find` implementation, run migrate again
// so `2025-03-23_trips_description_migrate_legacy_strings.ts` executes.
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

export const down = async (_args: any): Promise<void> => {
  // No-op: `description` is an array in the current schema; writing a legacy string would fail
  // validation unless the collection is temporarily reverted to a textarea field.
}
