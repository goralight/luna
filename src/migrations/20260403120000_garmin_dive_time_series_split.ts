/**
 * Move `diveTimeSeries` JSON off `garmin-dives` into `garmin-dive-time-series` (one doc per garminActivityId).
 * Run after deploying the collection split. Raw Mongo is used to read legacy `diveTimeSeries` keys
 * that are no longer in the garmin-dives schema.
 */

export const up = async ({ payload }: { payload: any }): Promise<void> => {
  const DiveModel = payload.db.collections['garmin-dives']
  if (!DiveModel?.collection) {
    throw new Error('Migration: garmin-dives model not found on payload.db')
  }

  const cursor = DiveModel.collection.find({
    diveTimeSeries: { $exists: true, $ne: null },
  })

  for await (const doc of cursor) {
    const ts = doc.diveTimeSeries
    const gid = doc.garminActivityId
    if (gid == null || ts == null) continue
    if (typeof ts === 'object' && !Array.isArray(ts) && Object.keys(ts).length === 0) continue

    const garminActivityId = String(gid)

    const existing = await payload.find({
      collection: 'garmin-dive-time-series',
      where: { garminActivityId: { equals: garminActivityId } },
      limit: 1,
      pagination: false,
      depth: 0,
    })

    if (existing.docs.length > 0) {
      await payload.update({
        collection: 'garmin-dive-time-series',
        id: existing.docs[0].id,
        data: { diveTimeSeries: ts },
        depth: 0,
      })
    } else {
      await payload.create({
        collection: 'garmin-dive-time-series',
        data: {
          garminActivityId,
          diveTimeSeries: ts,
        },
        depth: 0,
      })
    }

    await DiveModel.collection.updateOne({ _id: doc._id }, { $unset: { diveTimeSeries: '' } })
  }
}

export const down = async ({ payload }: { payload: any }): Promise<void> => {
  const DiveModel = payload.db.collections['garmin-dives']
  const SeriesModel = payload.db.collections['garmin-dive-time-series']
  if (!DiveModel?.collection || !SeriesModel) {
    return
  }

  const rows = await SeriesModel.find({}).lean()
  for (const row of rows) {
    const gid = row.garminActivityId
    const ts = row.diveTimeSeries
    if (gid == null || ts == null) continue

    await DiveModel.collection.updateOne(
      { garminActivityId: String(gid) },
      { $set: { diveTimeSeries: ts } },
    )
  }

  await SeriesModel.deleteMany({})
}
