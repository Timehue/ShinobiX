import type { PlayerModel, SprintStyle } from "./player-model";

/**
 * The decoded-page budget for one arrival. Below the shared 12 MB page cache,
 * so the warmed pages evict only the sector being left, never each other.
 */
export const ARRIVAL_WARM_BYTES = 9 * 1024 ** 2;
/** The player's own figure plus the first people a sector shows. */
export const ARRIVAL_WARM_FIGURES = 8;

export type ArrivalFigure = { kind: string; equipped?: PlayerModel; style: SprintStyle };

/**
 * The fitted figures an arrival shows first: the player's own, then the road's
 * people, each model once, in that order, at most ARRIVAL_WARM_FIGURES. People
 * without a fitted model keep their lightweight standing figures.
 */
export function arrivalFigures<P>(self: ArrivalFigure | null, people: readonly P[], modelFor: (person: P) => string | undefined): ArrivalFigure[] {
    const figures: ArrivalFigure[] = self ? [self] : [];
    const seen = new Set(figures.map(figure => figure.equipped ? "players/" + figure.equipped.assetId : figure.kind));
    for (const person of people) {
        if (figures.length >= ARRIVAL_WARM_FIGURES) break;
        const kind = modelFor(person);
        if (!kind || seen.has(kind)) continue;
        seen.add(kind);
        // Road people run in the default style; only the player picks one.
        figures.push({ kind, style: "A" });
    }
    return figures;
}
