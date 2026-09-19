import type { Messages } from "@/i18n/en-US";

/** Every key is optional: what is not overridden falls back to en-US. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (...args: never[]) => unknown
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

/**
 * British English. Only the strings that actually differ, which for this
 * interface is spelling plus a couple of domain words.
 */
export const enGB: DeepPartial<Messages> = {
  companies: {
    isInternal: "This is my own organisation",
  },

  admin: {
    vault: {
      organizationId: "Organisation id",
    },
    optionLists: {
      subtitle: "Shared sources for dropdown fields. Any doc type can point at the same list.",
    },
  },
};
