/**
 * Build a compact columnar time series from @garmin/fitsdk decoder output (messages object).
 * Used for charts: depth, temperature, SAC/RMV from record mesgs; tank pressure from tank updates.
 *
 * SAC/RMV/tank columns are null when the device did not log those FIT fields (common without a
 * tank transmitter). See `availability` on the returned object.
 */

/**
 * @param {unknown} ts
 * @returns {number | null} epoch ms
 */
function fitTimestampToMs(ts) {
  if (ts instanceof Date && !Number.isNaN(ts.getTime())) return ts.getTime();
  if (typeof ts === 'string') {
    const ms = Date.parse(ts);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * @param {unknown} ts
 * @returns {string | null} ISO 8601 UTC
 */
function fitTimestampToIso(ts) {
  const ms = fitTimestampToMs(ts);
  return ms == null ? null : new Date(ms).toISOString();
}

/**
 * Last known tank pressure at or before each record time (bar).
 * @param {number[]} tOffsetSec
 * @param {{ tOffsetSec: number; pressureBar: number }[]} samples sorted by tOffsetSec
 */
function tankPressureAlignedToRecords(tOffsetSec, samples) {
  if (!samples.length) {
    return tOffsetSec.map(() => null);
  }
  let j = 0;
  let last = null;
  return tOffsetSec.map((t) => {
    while (j < samples.length && samples[j].tOffsetSec <= t) {
      last = samples[j].pressureBar;
      j++;
    }
    return last;
  });
}

/** @param {(number | null)[]} arr */
function hasAnyFiniteNumber(arr) {
  return arr.some((v) => v != null && Number.isFinite(Number(v)));
}

/**
 * @param {unknown} v
 * @param {number | undefined} decimals
 */
function roundNullable(v, decimals) {
  if (v == null || typeof v !== 'number' || !Number.isFinite(v)) return v;
  if (decimals == null || decimals < 0) return v;
  const m = 10 ** decimals;
  return Math.round(v * m) / m;
}

/**
 * @param {(unknown | null)[]} arr
 * @param {number | undefined} decimals
 */
function roundArray(arr, decimals) {
  if (decimals == null) return arr;
  return arr.map((v) => roundNullable(/** @type {number | null} */ (v), decimals));
}

/**
 * Keep every Nth element (1 = no decimation).
 * @template T
 * @param {T[]} arr
 * @param {number} step
 */
function downsampleArray(arr, step) {
  if (step <= 1) return arr;
  return arr.filter((_, i) => i % step === 0);
}

/**
 * Shrink dive time series for storage / transfer.
 *
 * @param {Record<string, unknown>} ts - output of buildDiveTimeSeriesFromMessages
 * @param {object} [options]
 * @param {number} [options.keepEvery=1] - keep every Nth record (2 ≈ half the points)
 * @param {number} [options.decimals] - round numeric arrays (e.g. 2 for depth/tank); never rounds epochMs
 * @param {boolean} [options.omitTimestampGmt=false] - drop ISO strings; use epochMs for x-axis
 * @param {boolean} [options.omitTOffsetSec=false] - drop tOffsetSec; derive from epochMs vs first sample
 * @param {boolean} [options.omitTankPressureSamples=false] - drop sparse list if tankPressureBar is enough
 * @param {boolean} [options.omitUnits=false] - drop the human-readable units block
 * @param {boolean} [options.stripAvailabilityNotes=false] - keep flags, clear long notes[]
 */
export function reduceDiveTimeSeries(ts, options = {}) {
  const {
    keepEvery = 1,
    decimals,
    omitTimestampGmt = false,
    omitTOffsetSec = false,
    omitTankPressureSamples = false,
    omitUnits = false,
    stripAvailabilityNotes = false,
  } = options;

  const step = Math.max(1, Math.floor(Number(keepEvery)) || 1);

  /** @type {string[]} */
  const parallelKeys = [
    'timestampGmt',
    'epochMs',
    'tOffsetSec',
    'depthM',
    'temperatureC',
    'absolutePressurePa',
    'pressureSacBarPerMin',
    'volumeSacLitersPerMin',
    'rmvLitersPerMin',
    'tankPressureBar',
  ];

  const out = { ...ts };
  const originalCount = /** @type {number} */ (ts.sampleCount);

  for (const k of parallelKeys) {
    const arr = /** @type {unknown[] | undefined} */ (ts[k]);
    if (!Array.isArray(arr)) continue;
    let next = downsampleArray(arr, step);
    if (decimals != null && k !== 'epochMs') {
      next = roundArray(next, decimals);
    }
    out[k] = next;
  }

  if (omitTimestampGmt) {
    delete out.timestampGmt;
  }
  if (omitTOffsetSec) {
    delete out.tOffsetSec;
  }

  const downsampledEpoch = /** @type {number[]} */ (out.epochMs);
  const anchorMs = downsampledEpoch[0];
  const keptOffsets =
    anchorMs != null
      ? new Set(downsampledEpoch.map((ms) => Math.round((ms - anchorMs) / 1000)))
      : new Set();

  const rawTank = ts.tankPressureSamples;
  if (omitTankPressureSamples) {
    delete out.tankPressureSamples;
  } else if (Array.isArray(rawTank)) {
    let tankSamples = rawTank;
    if (step > 1 && keptOffsets.size > 0) {
      tankSamples = rawTank.filter((s) => {
        if (!s || typeof s !== 'object') return false;
        const off = /** @type {{ tOffsetSec?: number }} */ (s).tOffsetSec;
        return typeof off === 'number' && keptOffsets.has(off);
      });
    }
    if (decimals != null) {
      tankSamples = tankSamples.map((s) => {
        if (!s || typeof s !== 'object') return s;
        const o = /** @type {Record<string, unknown>} */ ({ ...s });
        o.pressureBar = roundNullable(/** @type {number} */ (o.pressureBar), decimals);
        return o;
      });
    }
    out.tankPressureSamples = tankSamples;
  }

  out.sampleCount = downsampledEpoch.length;

  if (step > 1 || omitTimestampGmt || omitTOffsetSec || omitTankPressureSamples) {
    out.compact = {
      keepEvery: step,
      originalSampleCount: originalCount,
      omitTimestampGmt,
      omitTOffsetSec,
      omitTankPressureSamples,
    };
  }

  if (omitUnits) {
    delete out.units;
  } else if (out.units && typeof out.units === 'object') {
    const u = /** @type {Record<string, string>} */ ({ ...out.units });
    if (omitTimestampGmt) delete u.timestampGmt;
    if (omitTOffsetSec) delete u.tOffsetSec;
    out.units = u;
  }

  if (stripAvailabilityNotes && out.availability && typeof out.availability === 'object') {
    const a = /** @type {Record<string, unknown>} */ ({ ...out.availability });
    a.notes = [];
    out.availability = a;
  }

  return out;
}

/**
 * @param {Record<string, unknown>} messages - decoder.read().messages
 * @returns {Record<string, unknown> | null}
 */
export function buildDiveTimeSeriesFromMessages(messages) {
  const records = messages.recordMesgs;
  if (!Array.isArray(records) || records.length === 0) {
    return null;
  }

  const anchorMs = fitTimestampToMs(records[0].timestamp);
  if (anchorMs == null) {
    return null;
  }

  const timestampGmt = [];
  const epochMs = [];
  const tOffsetSec = [];
  const depthM = [];
  const temperatureC = [];
  const pressureSacBarPerMin = [];
  const volumeSacLitersPerMin = [];
  const rmvLitersPerMin = [];
  const absolutePressurePa = [];

  for (const r of records) {
    if (!r || typeof r !== 'object') continue;
    const rec = /** @type {Record<string, unknown>} */ (r);
    const tms = fitTimestampToMs(rec.timestamp);
    if (tms == null) continue;
    const iso = fitTimestampToIso(rec.timestamp);
    if (iso == null) continue;
    timestampGmt.push(iso);
    epochMs.push(tms);
    tOffsetSec.push(Math.round((tms - anchorMs) / 1000));
    depthM.push(rec.depth != null ? Number(rec.depth) : null);
    temperatureC.push(rec.temperature != null ? Number(rec.temperature) : null);
    pressureSacBarPerMin.push(rec.pressureSac != null ? Number(rec.pressureSac) : null);
    volumeSacLitersPerMin.push(rec.volumeSac != null ? Number(rec.volumeSac) : null);
    rmvLitersPerMin.push(rec.rmv != null ? Number(rec.rmv) : null);
    absolutePressurePa.push(rec.absolutePressure != null ? Number(rec.absolutePressure) : null);
  }

  if (!tOffsetSec.length) {
    return null;
  }

  const tankUpdates = messages.tankUpdateMesgs;
  const tankPressureSamples = [];
  if (Array.isArray(tankUpdates)) {
    for (const u of tankUpdates) {
      if (!u || typeof u !== 'object') continue;
      const up = /** @type {Record<string, unknown>} */ (u);
      const tms = fitTimestampToMs(up.timestamp);
      if (tms == null || up.pressure == null) continue;
      const p = Number(up.pressure);
      if (!Number.isFinite(p)) continue;
      tankPressureSamples.push({
        timestampGmt: new Date(tms).toISOString(),
        epochMs: tms,
        tOffsetSec: Math.round((tms - anchorMs) / 1000),
        pressureBar: p,
        sensor: up.sensor ?? null,
      });
    }
    tankPressureSamples.sort((a, b) => a.tOffsetSec - b.tOffsetSec);
  }

  const tankPressureBar = tankPressureAlignedToRecords(tOffsetSec, tankPressureSamples);

  const hasSacPressure = hasAnyFiniteNumber(pressureSacBarPerMin);
  const hasSacVolume = hasAnyFiniteNumber(volumeSacLitersPerMin);
  const hasRmv = hasAnyFiniteNumber(rmvLitersPerMin);
  const hasTankBar = hasAnyFiniteNumber(tankPressureBar);

  const notes = [];
  if (!hasSacPressure && !hasSacVolume && !hasRmv) {
    notes.push(
      'This FIT has no per-record pressureSac, volumeSac, or rmv. Garmin only includes those when the watch logs them (often requires a paired tank-pressure transmitter and supported dive mode). gasConsumptionDisplay in dive settings is UI preference, not a guarantee these fields exist in the file.',
    );
  }
  if (!hasTankBar) {
    notes.push(
      'No cylinder pressure time series: missing or empty tankUpdateMesgs, or pressures in tankSummary are zero. Use a wireless tank pod (and compatible computer) to get pressure in the exported FIT.',
    );
  }

  return {
    schemaVersion: 1,
    anchorTimeGmt: new Date(anchorMs).toISOString(),
    sampleCount: tOffsetSec.length,
    availability: {
      perRecordPressureSacBarPerMin: hasSacPressure,
      perRecordVolumeSacLitersPerMin: hasSacVolume,
      perRecordRmvLitersPerMin: hasRmv,
      perRecordTankPressureBar: hasTankBar,
      tankUpdateCount: tankPressureSamples.length,
      notes,
    },
    units: {
      timestampGmt: 'ISO 8601 UTC — use with depthM[i], temperatureC[i], … (same index)',
      epochMs: 'Unix ms — convenient x-axis for charts',
      tOffsetSec: 's from anchor (first record)',
      depthM: 'm',
      temperatureC: '°C',
      absolutePressurePa: 'ambient absolute pressure at sample (Pa), from FIT — not cylinder pressure',
      pressureSacBarPerMin: 'bar/min surface equivalent — only if device logged pressureSac',
      volumeSacLitersPerMin: 'L/min — only if device logged volumeSac',
      rmvLitersPerMin: 'L/min respiratory minute volume — only if device logged rmv',
      tankPressureBar: 'cylinder bar — forward-filled from tankUpdateMesgs when present',
    },
    timestampGmt,
    epochMs,
    tOffsetSec,
    depthM,
    temperatureC,
    absolutePressurePa,
    pressureSacBarPerMin,
    volumeSacLitersPerMin,
    rmvLitersPerMin,
    tankPressureBar,
    tankPressureSamples,
  };
}
