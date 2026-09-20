import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { assertSafeKey, type StorageDriver } from "@/server/storage";

/**
 * A directory on disk, which is the default for the Docker deployment. Loaded
 * only when it is the configured driver: Workers have no filesystem, and
 * node:fs must not reach that bundle.
 */
export class LocalDriver implements StorageDriver {
  readonly kind = "local" as const;
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    assertSafeKey(key);
    const full = resolve(join(this.root, key));
    if (full !== resolve(this.root) && !full.startsWith(resolve(this.root) + sep)) {
      throw new Error("Unsafe storage key");
    }
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, { mode: 0o640 });
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}
