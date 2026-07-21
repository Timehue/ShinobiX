/*
 * Per-contract Hunt Quality, accumulated across a hunt's tracking decisions and
 * read back when the beast finally breaks cover.
 *
 * Deliberately localStorage and NOT part of the character save:
 *  - App.tsx is at its App.size.test.ts line ratchet, so new lifted state there
 *    is not free (and this does not belong in the monolith anyway).
 *  - It is transient per-hunt scratch, not player progression. Losing it on a
 *    cleared cache costs the player a fight modifier, never a contract or a
 *    reward — a claim is gated by the SERVER receipt, which this never touches.
 *  - Keeping it off the save means it can never desync a claim, which is the
 *    failure mode that has bitten hunts repeatedly.
 *
 * It is client-authored and therefore client-forgeable. That is acceptable here
 * and ONLY here: quality changes PvE difficulty, never payout. Hunt rewards are
 * sealed server-side by the ai-fight token and paid from the server's own
 * catalog by claim-mission, so the worst a forged value buys is an easier fight
 * for the same, unchanged reward. Do not extend this store to anything the
 * server pays out on.
 */
import { clampHuntQuality } from "./hunt-encounter";

const HUNT_QUALITY_KEY = "hunt.quality.v1";

type QualityMap = Record<string, number>;

function readAll(): QualityMap {
    try {
        const raw = localStorage.getItem(HUNT_QUALITY_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const out: QualityMap = {};
        for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
            const n = Number(value);
            if (Number.isFinite(n)) out[id] = clampHuntQuality(n);
        }
        return out;
    } catch {
        return {}; // private mode / bad JSON — hunts just run at neutral quality
    }
}

function writeAll(map: QualityMap): void {
    try {
        localStorage.setItem(HUNT_QUALITY_KEY, JSON.stringify(map));
    } catch { /* private mode — quality simply won't persist */ }
}

export function readHuntQuality(missionId: string): number {
    if (!missionId) return 0;
    return clampHuntQuality(readAll()[missionId] ?? 0);
}

/** Add `delta` to a contract's quality (clamped) and return the new value. */
export function bumpHuntQuality(missionId: string, delta: number): number {
    if (!missionId) return 0;
    const map = readAll();
    const next = clampHuntQuality((map[missionId] ?? 0) + (Math.trunc(Number(delta)) || 0));
    map[missionId] = next;
    writeAll(map);
    return next;
}

/** Drop a contract's quality — on accept, on claim, and on abandon. */
export function clearHuntQuality(missionId: string): void {
    if (!missionId) return;
    const map = readAll();
    if (!(missionId in map)) return;
    delete map[missionId];
    writeAll(map);
}
