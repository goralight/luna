/**
 * Backfill `garmin-dive-time-series` sidecar rows from Garmin FIT (per garmin-dives document).
 *
 * For each dive: downloads the activity FIT from Garmin (by garminActivityId), builds the same
 * time series as sync-garmin-dives-fit.js, then PATCHes (or POSTs) the `garmin-dive-time-series`
 * sidecar for that `garminActivityId`. Main `garmin-dives` documents are not modified.
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
 *   node scripts/backfill-garmin-dive-time-series.js --force   # overwrite existing sidecar row
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

const GARMIN_EMAIL = ''
const GARMIN_PASSWORD = ''

const PAYLOAD_URL = (process.env.PAYLOAD_URL ?? '').replace(/\/$/, '')
const PAYLOAD_USER_EMAIL = process.env.PAYLOAD_USER_EMAIL ?? ''
const PAYLOAD_USER_PASSWORD = process.env.PAYLOAD_USER_PASSWORD ?? ''

const DIVE_COLLECTION_SLUG = 'garmin-dives'
const TIME_SERIES_SLUG = 'garmin-dive-time-series'
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
    const url = new URL(`${apiBase}/${DIVE_COLLECTION_SLUG}`)
    url.searchParams.set('limit', String(PAGE_LIMIT))
    url.searchParams.set('page', String(page))
    url.searchParams.set('depth', '0')

    const resp = await fetch(url.toString(), { headers })
    if (!resp.ok) {
      throw new Error(`List ${DIVE_COLLECTION_SLUG} failed: ${resp.status} ${await resp.text()}`)
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
 * @param {string} garminActivityId
 * @param {unknown} diveTimeSeries
 */
async function upsertDiveTimeSeriesSidecar(headers, garminActivityId, diveTimeSeries) {
  const apiBase = getPayloadApiBase(PAYLOAD_URL)
  const listUrl = `${apiBase}/${TIME_SERIES_SLUG}?where[garminActivityId][equals]=${encodeURIComponent(
    garminActivityId,
  )}&limit=1&depth=0`
  const listResp = await fetch(listUrl, { headers })
  if (!listResp.ok) {
    throw new Error(`List ${TIME_SERIES_SLUG} failed: ${listResp.status} ${await listResp.text()}`)
  }
  const listData = await listResp.json()
  const existing = listData.docs?.[0]
  if (existing?.id) {
    const patchResp = await fetch(`${apiBase}/${TIME_SERIES_SLUG}/${existing.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ diveTimeSeries }),
    })
    if (!patchResp.ok) {
      throw new Error(`PATCH ${TIME_SERIES_SLUG} failed: ${patchResp.status} ${await patchResp.text()}`)
    }
    return
  }
  const postResp = await fetch(`${apiBase}/${TIME_SERIES_SLUG}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ garminActivityId, diveTimeSeries }),
  })
  if (postResp.ok || postResp.status === 201) return
  const postText = await postResp.text()
  if (postResp.status === 400 && postText.includes('unique')) {
    const retry = await fetch(listUrl, { headers })
    const retryData = await retry.json()
    const id = retryData.docs?.[0]?.id
    if (id) {
      const patchResp = await fetch(`${apiBase}/${TIME_SERIES_SLUG}/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ diveTimeSeries }),
      })
      if (!patchResp.ok) {
        throw new Error(`PATCH after race failed: ${patchResp.status} ${await patchResp.text()}`)
      }
      return
    }
  }
  throw new Error(`POST ${TIME_SERIES_SLUG} failed: ${postResp.status} ${postText}`)
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
    dryRun
      ? 'Dry run — no writes.'
      : `Live run — will upsert ${TIME_SERIES_SLUG} rows.`,
  )

  const headers = await payloadHeaders()
  const docs = await fetchAllGarminDiveDocs(headers)
  console.log(`Found ${docs.length} documents in ${DIVE_COLLECTION_SLUG}`)

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

    if (!force) {
      const apiBase = getPayloadApiBase(PAYLOAD_URL)
      const url = `${apiBase}/${TIME_SERIES_SLUG}?where[garminActivityId][equals]=${encodeURIComponent(String(garminActivityId))}&limit=1&depth=0`
      const r = await fetch(url, { headers })
      const d = r.ok ? await r.json() : { docs: [] }
      const row = d.docs?.[0]
      const hasSidecar =
        row?.diveTimeSeries != null &&
        typeof row.diveTimeSeries === 'object' &&
        Object.keys(row.diveTimeSeries).length > 0

      if (hasSidecar) {
        console.log(
          `Skip ${id} (garmin ${garminActivityId}) — sidecar already exists. Use --force to replace.`,
        )
        skipped++
        continue
      }
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
        `[dry-run] would upsert ${TIME_SERIES_SLUG} garminActivityId=${garminActivityId} sampleCount=${diveTimeSeries?.sampleCount}`,
      )
      updated++
      continue
    }

    try {
      await upsertDiveTimeSeriesSidecar(headers, String(garminActivityId), diveTimeSeries)
      console.log(
        `Updated sidecar garminActivityId=${garminActivityId} sampleCount=${diveTimeSeries?.sampleCount}`,
      )
      updated++
    } catch (e) {
      console.error(`Sidecar upsert failed for ${id}:`, e)
      failed++
    }
  }

  console.log(`Done. updated/dry-run: ${updated}, skipped: ${skipped}, failed: ${failed}`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
