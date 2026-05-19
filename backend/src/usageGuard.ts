import { redis } from "./redisClient";

// Daily key is bucketed by UTC date, intentionally global (not per IP).
// It is a coarse public-demo spend guard, not per-user accounting.
const TTL_SECONDS = 48 * 60 * 60;

function dailyKey(): string {
  return `usage:daily:${new Date().toISOString().slice(0, 10)}`;
}

export async function getDailyTotal(): Promise<number> {
  const raw = await redis.get(dailyKey());
  return raw ? Number(raw) : 0;
}

export async function addDailyUsage(tokens: number): Promise<void> {
  const key = dailyKey();
  await redis.incrby(key, tokens);
  await redis.expire(key, TTL_SECONDS);
}

export function dailyCap(): number {
  return Number(process.env.DAILY_TOKEN_CAP) || 200000;
}
