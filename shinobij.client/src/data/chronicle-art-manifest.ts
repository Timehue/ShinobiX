import type { TileCard } from "./tile-cards";
import { CHRONICLE_CARD_CATALOG } from "../../../shared/chronicle-duel";

export type ChronicleArtManifestRow = {
  cardId: string;
  runtimePath?: string;
  provenance:
    | "canonical-existing"
    | "admin-existing"
    | "generated-original"
    | "omitted-no-matching-asset";
  treatment: "direct-reuse" | "runtime-overlay" | "no-image-element";
};

/** Runtime audit manifest. Every assigned path must resolve to its matching
 * subject; the client never substitutes unrelated art, emoji or debug images. */
export function buildChronicleArtManifest(
  tileCards: readonly TileCard[],
): ChronicleArtManifestRow[] {
  const overlays = new Map(
    tileCards
      .filter((card) => card.image)
      .map((card) => [card.id, card.image!]),
  );
  return CHRONICLE_CARD_CATALOG.map((card) => {
    const overlay = overlays.get(card.id);
    if (overlay)
      return {
        cardId: card.id,
        runtimePath: overlay,
        provenance: "admin-existing",
        treatment: "runtime-overlay",
      };
    if (card.image?.startsWith("/chronicle/"))
      return {
        cardId: card.id,
        runtimePath: card.image,
        provenance: "generated-original",
        treatment: "direct-reuse",
      };
    if (card.image)
      return {
        cardId: card.id,
        runtimePath: card.image,
        provenance: "canonical-existing",
        treatment: "direct-reuse",
      };
    return {
      cardId: card.id,
      provenance: "omitted-no-matching-asset",
      treatment: "no-image-element",
    };
  });
}
