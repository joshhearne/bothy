import type { Messages } from "@/i18n/en-US";
import type { DeepPartial } from "@/i18n/en-GB";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Overlays a locale's overrides onto the base catalog. Functions are replaced
 * whole; nested objects merge key by key, so a translation only states what it
 * changes.
 */
export function mergeMessages(base: Messages, overrides: DeepPartial<Messages>): Messages {
  const merge = (left: unknown, right: unknown): unknown => {
    if (right === undefined) return left;
    if (typeof right === "function") return right;
    if (isPlainObject(left) && isPlainObject(right)) {
      const result: Record<string, unknown> = { ...left };
      for (const [key, value] of Object.entries(right)) {
        result[key] = merge(left[key], value);
      }
      return result;
    }
    return right;
  };

  return merge(base, overrides) as Messages;
}
