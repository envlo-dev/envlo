import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultAttachmentsRoot } from "./paths.js";
import type {
  AttachmentStore,
  AttachmentStorePutInput,
  AttachmentStorePutResult,
  LocalAttachmentStoreOptions,
} from "./types.js";

/**
 * Sandboxed local disk store under `~/.envlo/attachments` (or a custom root).
 * Files are named `<id><ext>` — never trust inbound filenames for the path.
 */
export class LocalAttachmentStore implements AttachmentStore {
  readonly kind = "local";
  readonly rootDir: string;

  constructor(options: LocalAttachmentStoreOptions = {}) {
    this.rootDir = options.rootDir ?? defaultAttachmentsRoot();
  }

  private async findById(id: string): Promise<string | null> {
    const entries = await readdir(this.rootDir).catch(() => [] as string[]);
    return entries.find((name) => name === id || name.startsWith(`${id}.`)) ?? null;
  }

  async put(input: AttachmentStorePutInput): Promise<AttachmentStorePutResult> {
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    const filename = `${input.id}${input.extension}`;
    const localFilePath = join(this.rootDir, filename);
    await writeFile(localFilePath, input.content, { mode: 0o600 });
    return {
      id: input.id,
      localFilePath,
      remoteUrl: null,
      sizeBytes: input.content.byteLength,
    };
  }

  async get(id: string): Promise<Uint8Array | null> {
    const match = await this.findById(id);
    if (!match) return null;
    const bytes = await readFile(join(this.rootDir, match));
    return new Uint8Array(bytes);
  }

  async delete(id: string): Promise<void> {
    const match = await this.findById(id);
    if (!match) return;
    await unlink(join(this.rootDir, match)).catch(() => undefined);
  }
}
