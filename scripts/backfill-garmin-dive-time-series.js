/**
 * Backfill `diveTimeSeries` on existing Payload garmin-dives documents.
 *
 * For each dive: downloads the activity FIT from Garmin (by garminActivityId), builds the same
 * time series as sync-garmin-dives-fit.js, then PATCHes only `diveTimeSeries` — no other fields
 * are sent, so Payload merges this single key onto the existing document.
 *
 * Env (same as sync):
 *   PAYLOAD_URL — site origin (https://example.com) or API root (https://example.com/api)
 *   PAYLOAD_USER_EMAIL, PAYLOAD_USER_PASSWORD
 *   GARMIN_EMAIL, GARMIN_PASSWORD (or fill constants below)
 *
 * Optional env:
 *   DIVE_TS_FULL=1 — store full-resolution series (see sync script)
 *   DIVE_TS_KEEP_EVERY=N — when compact (default), keep every Nth sample
 *
 * CLI:
 *   node scripts/backfill-garmin-dive-time-series.js
 *   node scripts/backfill-garmin-dive-time-series.js --dry-run
 *   node scripts/backfill-garmin-dive-time-series.js --force   # overwrite existing diveTimeSeries
 */

import AdmZip from 'adm-zip'
import garminConnectPkg from 'garmin-connect'

const { GarminConnect } = garminConnectPkg
import {
  buildDiveTimeSeriesFromMessages,
  reduceDiveTimeSeries,
} from './build-dive-time-series-from-fit.js'
import { decodeFitFromBuffer } from './fit-to-json.js'
import { getPayloadApiBase } from './payload-api-base.js'

const GARMIN_EMAIL = 'goralight@gmail.com'
const GARMIN_PASSWORD = '@Fo2fc*6v65K#c'

const PAYLOAD_URL = (process.env.PAYLOAD_URL ?? 'https://luna.goralight.com').replace(/\/$/, '')
const PAYLOAD_USER_EMAIL = process.env.PAYLOAD_USER_EMAIL ?? 'me@goralight.com'
const PAYLOAD_USER_PASSWORD = process.env.PAYLOAD_USER_PASSWORD ?? 'zhpF#G32rgsK!Xp^'

const COLLECTION_SLUG = 'garmin-dives'
const PAGE_LIMIT = 50
const GARMIN_REQUEST_GAP_MS = 600

/** @type {string | null} */
let payloadTokenCache = null

function garminEmail() {
  return process.env.GARMIN_EMAIL || GARMIN_EMAIL
}

function garminPassword() {
  return process.env.GARMIN_PASSWORD || GARMIN_PASSWORD
}

function shapeDiveTimeSeriesForPayload(/** @type {Record<string, unknown> | null} */ ts) {
  if (!ts) return ts
  if (process.env.DIVE_TS_FULL === '1') return ts
  const keepEvery = Math.max(1, parseInt(process.env.DIVE_TS_KEEP_EVERY || '2', 10))
  return reduceDiveTimeSeries(ts, {
    keepEvery,
    decimals: 2,
    omitTimestampGmt: true,
    omitTOffsetSec: true,
    omitTankPressureSamples: true,
    stripAvailabilityNotes: true,
  })
}

async function getPayloadToken() {
  if (payloadTokenCache) return payloadTokenCache
  if (!PAYLOAD_USER_EMAIL || !PAYLOAD_USER_PASSWORD) {
    throw new Error('PAYLOAD_USER_EMAIL and PAYLOAD_USER_PASSWORD must be set')
  }
  if (!PAYLOAD_URL) {
    throw new Error('PAYLOAD_URL must be set')
  }
  const apiBase = getPayloadApiBase(PAYLOAD_URL)
  const resp = await fetch(`${apiBase}/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: PAYLOAD_USER_EMAIL,
      password: PAYLOAD_USER_PASSWORD,
    }),
  })
  if (!resp.ok) {
    throw new Error(`Payload login failed: ${resp.status} ${await resp.text()}`)
  }
  const data = await resp.json()
  const token = data.token
  if (!token) {
    throw new Error('No token returned from Payload login response')
  }
  payloadTokenCache = token
  return token
}

async function payloadHeaders() {
  const token = await getPayloadToken()
  return {
    Authorization: `JWT ${token}`,
    'Content-Type': 'application/json',
  }
}

/**
 * @param {ArrayBuffer | Buffer} zipBytes
 */
function extractFitFromActivityZip(zipBytes) {
  const buf = Buffer.isBuffer(zipBytes) ? zipBytes : Buffer.from(zipBytes)
  const zip = new AdmZip(buf)
  const entries = zip.getEntries()
  const fitEntry = entries.find((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith('.fit'))
  if (!fitEntry) return null
  return fitEntry.getData()
}

/**
 * @param {import('garmin-connect').default} gc
 * @param {number} activityId
 */
async function downloadActivityZip(gc, activityId) {
  return gc.client.get(gc.url.DOWNLOAD_ZIP + activityId, {
    responseType: 'arraybuffer',
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * @param {Record<string, unknown>} headers
 */
async function fetchAllGarminDiveDocs(headers) {
  const apiBase = getPayloadApiBase(PAYLOAD_URL)
  const docs = []
  let page = 1
  let hasNext = true
  while (hasNext) {
    const url = new URL(`${apiBase}/${COLLECTION_SLUG}`)
    url.searchParams.set('limit', String(PAGE_LIMIT))
    url.searchParams.set('page', String(page))
    url.searchParams.set('depth', '0')

    const resp = await fetch(url.toString(), { headers })
    if (!resp.ok) {
      throw new Error(`List ${COLLECTION_SLUG} failed: ${resp.status} ${await resp.text()}`)
    }
    const data = await resp.json()
    const batch = data.docs ?? []
    docs.push(...batch)
    hasNext = Boolean(data.hasNextPage)
    page += 1
  }
  return docs
}

/**
 * @param {Record<string, unknown>} headers
 * @param {string} id
 * @param {unknown} diveTimeSeries
 */
async function patchDiveTimeSeriesOnly(headers, id, diveTimeSeries) {
  const apiBase = getPayloadApiBase(PAYLOAD_URL)
  const resp = await fetch(`${apiBase}/${COLLECTION_SLUG}/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ diveTimeSeries }),
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`PATCH ${id} failed: ${resp.status} ${text}`)
  }
}

