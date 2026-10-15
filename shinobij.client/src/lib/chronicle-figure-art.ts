import {
  CHRONICLE_PAINTED_ART,
  CHRONICLE_PAINTED_FIGURES,
} from "../../../shared/chronicle-painted-art";

/** Never pair a newly painted card with a creature from the old illustration.
 * Until its matching pair is packaged the board displays the new card standee. */
export function chronicleFigureSources(cardId: string, back = false): string[] {
  const painted = CHRONICLE_PAINTED_FIGURES[cardId];
  if (painted) return back ? [painted.back, painted.front] : [painted.front];
  if (CHRONICLE_PAINTED_ART[cardId]) return [];
  return back
    ? [`/chronicle/figures/${cardId}-back.webp`, `/chronicle/figures/${cardId}.webp`]
    : [`/chronicle/figures/${cardId}.webp`];
}
