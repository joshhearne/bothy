/**
 * Initials for the account button. First and last word of a name, so
 * "Josh Hearne" reads JH and "Ann Marie Smith" reads AS. Falls back to the
 * email when someone has no name worth abbreviating.
 */
export function initialsFor(name: string, email: string): string {
  const words = name
    .split(/[\s._-]+/)
    .map((word) => word.trim())
    .filter((word) => /\p{L}|\p{N}/u.test(word));

  if (words.length >= 2) {
    const first = [...(words[0] as string)][0] ?? "";
    const last = [...(words[words.length - 1] as string)][0] ?? "";
    return (first + last).toUpperCase();
  }

  if (words.length === 1) {
    return ([...(words[0] as string)][0] ?? "").toUpperCase();
  }

  const local = email.split("@")[0] ?? "";
  const fromEmail = [...local].find((character) => /\p{L}|\p{N}/u.test(character));
  return (fromEmail ?? "?").toUpperCase();
}