function parseFlags(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    force: argv.includes('--force'),
  }
}

async function main() {
  const { dryRun, force } = parseFlags(process.argv.slice(2))

  const email = garminEmail()
  const password = garminPassword()
  if (!email || !password) {
    throw new Error(
      'Set GARMIN_EMAIL and GARMIN_PASSWORD (env or top of backfill-garmin-dive-time-series.js).',
    )
  }
  if (!PAYLOAD_URL) {
    throw new Error('PAYLOAD_URL must be set')
  }

  console.log(
    dryRun ? 'Dry run — no PATCH requests will be sent.' : 'Live run — will PATCH diveTimeSeries.',
  )

  const headers = await payloadHeaders()
  console.log('headers', headers)
  const docs = await fetchAllGarminDiveDocs(headers)
  console.log('docs', docs)
  console.log(`Found ${docs.length} documents in ${COLLECTION_SLUG}`)

  const gc = new GarminConnect({ username: email, password })
  await gc.login()

  let skipped = 0
  let updated = 0
  let failed = 0

  for (const doc of docs) {
    const id = doc.id
    const garminActivityId = doc.garminActivityId
    if (!id || garminActivityId == null || garminActivityId === '') {
      console.warn('Skip doc without id or garminActivityId:', id)
      skipped++
      continue
    }

    const hasSeries =
      doc.diveTimeSeries != null &&
      typeof doc.diveTimeSeries === 'object' &&
      Object.keys(doc.diveTimeSeries).length > 0

    if (hasSeries && !force) {
      console.log(
        `Skip ${id} (garmin ${garminActivityId}) — already has diveTimeSeries. Use --force to replace.`,
      )
      skipped++
      continue
    }

    const activityId = Number(garminActivityId)
    if (!Number.isFinite(activityId)) {
      console.warn(`Skip ${id} — invalid garminActivityId: ${garminActivityId}`)
      skipped++
      continue
    }

    let fitBuf
    try {
      const zipBytes = await downloadActivityZip(gc, activityId)
      fitBuf = extractFitFromActivityZip(zipBytes)
    } catch (e) {
      console.warn(`Garmin download failed for activity ${activityId}:`, e)
      failed++
      await sleep(GARMIN_REQUEST_GAP_MS)
      continue
    }

    await sleep(GARMIN_REQUEST_GAP_MS)

    if (!fitBuf) {
      console.warn(`No .fit in ZIP for activity ${activityId} (doc ${id})`)
      failed++
      continue
    }

    const { messages, errors } = decodeFitFromBuffer(fitBuf)
    if (errors?.length) {
      console.warn(`FIT decode warnings for ${activityId}:`, errors)
    }

    const rawTs = buildDiveTimeSeriesFromMessages(/** @type {Record<string, unknown>} */ (messages))
    if (!rawTs) {
      console.warn(`No recordMesgs / time series for activity ${activityId} (doc ${id})`)
      failed++
      continue
    }

    const diveTimeSeries = shapeDiveTimeSeriesForPayload(
      /** @type {Record<string, unknown>} */ (rawTs),
    )

    if (dryRun) {
      console.log(
        `[dry-run] would PATCH ${id} garminActivityId=${garminActivityId} sampleCount=${diveTimeSeries?.sampleCount}`,
      )
      updated++
      continue
    }

    try {
      await patchDiveTimeSeriesOnly(headers, id, diveTimeSeries)
      console.log(
        `Updated ${id} garminActivityId=${garminActivityId} sampleCount=${diveTimeSeries?.sampleCount}`,
      )
      updated++
    } catch (e) {
      console.error(`PATCH failed for ${id}:`, e)
      failed++
    }
  }

  console.log(`Done. updated/dry-run: ${updated}, skipped: ${skipped}, failed: ${failed}`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
