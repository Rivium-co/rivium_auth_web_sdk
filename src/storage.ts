/**
 * Where the SDK keeps the refresh token between app starts. Only the refresh token (and the user id) is stored;
 * the access token stays in memory.
 */
export interface RiviumAuthStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Keeps nothing across restarts: the user signs in again after a reload. The default. */
export class MemoryStorage implements RiviumAuthStorage {
  private readonly items = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.items.has(key) ? (this.items.get(key) as string) : null;
  }

  async set(key: string, value: string): Promise<void> {
    this.items.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.items.delete(key);
  }
}
