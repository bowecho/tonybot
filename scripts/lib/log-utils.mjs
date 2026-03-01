export function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

export function safeJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export function normalizeIp(value) {
  if (!value) return value;
  if (value === '::1') return '127.0.0.1';
  return value;
}
