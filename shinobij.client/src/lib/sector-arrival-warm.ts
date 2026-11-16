import { loadPins, portraitModels, revisions } from "virtual:sector-model-pins";
import type { Wanderer } from "../../../shared/wanderer-roster";
import { isPlayableWildSector } from "../../../shared/sector-geo";
import { loadContinuousWorld } from "./continuous-world-client";
import { ARRIVAL_WARM_BYTES, arrivalFigures, type ArrivalFigure } from "./sector-arrival-figures";
import { prefetchSectorLife } from "./sector-life-api";
import { loadSectorModel, sectorModelFolder } from "./sector-model-manifest";
import { prefetchSectorPresentation, sectorPlayerGaitsOn, worldModelArtBase } from "./sector-obstacles";
import { wandererAvatar } from "./wanderer-art";

const modelForPerson = (person: Wanderer) => portraitModels.get(person.avatarImage || wandererAvatar(person.avatarKey));

/**
 * Decode one figure's first frame ahead of its mount: manifest, the front
 * facing's index, and its standing page. Every step lands in a shared cache the
 * mounted figure reads, at warm-up priority, so a real figure's page always goes
 * first. Returns the decoded bytes it used (0 when it stopped short).
 */
async function warmFigure(artBase: string, figure: ArrivalFigure, budget: number): Promise<number> {
    const revision = figure.equipped?.version ?? revisions[figure.kind];
    if (!revision) return 0;
    const folder = sectorModelFolder(artBase, figure.kind, figure.equipped?.assetId);
    const model = await loadSectorModel(folder, revision, "low");
    if (!model.packed) return 0;
    const delivery = await import("./sector-pose-delivery");
    const bank = await delivery.loadFacing(folder, model.packed.styles[figure.style][0]!, 2);
    const page = bank.idle?.page;
    if (!page) return 0;
    const bytes = page.cell[0]! * page.cell[1]! * page.cols * Math.ceil(page.frames / page.cols) * 4;
    if (bytes > budget) return 0;
    // Released at once: the page stays in the shared cache until a figure takes it.
    (await delivery.loadPackedImage(folder, page, 2)).release();
    return bytes;
}

/**
 * Start what a sector needs to appear, during the travel wait before it mounts:
 * the world layout, the road's people, and the first frame of each figure.
 * Best effort only: nothing here changes state, every failure is silent, and the
 * arriving sector loads whatever is still missing exactly as it would have.
 */
export async function warmSectorArrival({ sector, player, self, cast }: {
    sector: number; player: string; self: ArrivalFigure | null; cast: readonly Wanderer[];
}): Promise<void> {
    void loadContinuousWorld().catch(() => {});
    // Only sectors that run a road scene ask for one (the same gate useSectorLife uses).
    const life = isPlayableWildSector(sector) ? prefetchSectorLife(player, sector) : Promise.resolve(undefined);
    void import("./sector-pose-delivery").catch(() => {});
    // After a reload the flags may still be on their way; one answer serves both.
    await Promise.all([prefetchSectorPresentation(), loadPins()]).catch(() => {});
    const artBase = worldModelArtBase();
    if (!artBase) return;
    // The player's own figure (shown only with fitted gaits) does not wait on the road's reply.
    let budget = ARRIVAL_WARM_BYTES;
    const own = arrivalFigures(sectorPlayerGaitsOn() ? self : null, [], () => undefined);
    for (const figure of own) budget -= await warmFigure(artBase, figure, budget).catch(() => 0);
    const people = await life.then(reply => reply?.view?.actors.map(actor => actor.wanderer) ?? [], () => []);
    const others = arrivalFigures(own[0] ?? null, [...people, ...cast], modelForPerson).slice(own.length);
    for (const figure of others) {
        if (budget <= 0) break;
        budget -= await warmFigure(artBase, figure, budget).catch(() => 0);
    }
}
