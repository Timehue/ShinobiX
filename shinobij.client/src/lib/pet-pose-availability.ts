/**
 * Lightweight card/yard check for the generated pose catalog. Importing the
 * full manifest here would put three large combat Sets on the startup graph.
 * The generated catalog currently covers these complete production families;
 * the parity test fails if that ever changes.
 */
const POSED_PET_ID_RE = /^(?:generic-ai-pet-(?:emberlynx|guardhound|sparrow)|starter-(?:earth|fire|lightning|water|wind)(?:-[lr])?|(?:standard|rare)-(?:[1-4]\d|\d)|legendary-(?:[12]\d|\d)|mythic-\d)$/;

export const hasPetPose = (id: string): boolean => POSED_PET_ID_RE.test(id);
