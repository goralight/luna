/**
 * Read a JSON file produced by fit-to-json.js --save (shape: { errors, messages })
 * and write the compact dive time series from build-dive-time-series-from-fit.js.
 *
 * Usage:
 *   node scripts/time-series-from-decoded-json.js
 *   node scripts/time-series-from-decoded-json.js path/to/decoded.json
 *   node scripts/time-series-from-decoded-json.js --save=out.json path/to/decoded.json
 *   node scripts/time-series-from-decoded-json.js --stdout path/to/decoded.json
 *
 * Size reduction (optional):
 *   --minify              single-line JSON (no indentation)
 *   --compact             preset: every 2nd sample, drop ISO + tOffset + tank samples list,
 *                         round floats to 2dp, strip availability notes, minify
 *   --every=N             keep every Nth sample (default 1 = all)
 *   --decimals=N          round numeric arrays (not epochMs); omit N for no rounding
 *   --no-iso              omit timestampGmt (use epochMs for x-axis)
 *   --no-t-offset         omit tOffsetSec
 *   --no-tank-samples     omit tankPressureSamples (tankPressureBar still forward-filled)
 *   --no-units            omit units block
 *   --strip-notes         clear availability.notes text
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDiveTimeSeriesFromMessages,
  reduceDiveTimeSeries,
} from './build-dive-time-series-from-fit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  let savePath = path.join(__dirname, 'dive-time-series.json');
  let stdout = false;
  /** @type {string | null} */
  let inputPath = null;
  let minify = false;
  /** @type {Parameters<typeof reduceDiveTimeSeries>[1] | null} */
  let reduceOpts = null;

  const mergeReduce = (/** @type {Record<string, unknown>} */ partial) => {
    reduceOpts = {
      keepEvery: 1,
      omitTimestampGmt: false,
      omitTOffsetSec: false,
      omitTankPressureSamples: false,
      omitUnits: false,
      stripAvailabilityNotes: false,
      ...reduceOpts,
      ...partial,
    };
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--stdout') {
      stdout = true;
    } else if (a === '--minify') {
      minify = true;
    } else if (a === '--compact') {
      minify = true;
      mergeReduce({
        keepEvery: 2,
        decimals: 2,
        omitTimestampGmt: true,
        omitTOffsetSec: true,
        omitTankPressureSamples: true,
        stripAvailabilityNotes: true,
      });
    } else if (a === '--no-iso') {
      mergeReduce({ omitTimestampGmt: true });
    } else if (a === '--no-t-offset') {
      mergeReduce({ omitTOffsetSec: true });
    } else if (a === '--no-tank-samples') {
      mergeReduce({ omitTankPressureSamples: true });
    } else if (a === '--no-units') {
      mergeReduce({ omitUnits: true });
    } else if (a === '--strip-notes') {
      mergeReduce({ stripAvailabilityNotes: true });
    } else if (a.startsWith('--every=')) {
      const n = parseInt(a.slice('--every='.length), 10);
      if (!Number.isFinite(n) || n < 1) throw new Error('--every= must be a positive integer');
      mergeReduce({ keepEvery: n });
    } else if (a.startsWith('--decimals=')) {
      const n = parseInt(a.slice('--decimals='.length), 10);
      if (!Number.isFinite(n) || n < 0) throw new Error('--decimals= must be >= 0');
      mergeReduce({ decimals: n });
    } else if (a === '--save') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('--save requires a file path');
      }
      savePath = path.resolve(next);
      i++;
    } else if (a.startsWith('--save=')) {
      savePath = path.resolve(a.slice('--save='.length));
    } else if (!a.startsWith('--')) {
      inputPath = path.resolve(a);
    } else {
      throw new Error(`Unknown option: ${a}`);
    }
  }

  return {
    inputPath: inputPath ?? path.join(__dirname, 'sample-fit-decoded.json'),
    savePath,
    stdout,
    minify,
    reduceOpts,
  };
}

const { inputPath, savePath, stdout, minify, reduceOpts } = parseArgs(process.argv.slice(2));

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (!raw || typeof raw !== 'object' || raw.messages == null) {
  console.error('Expected JSON with a "messages" object (from fit-to-json.js --save).');
  process.exit(1);
}

let timeSeries = buildDiveTimeSeriesFromMessages(
  /** @type {Record<string, unknown>} */ (raw.messages),
);

if (!timeSeries) {
  console.error('No recordMesgs in messages; cannot build time series.');
  process.exit(1);
}

if (reduceOpts) {
  timeSeries = reduceDiveTimeSeries(
    /** @type {Record<string, unknown>} */ (timeSeries),
    reduceOpts,
  );
}

const text = JSON.stringify(timeSeries, null, minify ? undefined : 2);

if (stdout) {
  process.stdout.write(text);
  process.stdout.write('\n');
} else {
  fs.mkdirSync(path.dirname(savePath), { recursive: true });
  fs.writeFileSync(savePath, text, 'utf8');
  const kb = (Buffer.byteLength(text, 'utf8') / 1024).toFixed(1);
  console.log(`read ${inputPath}`);
  console.log(`wrote ${savePath} (${kb} KiB, ${timeSeries.sampleCount} samples)`);
}
