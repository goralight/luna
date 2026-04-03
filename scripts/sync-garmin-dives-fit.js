/**
 * Sync scuba dives from Garmin Connect into Payload, using FIT files (decoded via fit-to-json.js)
 * for depth, duration, gases, temperature, and chart time series — similar to scripts/sync_garmin_dives.py.
 *
 * Each dive POSTs metadata to `garmin-dives` and chart JSON to `garmin-dive-time-series` (same
 * shape as `buildDiveTimeSeriesFromMessages` / compact by default). REST single-doc reads merge
 * `diveTimeSeries` via Payload `afterRead`.
 *
 * Requires: PAYLOAD_URL (site origin or …/api), PAYLOAD_USER_EMAIL, PAYLOAD_USER_PASSWORD (or fill GARMIN_* below).
 *
 * Garmin auth:
 *   - Set GARMIN_TOKEN_DIR to a directory; if oauth1_token.json + oauth2_token.json exist (garmin-connect
 *     format), SSO is skipped — use for CI (cache this directory between runs).
 *   - Otherwise GARMIN_EMAIL + GARMIN_PASSWORD (first run or when cache missing).
 *
 * Env: DIVE_TS_FULL=1 for full-resolution time series (large). Optional DIVE_TS_KEEP_EVERY=N when compact (default 2).
 */

import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import garminConnectPkg from 'garmin-connect';

const { GarminConnect } = garminConnectPkg;
import {
  buildDiveTimeSeriesFromMessages,
  getCylinderPressureBarFromFitMessages,
  reduceDiveTimeSeries,
} from './build-dive-time-series-from-fit.js';
import { decodeFitFromBuffer } from './fit-to-json.js';
import { getPayloadApiBase } from './payload-api-base.js';

// Fill in your Garmin Connect credentials (or set GARMIN_EMAIL / GARMIN_PASSWORD in the environment).
const GARMIN_EMAIL = '';
const GARMIN_PASSWORD = '';

const PAYLOAD_URL = (process.env.PAYLOAD_URL ?? '').replace(/\/$/, '');
const PAYLOAD_USER_EMAIL = process.env.PAYLOAD_USER_EMAIL ?? '';
const PAYLOAD_USER_PASSWORD = process.env.PAYLOAD_USER_PASSWORD ?? '';

const PAGE_SIZE = 100;
const FIRST_SYNC_DAYS = 780;

/**
 * Compact time series for Payload (same idea as `time-series-from-decoded-json.js --compact`).
 * Set DIVE_TS_FULL=1 to store every sample + ISO timestamps + tankPressureSamples (much larger).
 */
function shapeDiveTimeSeriesForPayload(/** @type {Record<string, unknown> | null} */ ts) {
  if (!ts) return ts;
  if (process.env.DIVE_TS_FULL === '1') return ts;
  const keepEvery = Math.max(1, parseInt(process.env.DIVE_TS_KEEP_EVERY || '2', 10));
  return reduceDiveTimeSeries(ts, {
    keepEvery,
    decimals: 2,
    omitTimestampGmt: true,
    omitTOffsetSec: true,
    omitTankPressureSamples: true,
    stripAvailabilityNotes: true,
  });
}

/** @type {string | null} */
let payloadTokenCache = null;

function garminEmail() {
  return process.env.GARMIN_EMAIL || GARMIN_EMAIL;
}

function garminPassword() {
  return process.env.GARMIN_PASSWORD || GARMIN_PASSWORD;
}

function garminOAuthFilesPresent(/** @type {string} */ tokenDir) {
  const o1 = path.join(tokenDir, 'oauth1_token.json');
  const o2 = path.join(tokenDir, 'oauth2_token.json');
  return fs.existsSync(o1) && fs.existsSync(o2);
}

/**
 * @returns {Promise<InstanceType<typeof GarminConnect>>}
 */
async function createGarminClient() {
  const tokenDir = process.env.GARMIN_TOKEN_DIR?.trim() ?? '';
  const email = garminEmail();
  const password = garminPassword();

  const gc = new GarminConnect({
    username: email || 'garmin-token-cache',
    password: password || 'garmin-token-cache',
  });

  if (tokenDir && garminOAuthFilesPresent(tokenDir)) {
    gc.loadTokenByFile(tokenDir);
    console.log('Using cached Garmin Connect OAuth tokens from', tokenDir);
    return gc;
  }

  if (!email || !password) {
    throw new Error(
      'Set GARMIN_EMAIL and GARMIN_PASSWORD, or point GARMIN_TOKEN_DIR at a folder containing ' +
        'oauth1_token.json and oauth2_token.json (create by logging in once locally, then gc.exportTokenToFile(dir)).',
    );
  }

  await gc.login();
  if (tokenDir) {
    gc.exportTokenToFile(tokenDir);
    console.log('Saved Garmin Connect OAuth tokens to', tokenDir);
  }
  return gc;
}

