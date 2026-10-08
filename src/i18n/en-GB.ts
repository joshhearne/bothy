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
    brandNoColor:
      "The site publishes no theme colour, and its stylesheets paint with none.",
  },

  documents: {
    rack: {
      typeHint:
        "Decides its colour. Taken from the document when you pick one.",
      key: "Colour key",
      overrideShadows: (type: string, other: string) =>
        `This client's ${type} colour is the one ${other} already uses here — change the override.`,
    },
    domain: {
      brandHint:
        "The site's own title, the logo it shows, the colours it paints with, and the icons it offers browsers, offered to the company's branding.",
    },
  },

  kb: {
    uncategorized: "Uncategorised",
  },

  app: {
    secretStyle: "Secret colours",
    secretStyles: {
      colorblind: "Colour-blind palette",
    },
  },

  admin: {
    vault: {
      organizationId: "Organisation id",
    },
    optionLists: {
      subtitle:
        "Shared sources for dropdown fields. Any doc type can point at the same list.",
    },
    branding: {
      poweredByHint:
        "Names the product and who makes it, at the foot of every page. The licence and the link to the source stay either way — anyone using this over a network is entitled to them.",
    },
  },
};
