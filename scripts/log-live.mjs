#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function safeJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function normalizeIp(value) {
  if (!value) return value;
  if (value === '::1') return '127.0.0.1';
  return value;
}

function formatClock(ts) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '??:??:??';
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const ansi = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
};

function line(label, color, text) {
  console.log(`${color}${label}${ansi.reset} ${text}`);
}

const today = new Date().toISOString().slice(0, 10);
const dateArg = getArg('date', today);
const fileArg = getArg('file', null);
const ipFilter = normalizeIp(getArg('ip', null));
const fromStart = hasFlag('from-start');
const pollMs = Number.parseInt(getArg('poll-ms', '500'), 10);

const logFile = fileArg
  ? path.resolve(fileArg)
  : path.join(process.cwd(), 'logs', `conversations-${dateArg}.ndjson`);

console.log(`Watching: ${logFile}`);
if (ipFilter) {
  console.log(`IP filter: ${ipFilter}`);
}
console.log(`Mode: ${fromStart ? 'from start' : 'new entries only'}`);
console.log('Press Ctrl+C to stop.\n');

const pendingByRequestId = new Map();
let filePosition = 0;
let carry = '';

async function ensureStartPosition() {
  try {
    const stat = await fs.promises.stat(logFile);
    filePosition = fromStart ? 0 : stat.size;
  } catch {
    filePosition = 0;
  }
}

function printRequest(event) {
  const ts = formatClock(event.ts);
  const ip = normalizeIp(typeof event.ip === 'string' ? event.ip : 'unknown');
  const mode = typeof event.mode === 'string' ? event.mode : 'normal';
  const reqId = typeof event.requestId === 'string' ? event.requestId : 'unknown';
  const text = typeof event.lastUserText === 'string' && event.lastUserText.trim() ? event.lastUserText.trim() : '(no text)';

  line('Friend', ansi.cyan, `[${ts}] ${text}`);
  line('  meta', ansi.dim, `ip=${ip} mode=${mode} requestId=${reqId}`);
}

function printResponse(event, ipHint = 'unknown') {
  const ts = formatClock(event.ts);
  const status = typeof event.status === 'string' ? event.status : 'unknown';
  const reqId = typeof event.requestId === 'string' ? event.requestId : 'unknown';
  const duration = typeof event.durationMs === 'number' ? `${event.durationMs}ms` : 'n/a';

  if (status !== 'ok') {
    const errorClass =
      typeof event.errorClass === 'string' && event.errorClass.trim()
        ? event.errorClass.trim()
        : 'unknown';
    const errorMessage =
      typeof event.errorMessage === 'string' && event.errorMessage.trim()
        ? event.errorMessage.trim()
        : 'unknown';
    line('Tony', ansi.red, `[${ts}] (error) requestId=${reqId}`);
    line(
      '  meta',
      ansi.dim,
      `ip=${ipHint} status=${status} class=${errorClass} duration=${duration} error=${errorMessage}`,
    );
    return;
  }

  const bubbles = Array.isArray(event.bubbles)
    ? event.bubbles.filter((value) => typeof value === 'string' && value.trim())
    : [];

  if (bubbles.length === 0) {
    line('Tony', ansi.yellow, `[${ts}] (no bubbles logged)`);
  } else {
    for (const bubble of bubbles) {
      line('Tony', ansi.green, `[${ts}] ${bubble.trim()}`);
    }
  }

  line('  meta', ansi.dim, `ip=${ipHint} status=${status} duration=${duration} requestId=${reqId}`);
}

function handleLine(rawLine) {
  if (!rawLine.trim()) return;

  const event = safeJson(rawLine);
  if (!event || typeof event !== 'object') {
    line('warn', ansi.yellow, `skipping invalid JSON line`);
    return;
  }

  const requestId = typeof event.requestId === 'string' ? event.requestId : null;
  const type = event.type;

  if (type === 'request' && requestId) {
    const ip = normalizeIp(typeof event.ip === 'string' ? event.ip : 'unknown');
    if (ipFilter && ip !== ipFilter) {
      return;
    }

    pendingByRequestId.set(requestId, { ip, ts: event.ts });
    printRequest(event);
    return;
  }

  if (type === 'response' && requestId) {
    const pending = pendingByRequestId.get(requestId);

    if (ipFilter && (!pending || pending.ip !== ipFilter)) {
      return;
    }

    printResponse(event, pending?.ip ?? 'unknown');
    pendingByRequestId.delete(requestId);
  }
}

async function readAppendedContent() {
  let stat;
  try {
    stat = await fs.promises.stat(logFile);
  } catch {
    return;
  }

  if (stat.size < filePosition) {
    filePosition = 0;
    carry = '';
    line('info', ansi.magenta, 'log file truncated/rotated; restarting from beginning');
  }

  if (stat.size === filePosition) {
    return;
  }

  const stream = fs.createReadStream(logFile, {
    encoding: 'utf8',
    start: filePosition,
    end: stat.size - 1,
  });

  let chunkText = '';
  for await (const chunk of stream) {
    chunkText += chunk;
  }

  filePosition = stat.size;

  const combined = carry + chunkText;
  const lines = combined.split('\n');
  carry = lines.pop() ?? '';

  for (const item of lines) {
    handleLine(item);
  }
}

await ensureStartPosition();
await readAppendedContent();

const interval = setInterval(() => {
  readAppendedContent().catch((error) => {
    line('error', ansi.red, error instanceof Error ? error.message : String(error));
  });
}, Number.isFinite(pollMs) && pollMs > 100 ? pollMs : 500);

process.on('SIGINT', () => {
  clearInterval(interval);
  process.exit(0);
});
