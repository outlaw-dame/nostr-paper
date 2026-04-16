import Redis from 'ioredis';
import { Config } from './config.js';

export function createRedis(config: Config) {
  const redis = new Redis(config.REDIS_URL, {
    enableReadyCheck: true,
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      const base = Math.min(1000 * 2 ** times, 30000);
      const jitter = Math.floor(Math.random() * 250);
      return base + jitter;
    }
  });

  redis.on('error', (err) => {
    // Do not throw; allow ioredis retry strategy to handle
    // Logging is handled by caller
  });

  return redis;
}

export async function publishEvent(redis: Redis, stream: string, payload: unknown) {
  const data = JSON.stringify(payload);
  // XADD with approximate trimming to keep memory bounded
  return redis.xadd(stream, 'MAXLEN', '~', 1000000, '*', 'payload', data);
}

export async function setDedupe(redis: Redis, key: string, ttlSec: number): Promise<boolean> {
  // SET key value NX EX ttl
  const res = await redis.set(key, '1', 'EX', ttlSec, 'NX');
  return res === 'OK';
}

export async function getState(redis: Redis, key: string): Promise<number | null> {
  const val = await redis.get(key);
  if (!val) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

export async function setState(redis: Redis, key: string, value: number) {
  await redis.set(key, String(value));
}
