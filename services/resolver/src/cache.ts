/**
 * Resolver cache (Technical Concept §13 "Redis cache"). A tiny `get`/`set`-with-TTL
 * interface so reads can skip the RPC. The default {@link MemoryCache} is in-process;
 * a Redis adapter (e.g. ioredis) implements the same interface as a drop-in for a
 * multi-instance deployment. Injectable + clock-overridable so it's fully testable.
 */
export interface Cache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/** In-process TTL cache. `now` is injectable so tests can advance the clock. */
export class MemoryCache implements Cache {
  private readonly store = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async get(key: string): Promise<string | null> {
    const e = this.store.get(key);
    if (!e) return null;
    if (this.now() >= e.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return e.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
  }
}