async function getPayloadToken() {
  if (payloadTokenCache) return payloadTokenCache;
  if (!PAYLOAD_USER_EMAIL || !PAYLOAD_USER_PASSWORD) {
    throw new Error('PAYLOAD_USER_EMAIL and PAYLOAD_USER_PASSWORD must be set');
  }
  if (!PAYLOAD_URL) {
    throw new Error('PAYLOAD_URL must be set');
  }
  const apiBase = getPayloadApiBase(PAYLOAD_URL);
  const resp = await fetch(`${apiBase}/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: PAYLOAD_USER_EMAIL,
      password: PAYLOAD_USER_PASSWORD,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Payload login failed: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  const token = data.token;
  if (!token) {
    throw new Error('No token returned from Payload login response');
  }
  payloadTokenCache = token;
  return token;
}

async function payloadHeaders() {
  const token = await getPayloadToken();
  return {
    Authorization: `JWT ${token}`,
    'Content-Type': 'application/json',
  };
}

async function getLastSyncedStartTimeGmt() {
  if (!PAYLOAD_URL) {
    throw new Error('PAYLOAD_URL must be set');
  }
  const apiBase = getPayloadApiBase(PAYLOAD_URL);
  const resp = await fetch(
    `${apiBase}/garmin-dives?limit=1&sort=-startTimeGMT`,
    { headers: await payloadHeaders() },
  );
  if (!resp.ok) {
    throw new Error(`Payload garmin-dives list failed: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  const docs = data.docs ?? [];
  if (!docs.length) return null;
  return docs[0].startTimeGMT;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function cmToM(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n / 100 : null;
}

/**
 * FIT semicircles → degrees (WGS84).
 * @param {number | undefined} semicircles
 */
function semicirclesToDegrees(semicircles) {
  if (semicircles == null || typeof semicircles !== 'number') return null;
  return (semicircles / 2 ** 31) * 180;
}

/**
 * @param {Record<string, unknown>} activity
 */
function extractGasesFromActivity(activity) {
  const info = activity.summarizedDiveInfo;
  if (!info || typeof info !== 'object') return [];
  const gases = /** @type {{ oxygenContent?: number; heliumContent?: number }[]} */ (
    /** @type {{ summarizedDiveGases?: unknown }} */ (info).summarizedDiveGases ?? []
  );
  const result = [];
  for (const gas of gases) {
    if (!gas || typeof gas !== 'object') continue;
    const oxygen = gas.oxygenContent;
    if (oxygen == null) continue;
    result.push({
      oxygenPercent: oxygen,
      heliumPercent: gas.heliumContent ?? 0,
    });
  }
  return result;
}

/**
 * @param {Record<string, unknown>} activity
 * @param {Record<string, unknown>} messages
 */
function transformDive(activity, messages) {
  const startLocal = activity.startTimeLocal;
  const startGmt = activity.startTimeGMT;
  if (!startLocal || !startGmt) {
    console.warn('Skipping activity without timestamps:', activity.activityId);
    return null;
  }

  const diveSummary = messages.diveSummaryMesgs?.[0];
  const session =
    messages.sessionMesgs?.find((s) => s.sport === 'diving') ?? messages.sessionMesgs?.[0];

  let gases = (messages.diveGasMesgs ?? [])
    .map((g) => {
      const o2 = g.oxygenContent;
      if (o2 == null) return null;
      return { oxygenPercent: o2, heliumPercent: g.heliumContent ?? 0 };
    })
    .filter(Boolean);
  if (!gases.length) {
    gases = extractGasesFromActivity(activity);
  }

  const durationSeconds =
    diveSummary?.bottomTime ??
    session?.totalTimerTime ??
    session?.totalElapsedTime ??
    (typeof activity.duration === 'number' ? activity.duration : null) ??
    (typeof activity.movingDuration === 'number' ? activity.movingDuration : null) ??
    null;

  const maxDepthMeters =
    diveSummary?.maxDepth ?? cmToM(activity.maxDepth);
  const avgDepthMeters =
    diveSummary?.avgDepth ?? cmToM(activity.avgDepth);

  const surfaceIntervalSeconds =
    diveSummary?.surfaceInterval != null ? diveSummary.surfaceInterval : null;

  const temperature = {
    min: session?.minTemperature ?? activity.minTemperature ?? null,
    max: session?.maxTemperature ?? activity.maxTemperature ?? null,
  };

  const lat =
    session?.startPositionLat != null
      ? semicirclesToDegrees(session.startPositionLat)
      : activity.startLatitude ?? null;
  const lon =
    session?.startPositionLong != null
      ? semicirclesToDegrees(session.startPositionLong)
      : activity.startLongitude ?? null;

  const diveTimeSeries = shapeDiveTimeSeriesForPayload(
    buildDiveTimeSeriesFromMessages(messages),
  );

  const cylinderPressure = getCylinderPressureBarFromFitMessages(messages);

  return {
    garminActivityId: String(activity.activityId),
    title: activity.activityName,
    durationSeconds,
    maxDepthMeters,
    avgDepthMeters,
    surfaceIntervalSeconds,
    gases,
    location: activity.locationName,
    temperature,
    coordinates: { latitude: lat, longitude: lon },
    startTimeLocal: startLocal,
    startTimeGMT: startGmt,
    diveType: 'recreational',
    diveTimeSeries,
    ...(cylinderPressure &&
    (cylinderPressure.start != null || cylinderPressure.end != null)
      ? { cylinderPressure }
      : {}),
  };
}

/**
 * @param {ArrayBuffer | Buffer} zipBytes
 * @returns {Buffer | null}
 */
function extractFitFromActivityZip(zipBytes) {
  const buf = Buffer.isBuffer(zipBytes) ? zipBytes : Buffer.from(zipBytes);
  const zip = new AdmZip(buf);
  const entries = zip.getEntries();
  const fitEntry = entries.find(
    (e) => !e.isDirectory && e.entryName.toLowerCase().endsWith('.fit'),
  );
  if (!fitEntry) return null;
  return fitEntry.getData();
}

/**
 * @param {GarminConnect} gc
 * @param {number} activityId
 */
async function downloadActivityZip(gc, activityId) {
  return gc.client.get(gc.url.DOWNLOAD_ZIP + activityId, {
    responseType: 'arraybuffer',
  });
}

const GARMIN_DIVE_TIME_SERIES_SLUG = 'garmin-dive-time-series';

/**
 * @param {Record<string, string>} headers
 * @param {string} garminActivityId
 * @param {Record<string, unknown> | null | undefined} diveTimeSeries
 */
async function upsertDiveTimeSeriesSidecar(headers, garminActivityId, diveTimeSeries) {
  if (
    diveTimeSeries == null ||
    (typeof diveTimeSeries === 'object' &&
      !Array.isArray(diveTimeSeries) &&
      Object.keys(diveTimeSeries).length === 0)
  ) {
    return;
  }
  const apiBase = getPayloadApiBase(PAYLOAD_URL);
  const listUrl = `${apiBase}/${GARMIN_DIVE_TIME_SERIES_SLUG}?where[garminActivityId][equals]=${encodeURIComponent(
    garminActivityId,
  )}&limit=1&depth=0`;
  const listResp = await fetch(listUrl, { headers });
  if (!listResp.ok) {
    throw new Error(
      `List ${GARMIN_DIVE_TIME_SERIES_SLUG} failed: ${listResp.status} ${await listResp.text()}`,
    );
  }
  const listData = await listResp.json();
  const existing = listData.docs?.[0];
  if (existing?.id) {
    const patchResp = await fetch(`${apiBase}/${GARMIN_DIVE_TIME_SERIES_SLUG}/${existing.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ diveTimeSeries }),
    });
    if (!patchResp.ok) {
      throw new Error(
        `PATCH ${GARMIN_DIVE_TIME_SERIES_SLUG} failed: ${patchResp.status} ${await patchResp.text()}`,
      );
    }
    return;
  }
  const postResp = await fetch(`${apiBase}/${GARMIN_DIVE_TIME_SERIES_SLUG}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ garminActivityId, diveTimeSeries }),
  });
  if (postResp.ok || postResp.status === 201) return;
  const postText = await postResp.text();
  if (postResp.status === 400 && postText.includes('unique')) {
    const retry = await fetch(listUrl, { headers });
    if (!retry.ok) {
      throw new Error(`List after duplicate failed: ${retry.status} ${await retry.text()}`);
    }
    const retryData = await retry.json();
    const id = retryData.docs?.[0]?.id;
    if (id) {
      const patchResp = await fetch(`${apiBase}/${GARMIN_DIVE_TIME_SERIES_SLUG}/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ diveTimeSeries }),
      });
      if (!patchResp.ok) {
        throw new Error(
          `PATCH after race failed: ${patchResp.status} ${await patchResp.text()}`,
        );
      }
      return;
    }
  }
  throw new Error(`POST ${GARMIN_DIVE_TIME_SERIES_SLUG} failed: ${postResp.status} ${postText}`);
}

/**
 * @param {Record<string, unknown>} payload - must not include diveTimeSeries (sidecar collection)
 */
async function saveDiveToPayload(payload) {
  const apiBase = getPayloadApiBase(PAYLOAD_URL);
  const resp = await fetch(`${apiBase}/garmin-dives`, {
    method: 'POST',
    headers: await payloadHeaders(),
    body: JSON.stringify(payload),
  });

  if (resp.status === 200 || resp.status === 201) return;

  const text = await resp.text();
  if (resp.status === 400 && text.includes('Value must be unique')) return;

  console.error('Payload returned error:', resp.status, text);
  throw new Error(`Payload POST failed: ${resp.status}`);
}

/**
 * @param {GarminConnect} gc
 * @param {string} startDateYmd
 * @param {string} endDateYmd
 */
async function fetchActivitiesByDateRange(gc, startDateYmd, endDateYmd) {
  const all = [];
  let start = 0;
  while (true) {
    const batch = await gc.client.get(gc.url.ACTIVITIES, {
      params: {
        startDate: startDateYmd,
        endDate: endDateYmd,
        start,
        limit: PAGE_SIZE,
      },
    });
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    start += PAGE_SIZE;
    if (start > 50_000) {
      console.warn('Stopped pagination after 50k activities (safety cap).');
      break;
    }
  }
  return all;
}

async function main() {
  console.log('Starting Garmin dive sync (FIT-based)');

  if (!PAYLOAD_URL) {
    throw new Error('PAYLOAD_URL must be set');
  }

  const gc = await createGarminClient();

  const lastStart = await getLastSyncedStartTimeGmt();
  let startDate;
  const endDate = new Date();
  const endYmd = endDate.toISOString().slice(0, 10);

  if (lastStart) {
    console.log('Last synced dive:', lastStart);
    const d = new Date(lastStart.slice(0, 10));
    d.setDate(d.getDate() - 2);
    startDate = d;
  } else {
    console.log(`No last synced dive; syncing from the last ${FIRST_SYNC_DAYS} days`);
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - FIRST_SYNC_DAYS);
  }

  const startYmd = startDate.toISOString().slice(0, 10);
  console.log(`Syncing activities from ${startYmd} to ${endYmd}`);

  const activities = await fetchActivitiesByDateRange(gc, startYmd, endYmd);
  console.log(`Found ${activities.length} activities in range`);

  for (const act of activities) {
    const typeKey = (act.activityType?.typeKey ?? '').toLowerCase();
    if (!typeKey.includes('diving')) continue;

    let fitBuf;
    try {
      const zipBytes = await downloadActivityZip(gc, act.activityId);
      fitBuf = extractFitFromActivityZip(zipBytes);
    } catch (e) {
      console.warn(`Could not download ZIP for activity ${act.activityId}:`, e);
      continue;
    }

    if (!fitBuf) {
      console.warn(`No .fit file in activity ZIP for ${act.activityId}`);
      continue;
    }

    const { messages, errors } = decodeFitFromBuffer(fitBuf);
    if (errors?.length) {
      console.warn(`FIT decode warnings for ${act.activityId}:`, errors);
    }

    const data = transformDive(act, messages);
    if (!data) continue;

    const { diveTimeSeries, ...divePayload } = data;
    await saveDiveToPayload(divePayload);
    try {
      const headers = await payloadHeaders();
      await upsertDiveTimeSeriesSidecar(headers, data.garminActivityId, diveTimeSeries);
    } catch (e) {
      console.warn(`Sidecar time series failed for ${data.garminActivityId}:`, e);
    }
    console.log('Saved dive', data.garminActivityId, data.title ?? '');
  }

  const tokenDir = process.env.GARMIN_TOKEN_DIR?.trim();
  if (tokenDir) {
    try {
      gc.exportTokenToFile(tokenDir);
      console.log('Refreshed Garmin Connect token cache:', tokenDir);
    } catch (e) {
      console.warn('Could not refresh Garmin token cache:', e);
    }
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
