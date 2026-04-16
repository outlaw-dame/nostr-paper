export function nextDelay(attempt: number, baseMs = 500, maxMs = 30000) {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  const jitter = Math.floor(Math.random() * Math.min(250, exp));
  return exp + jitter;
}
