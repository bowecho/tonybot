#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { getArg, normalizeIp, safeJson } from './lib/log-utils.mjs';

function sanitizeFilePart(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_');
}

const today = new Date().toISOString().slice(0, 10);
const dateArg = getArg('date', today);
const fileArg = getArg('file', null);
const ipArg = normalizeIp(getArg('ip', null));
const outArg = getArg('out', null);

if (!ipArg) {
  console.error('Missing required --ip argument. Example: --ip=107.129.122.50');
  process.exit(1);
}

const logFile = fileArg
  ? path.resolve(fileArg)
  : path.join(process.cwd(), 'logs', `conversations-${dateArg}.ndjson`);

if (!fs.existsSync(logFile)) {
  console.error(`Log file not found: ${logFile}`);
  process.exit(1);
}

const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);

const requestsById = new Map();
const responsesById = new Map();

for (const line of lines) {
  const event = safeJson(line);
  if (!event || typeof event !== 'object') continue;

  const requestId = typeof event.requestId === 'string' ? event.requestId : null;
  if (!requestId) continue;

  const type = event.type;

  if (type === 'request') {
    const eventIp = normalizeIp(typeof event.ip === 'string' ? event.ip : 'unknown');
    if (eventIp !== ipArg) continue;
    requestsById.set(requestId, event);
  }

  if (type === 'response') {
    responsesById.set(requestId, event);
  }
}

if (requestsById.size === 0) {
  console.error(`No request events found for IP ${ipArg} in ${logFile}`);
  process.exit(1);
}

const orderedRequestIds = [...requestsById.entries()]
  .sort((a, b) => {
    const aTs = Date.parse(String(a[1].ts ?? 0));
    const bTs = Date.parse(String(b[1].ts ?? 0));
    return aTs - bTs;
  })
  .map(([requestId]) => requestId);

let output = '';
output += `Transcript Export\n`;
output += `Date: ${dateArg}\n`;
output += `IP: ${ipArg}\n`;
output += `Source: ${logFile}\n`;
output += `Events: ${orderedRequestIds.length}\n\n`;

for (const requestId of orderedRequestIds) {
  const req = requestsById.get(requestId) ?? {};
  const res = responsesById.get(requestId) ?? {};

  const ts = typeof req.ts === 'string' ? req.ts : 'unknown-ts';
  const mode = typeof req.mode === 'string' ? req.mode : 'unknown-mode';
  const userText = typeof req.lastUserText === 'string' ? req.lastUserText : '';

  const status = typeof res.status === 'string' ? res.status : 'unknown';
  const pathLabel = typeof res.path === 'string' ? res.path : 'n/a';
  const duration = typeof res.durationMs === 'number' ? `${res.durationMs}ms` : 'n/a';
  const errorClass =
    typeof res.errorClass === 'string' && res.errorClass.trim() ? res.errorClass.trim() : null;
  const errorMessage =
    typeof res.errorMessage === 'string' && res.errorMessage.trim()
      ? res.errorMessage.trim()
      : null;

  const bubbles = Array.isArray(res.bubbles)
    ? res.bubbles.filter((value) => typeof value === 'string' && value.trim())
    : [];

  output += `[${ts}] requestId=${requestId} mode=${mode} status=${status} path=${pathLabel} duration=${duration}`;
  if (errorClass) {
    output += ` errorClass=${errorClass}`;
  }
  output += `\n`;

  if (userText.trim()) {
    output += `Friend: ${userText.trim()}\n`;
  } else {
    output += `Friend: (none)\n`;
  }

  if (bubbles.length > 0) {
    for (const bubble of bubbles) {
      output += `Tony: ${bubble.trim()}\n`;
    }
  } else if (status !== 'ok' && errorMessage) {
    output += `Tony Error: ${errorMessage}\n`;
  } else {
    output += `Tony: (no bubbles logged)\n`;
  }

  output += `\n`;
}

const defaultOut = path.join(
  process.cwd(),
  'logs',
  `transcript-${dateArg}-${sanitizeFilePart(ipArg)}.txt`,
);
const outPath = outArg ? path.resolve(outArg) : defaultOut;

fs.writeFileSync(outPath, output, 'utf8');
console.log(`Transcript written: ${outPath}`);
