/**
 * Doc type icons are stored by their lucide name, the kebab-case one the lucide
 * site shows ("building-2", "globe-lock"). lucide-react exports the components
 * in PascalCase ("Building2", "GlobeLock"). Both spellings share one key: the
 * letters and digits, lowercased, so "arrow-down-a-z" and "ArrowDownAZ" meet.
 */

/** The key both spellings of an icon's name share. */
export function iconKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** "GlobeLock" → "globe-lock". The name the lucide site shows, and what is stored. */
export function iconStoredName(componentName: string): string {
  return componentName
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    // A digit after letters starts a new word ("building-2"), unless the letters
    // themselves follow a digit, as in "2x2" or "3d".
    .replace(/(?<![0-9][a-z]*)([a-z])([0-9])/g, "$1-$2")
    .replace(/([0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/** Letters, digits, and dashes only: what a lucide name is made of. */
export function isIconName(value: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
}
