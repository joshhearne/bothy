import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import { env } from "@/lib/env";
import { isWorkers } from "@/lib/runtime";

/**
 * Attachment storage. Local volume by default, S3-compatible when configured,
 * chosen by STORAGE_DRIVER as docs/ARCHITECTURE.md describes.
 */
export interface StorageDriver {
  readonly kind: "local" | "s3";
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/** Storage keys are ours, never the uploader's filename. */
export function buildStorageKey(documentId: string, filename: string): string {
  const extension = extname(filename).toLowerCase().slice(0, 12).replace(/[^a-z0-9.]/g, "");
  return `${documentId}/${randomUUID()}${extension}`;
}

/** Defense in depth: a key must stay inside the storage root. */
export function assertSafeKey(key: string): void {
  if (key.includes("..") || key.startsWith("/") || key.includes("\0")) {
    throw new Error("Unsafe storage key");
  }
}

class S3Driver implements StorageDriver {
  readonly kind = "s3" as const;

  constructor(
    private readonly bucket: string,
    private readonly client: import("@aws-sdk/client-s3").S3Client,
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ChecksumSHA256: createHash("sha256").update(body).digest("base64"),
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Attachment ${key} has no body`);
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let driver: StorageDriver | undefined;

export async function getStorage(): Promise<StorageDriver> {
  if (driver) return driver;

  if (env.STORAGE_DRIVER === "r2") {
    const { R2Driver } = await import("@/server/storage/r2-driver");
    const r2 = await R2Driver.create();
    driver = r2;
    return r2;
  }

  if (env.STORAGE_DRIVER === "s3") {
    const { S3Client } = await import("@aws-sdk/client-s3");
    driver = new S3Driver(
      env.S3_BUCKET as string,
      new S3Client({
        region: env.S3_REGION,
        ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY as string,
          secretAccessKey: env.S3_SECRET_KEY as string,
        },
      }),
    );
  } else {
    if (isWorkers()) {
      throw new Error("Workers have no filesystem: set STORAGE_DRIVER to r2 or s3");
    }
    // Imported lazily so node:fs never reaches a Workers bundle.
    const { LocalDriver } = await import("@/server/storage/local-driver");
    driver = new LocalDriver(env.STORAGE_PATH);
  }

  return driver;
}
