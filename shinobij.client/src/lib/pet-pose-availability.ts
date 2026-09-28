/**
 * Lightweight check for pets with authored idle art. Importing the full pose
 * manifest here would put three large combat Sets on the startup graph. The
 * breeding mythics have static idle cutouts alongside the generated families.
 */
const POSED_PET_ID_RE = /^(?:generic-ai-pet-(?:emberlynx|guardhound|sparrow)|starter-(?:earth|fire|lightning|water|wind)(?:-[lr])?|(?:standard|rare)-(?:[1-4]\d|\d)|legendary-(?:[12]\d|\d)|mythic-(?:1[0-5]|\d))$/;

export const hasPetPose = (id: string): boolean => POSED_PET_ID_RE.test(id);
