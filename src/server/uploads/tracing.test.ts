import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The HEIC decoder is imported through a variable so the Worker bundler leaves
 * its 8 MB of WebAssembly alone. That also hides it from Next's dependency
 * tracing, so the container build has to be told to carry it — and to carry
 * everything it reaches for, which is how this broke once already: the package
 * was copied, its own dependency was not, and conversion failed at runtime
 * with "Cannot find module 'heic-decode'".
 */

function dependenciesOf(name: string): string[] {
  const manifest = JSON.parse(
    readFileSync(`node_modules/${name}/package.json`, "utf8"),
  ) as { dependencies?: Record<string, string> };
  return Object.keys(manifest.dependencies ?? {});
}

function chainFrom(root: string): Set<string> {
  const seen = new Set<string>();
  const queue = [root];

  while (queue.length > 0) {
    const name = queue.pop() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    queue.push(...dependenciesOf(name));
  }
  return seen;
}

describe("outputFileTracingIncludes", () => {
  it("carries heic-convert and everything it depends on", () => {
    const config = readFileSync("next.config.ts", "utf8");

    for (const name of chainFrom("heic-convert")) {
      expect(config, `next.config.ts must trace ${name}`).toContain(
        `./node_modules/${name}/**`,
      );
    }
  });
});
