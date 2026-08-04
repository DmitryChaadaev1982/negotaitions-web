import { createHash, createHmac, randomBytes } from "node:crypto";

const WINDOW_MS = 60 * 60 * 1000;
const FALLBACK_HMAC_KEY = randomBytes(32);

type Bucket = { timestamps: number[] };

export class ProcessLocalPasswordResetLimiter {
  private readonly emailBuckets = new Map<string, Bucket>();
  private readonly ipBuckets = new Map<string, Bucket>();

  constructor(
    private readonly emailLimit: number,
    private readonly ipLimit = Math.max(20, emailLimit * 4),
    private readonly emailCooldownSeconds = 60,
  ) {}

  consume(params: {
    normalizedEmail: string;
    rawIp?: string | null;
    now?: number;
    hmacSecret?: string | null;
  }): boolean {
    const now = params.now ?? Date.now();
    this.prune(now);
    const emailKey = createHash("sha256")
      .update(params.normalizedEmail)
      .digest("hex");
    const ipKey = params.rawIp
      ? createHmac(
          "sha256",
          params.hmacSecret?.trim() || FALLBACK_HMAC_KEY,
        )
          .update(params.rawIp)
          .digest("hex")
      : null;

    const emailTimestamps = this.emailBuckets.get(emailKey)?.timestamps ?? [];
    const latestEmailAttempt = emailTimestamps.at(-1);
    if (
      !this.hasCapacity(this.emailBuckets, emailKey, this.emailLimit) ||
      (latestEmailAttempt !== undefined &&
        now - latestEmailAttempt < this.emailCooldownSeconds * 1000)
    ) {
      return false;
    }
    if (ipKey && !this.hasCapacity(this.ipBuckets, ipKey, this.ipLimit)) {
      return false;
    }

    this.record(this.emailBuckets, emailKey, now);
    if (ipKey) this.record(this.ipBuckets, ipKey, now);
    return true;
  }

  private hasCapacity(
    buckets: Map<string, Bucket>,
    key: string,
    limit: number,
  ): boolean {
    return (buckets.get(key)?.timestamps.length ?? 0) < limit;
  }

  private record(buckets: Map<string, Bucket>, key: string, now: number): void {
    const bucket = buckets.get(key) ?? { timestamps: [] };
    bucket.timestamps.push(now);
    buckets.set(key, bucket);
  }

  private prune(now: number): void {
    const cutoff = now - WINDOW_MS;
    for (const buckets of [this.emailBuckets, this.ipBuckets]) {
      for (const [key, bucket] of buckets) {
        bucket.timestamps = bucket.timestamps.filter((time) => time > cutoff);
        if (bucket.timestamps.length === 0) buckets.delete(key);
      }
    }
  }
}

let sharedLimiter: ProcessLocalPasswordResetLimiter | null = null;
let sharedLimit = 0;
let sharedCooldownSeconds = 0;

export function consumePasswordResetAttempt(params: {
  normalizedEmail: string;
  rawIp?: string | null;
  maxPerAccountPerHour: number;
  cooldownSeconds: number;
}): boolean {
  if (
    !sharedLimiter ||
    sharedLimit !== params.maxPerAccountPerHour ||
    sharedCooldownSeconds !== params.cooldownSeconds
  ) {
    sharedLimit = params.maxPerAccountPerHour;
    sharedCooldownSeconds = params.cooldownSeconds;
    sharedLimiter = new ProcessLocalPasswordResetLimiter(
      sharedLimit,
      Math.max(20, sharedLimit * 4),
      sharedCooldownSeconds,
    );
  }
  return sharedLimiter.consume({
    normalizedEmail: params.normalizedEmail,
    rawIp: params.rawIp,
    // AUTH_SECRET is used only as an HMAC key. A process-random fallback keeps
    // raw IP addresses out of memory-backed keys in local/single-instance use.
    hmacSecret: process.env.AUTH_SECRET,
  });
}
