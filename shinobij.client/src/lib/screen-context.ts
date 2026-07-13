import type { Screen } from "../types/core";

// These routes already render a useful, screen-specific heading inside their
// primary panel. Showing the shared shell heading above them repeats the title
// and spends scarce vertical space without adding navigation context.
const NATIVE_CONTEXT_HEADER_SCREENS: ReadonlySet<Screen> = new Set([
  "professions",
  "training",
  "jutsuTraining",
  "missions",
  "townHall",
  "tavern",
]);

export function shouldShowScreenContextHeader(screen: Screen): boolean {
  return !NATIVE_CONTEXT_HEADER_SCREENS.has(screen);
}
