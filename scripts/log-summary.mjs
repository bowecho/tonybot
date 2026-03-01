#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function getArg(name, fallback) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function safeJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function inc(map, key, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function topEntries(map, limit = 10) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function printSection(title) {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
}

const today = new Date().toISOString().slice(0, 10);
const dateArg = getArg('date', today);
const fileArg = getArg('file', null);

const logFile = fileArg
  ? path.resolve(fileArg)
  : path.join(process.cwd(), 'logs', `conversations-${dateArg}.ndjson`);

if (!fs.existsSync(logFile)) {
  console.error(`Log file not found: ${logFile}`);
  process.exit(1);
}

const raw = fs.readFileSync(logFile, 'utf8');
const lines = raw.split('\n').filter(Boolean);

let requestCount = 0;
let responseOkCount = 0;
let responseErrorCount = 0;

const modeCounts = new Map();
const ipCounts = new Map();
const userAgentCounts = new Map();
const promptCounts = new Map();
const bubbleCounts = new Map();
const statusCounts = new Map();

const durations = [];
const errors = [];

for (const line of lines) {
  const event = safeJson(line);
  if (!event || typeof event !== 'object') continue;

  const type = event.type;

  if (type === 'request') {
    requestCount += 1;

    if (typeof event.mode === 'string') inc(modeCounts, event.mode);
    if (typeof event.ip === 'string') inc(ipCounts, event.ip);
    if (typeof event.userAgent === 'string') inc(userAgentCounts, event.userAgent);

    if (typeof event.lastUserText === 'string') {
      const text = event.lastUserText.trim().toLowerCase();
      if (text) inc(promptCounts, text);
    }
  }

  if (type === 'response') {
    const status = typeof event.status === 'string' ? event.status : 'unknown';
    inc(statusCounts, status);

    if (status === 'ok') responseOkCount += 1;
    if (status === 'error') {
      responseErrorCount += 1;
      errors.push(event);
    }

    if (Array.isArray(event.bubbles)) {
      for (const bubble of event.bubbles) {
        if (typeof bubble === 'string' && bubble.trim()) {
          inc(bubbleCounts, bubble.trim().toLowerCase());
        }
      }
    }

    if (typeof event.durationMs === 'number' && Number.isFinite(event.durationMs)) {
      durations.push(event.durationMs);
    }
  }
}

const avgDuration = durations.length
  ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
  : 0;
const p95Duration = durations.length
  ? [...durations].sort((a, b) => a - b)[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))]
  : 0;

console.log(`Log file: ${logFile}`);
console.log(`Lines: ${lines.length}`);

printSection('Overview');
console.log(`Requests: ${requestCount}`);
console.log(`Responses ok: ${responseOkCount}`);
console.log(`Responses error: ${responseErrorCount}`);
console.log(`Avg response time: ${avgDuration}ms`);
console.log(`P95 response time: ${Math.round(p95Duration)}ms`);

printSection('Modes');
for (const [mode, count] of topEntries(modeCounts, 10)) {
  console.log(`${mode}: ${count}`);
}

printSection('Top IPs');
for (const [ip, count] of topEntries(ipCounts, 10)) {
  console.log(`${ip}: ${count}`);
}

printSection('Top User Prompts');
for (const [prompt, count] of topEntries(promptCounts, 10)) {
  console.log(`${count}x  ${prompt.slice(0, 120)}`);
}

printSection('Top Assistant Bubbles');
for (const [bubble, count] of topEntries(bubbleCounts, 10)) {
  console.log(`${count}x  ${bubble.slice(0, 120)}`);
}

printSection('Status Counts');
for (const [status, count] of topEntries(statusCounts, 10)) {
  console.log(`${status}: ${count}`);
}

if (errors.length > 0) {
  printSection('Recent Errors');
  const recent = errors.slice(-5);
  for (const err of recent) {
    const ts = typeof err.ts === 'string' ? err.ts : 'unknown-ts';
    const reqId = typeof err.requestId === 'string' ? err.requestId : 'unknown-id';
    const ip = typeof err.ip === 'string' ? err.ip : 'unknown-ip';
    const duration = typeof err.durationMs === 'number' ? `${err.durationMs}ms` : 'n/a';
    console.log(`${ts}  ${reqId}  ${ip}  ${duration}`);
  }
}
