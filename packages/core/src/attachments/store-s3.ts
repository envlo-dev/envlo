import type {
  AttachmentStore,
  AttachmentStorePutInput,
  AttachmentStorePutResult,
  S3AttachmentStoreOptions,
  S3CompatibleClient,
} from "./types.js";

/**
 * S3-compatible attachment store. Inject an AWS SDK / R2 / MinIO wrapper —
 * `@envlo/core` does not bundle a cloud SDK.
 */
export class S3AttachmentStore implements AttachmentStore {
  readonly kind = "s3";
  private readonly client: S3CompatibleClient;
  private readonly bucket: string;
  private readonly keyPrefix: string;
  private readonly publicUrlBase: string | null;
  private readonly keyById = new Map<string, string>();

  constructor(options: S3AttachmentStoreOptions) {
    this.client = options.client;
    this.bucket = options.bucket;
    this.keyPrefix = (options.keyPrefix ?? "attachments/").replace(/\/?$/, "/");
    this.publicUrlBase = options.publicUrlBase
      ? options.publicUrlBase.replace(/\/?$/, "/")
      : null;
  }

  private keyFor(id: string, extension: string): string {
    return `${this.keyPrefix}${id}${extension}`;
  }

  async put(input: AttachmentStorePutInput): Promise<AttachmentStorePutResult> {
    const key = this.keyFor(input.id, input.extension);
    const result = await this.client.putObject({
      bucket: this.bucket,
      key,
      body: input.content,
      contentType: input.mimeType,
    });
    this.keyById.set(input.id, key);
    const remoteUrl =
      result && typeof result === "object" && "url" in result && result.url
        ? result.url
        : this.publicUrlBase
          ? `${this.publicUrlBase}${key}`
          : `s3://${this.bucket}/${key}`;
    return {
      id: input.id,
      localFilePath: null,
      remoteUrl,
      sizeBytes: input.content.byteLength,
    };
  }

  async get(id: string): Promise<Uint8Array | null> {
    const key = this.keyById.get(id);
    if (!key) return null;
    try {
      return await this.client.getObject({ bucket: this.bucket, key });
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<void> {
    const key = this.keyById.get(id);
    if (!key || !this.client.deleteObject) return;
    await this.client.deleteObject({ bucket: this.bucket, key });
    this.keyById.delete(id);
  }
}
