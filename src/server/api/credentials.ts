/**
 * Finding the API key in a request. The key is what Trove KB handed out, and it
 * is accepted as it was handed out: with the `Bearer` scheme in front, which
 * is what the HTTP convention asks for, or on its own, which is what people
 * paste. An `X-API-Key` header is read when there is no `Authorization`.
 *
 * Accepting the bare key gives nothing away. The key is the whole secret
 * either way; the word in front of it never was.
 */
export function presentedKey(headers: Headers): string {
  const authorization = headers.get("authorization")?.trim() ?? "";

  if (authorization !== "") {
    const bearer = /^bearer\s+(\S.*)$/i.exec(authorization);
    if (bearer?.[1]) return bearer[1].trim();

    // Anything else with a space in it is another scheme — Basic, Digest —
    // and not a key of ours.
    return /\s/.test(authorization) ? "" : authorization;
  }

  return headers.get("x-api-key")?.trim() ?? "";
}

/** What a caller with no key is told. One wording, wherever they knocked. */
export const NO_KEY_MESSAGE = "Provide an API key in the Authorization header";
