import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Decoder, Stream } from '@garmin/fitsdk';

/**
 * Decode a FIT file from a Node.js Buffer (e.g. from disk or a Garmin activity ZIP).
 * @param {Buffer} buf
 * @returns {{ messages: object, errors: unknown[] }}
 */
export function decodeFitFromBuffer(buf) {
  const decoder = new Decoder(Stream.fromBuffer(buf));
  return decoder.read();
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseCliArgs(argv) {
  let savePath = null;
  /** @type {string | null} */
  let fitPathArg = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--save') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('--save requires a file path');
      }
      savePath = path.resolve(next);
      i++;
    } else if (a.startsWith('--save=')) {
      savePath = path.resolve(a.slice('--save='.length));
    } else if (!a.startsWith('--')) {
      fitPathArg = path.resolve(a);
    } else {
      throw new Error(`Unknown option: ${a}`);
    }
  }
  return { savePath, fitPathArg };
}

function runCli() {
  const defaultFit = path.join(__dirname, '99 Tamworth Single-Gas Dive.fit');
  const { savePath, fitPathArg } = parseCliArgs(process.argv.slice(2));
  const fitPath = fitPathArg ?? defaultFit;

  const buffer = fs.readFileSync(fitPath);
  const stream = Stream.fromBuffer(buffer);

  console.log('file: ' + fitPath);
  console.log('isFIT (static method): ' + Decoder.isFIT(stream));

  const decoder = new Decoder(Stream.fromBuffer(buffer));
  console.log('isFIT (instance method): ' + decoder.isFIT());
  console.log('checkIntegrity: ' + decoder.checkIntegrity());

  const { messages, errors } = decoder.read();

  console.log(errors);

  if (savePath) {
    const payload = { errors, messages };
    const text = JSON.stringify(payload, null, 2);
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    fs.writeFileSync(savePath, text, 'utf8');
    const kb = (Buffer.byteLength(text, 'utf8') / 1024).toFixed(1);
    console.log(`wrote ${savePath} (${kb} KiB)`);
  } else {
    console.log(messages);
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const thisPath = fileURLToPath(import.meta.url);
if (entryPath && entryPath === thisPath) {
  runCli();
}
