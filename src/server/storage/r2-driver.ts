import "server-only";
import { assertSafeKey, type StorageDriver } from "@/server/storage";

/**
 * Attachments in R2, through the Worker's binding rather than the S3 API, so
 * there are no credentials to carry and no SDK to bundle.
 */

type R2Bucket = {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
};

export class R2Driver implements StorageDriver {
  readonly kind = "s3" as const;

  private constructor(private readonly bucket: R2Bucket) {}

  /** Reads the binding out of the Worker's environment at call time. */
  static async create(): Promise<R2Driver> {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const context = await getCloudflareContext({ async: true });
    const bucket = (context.env as unknown as { BOTHY_UPLOADS?: R2Bucket }).BOTHY_UPLOADS;

    if (!bucket) {
      throw new Error("STORAGE_DRIVER is r2 but no BOTHY_UPLOADS bucket is bound");
    }
    return new R2Driver(bucket);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.bucket.put(key, body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, {
      httpMetadata: { contentType },
    });
  }

  async get(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const object = await this.bucket.get(key);
    if (!object) throw new Error(`Attachment ${key} is missing from R2`);
    return Buffer.from(await object.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.bucket.delete(key);
  }
}
