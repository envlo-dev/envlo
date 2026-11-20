import type {
  AttachmentStore,
  AttachmentStorePutInput,
  AttachmentStorePutResult,
} from "./types.js";

/**
 * In-memory store for tests and runtimes without a filesystem.
 * `localFilePath` is a synthetic `memory://` URI (not a real disk path).
 */
export class MemoryAttachmentStore implements AttachmentStore {
  readonly kind = "memory";
  private readonly blobs = new Map<string, Uint8Array>();

  async put(input: AttachmentStorePutInput): Promise<AttachmentStorePutResult> {
    const copy = new Uint8Array(input.content);
    this.blobs.set(input.id, copy);
    return {
      id: input.id,
      localFilePath: `memory://${input.id}${input.extension}`,
      remoteUrl: null,
      sizeBytes: copy.byteLength,
    };
  }

  async get(id: string): Promise<Uint8Array | null> {
    const found = this.blobs.get(id);
    return found ? new Uint8Array(found) : null;
  }

  async delete(id: string): Promise<void> {
    this.blobs.delete(id);
  }
}
