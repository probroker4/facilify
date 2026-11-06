interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export interface RateResult { allowed: boolean; remaining: number; retryAfterSeconds: number }

export function checkRateLimit(key: string, max: number, windowMs: number, now = Date.now()): RateResult {
  if (buckets.size > MAX_BUCKETS) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    if (buckets.size > MAX_BUCKETS) buckets.clear();
  }
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  return {
    allowed: b.count <= max,
    remaining: Math.max(0, max - b.count),
    retryAfterSeconds: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
  };
}

export function resetRateLimits() { buckets.clear(); }

export function clientKey(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd || headers.get('x-real-ip') || 'local';
}
