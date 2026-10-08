/**
 * How a revealed secret is shown. "on" colours each character by what it is
 * (AlphabetSoup's letters / digits / symbols); "colorblind" does the same in
 * a palette that stays apart under a colour-vision deficiency; "off" leaves
 * it plain monospace. On by default: a 1, an l and an I should never have to
 * be told apart by shape alone.
 */
export const SECRET_STYLES = ["on", "colorblind", "off"] as const;

export type SecretStyle = (typeof SECRET_STYLES)[number];

export const DEFAULT_SECRET_STYLE: SecretStyle = "on";

export function isSecretStyle(value: unknown): value is SecretStyle {
  return (
    typeof value === "string" && (SECRET_STYLES as readonly string[]).includes(value)
  );
}

/** The cookie a reader's own choice is remembered in. */
export const SECRET_STYLE_COOKIE = "trove-kb-secret-style";
