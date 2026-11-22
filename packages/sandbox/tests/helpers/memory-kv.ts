/** Minimal in-memory KVNamespace for unit tests. */

type Entry = {
  value: string;
  expiresAt: number | null;
};

export class MemoryKv {
  private store = new Map<string, Entry>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: { expirationTtl?: number; expiration?: number },
  ): Promise<void> {
    let text: string;
    if (typeof value === "string") {
      text = value;
    } else if (value instanceof ArrayBuffer) {
      text = new TextDecoder().decode(value);
    } else if (ArrayBuffer.isView(value)) {
      text = new TextDecoder().decode(value);
    } else {
      throw new Error("stream puts not supported in MemoryKv");
    }
    let expiresAt: number | null = null;
    if (options?.expirationTtl) {
      expiresAt = Date.now() + options.expirationTtl * 1000;
    } else if (options?.expiration) {
      expiresAt = options.expiration * 1000;
    }
    this.store.set(key, { value: text, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  asNamespace(): KVNamespace {
    return this as unknown as KVNamespace;
  }
}
