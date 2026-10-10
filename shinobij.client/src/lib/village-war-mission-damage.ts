/*
 * The WAR half of the village-war daily mission, moved verbatim out of
 * lib/world-state.ts. Only the Logbook calls it, and the Logbook loads on
 * demand, but App imports world-state at startup, so while it lived there the
 * whole write rode the startup graph (scripts/check-build-size.mjs
 * INITIAL_GRAPH_GZIP_FAIL_BYTES). The shared war cache it adopts into stays in
 * world-state; this module only reaches it through world-state's exports.
 */
import type { Character } from "../types/character";
import {
    activeVillageWarsFor,
    applyAuthoritativeVillageWar,
    postVillageWarUpdate,
    villageWarHpMax,
    VILLAGE_WAR_MISSION_DAMAGE,
    type VillageWar,
} from "./world-state";

/** What a mission damage write did. `ok` is true only when the server accepted
 *  it, so a caller can never announce damage the server refused. */
export type VillageWarMissionDamageResult = { ok: boolean; note: string; war?: VillageWar | null };

const VILLAGE_WAR_MISSION_ATTEMPTS = 3;
let villageWarMissionRetryMs = 400;
/** Test-only: shorten the pause between mission damage attempts. */
export function __setVillageWarMissionRetryMsForTest(ms: number): void {
    villageWarMissionRetryMs = ms;
}

/**
 * The cached row a mission damage write posts with its token. The server applies
 * the token's sealed damage itself and ignores this row's HP, so the winner, the
 * end time and the war-ground capture are never sent: the server stamps those,
 * and a stale capture flag would read as a client capture, which it refuses. The
 * enemy HP still carries the mission's damage, so a server that judged a mission
 * by the HP delta lands the same hit.
 */
function villageWarMissionPayload(war: VillageWar, enemyVillage: string) {
    const enemyHp = war.hp[enemyVillage] ?? villageWarHpMax(war, enemyVillage);
    return {
        id: war.id,
        ...(war.declarationGeneration ? { declarationGeneration: war.declarationGeneration } : {}),
        villages: war.villages,
        hp: { ...war.hp, [enemyVillage]: Math.max(0, enemyHp - VILLAGE_WAR_MISSION_DAMAGE) },
        warGroundSector: war.warGroundSector,
        warGroundHp: war.warGroundHp,
        startedAt: war.startedAt,
    };
}

/**
 * Village-war daily mission: the WAR half only.
 *
 * The character half belongs to /api/village/war-mission (see
 * lib/world-reward-api.ts), which verifies the raid count against stored state,
 * pays the reward, and mints a single-use `warMissionToken` sealing the damage.
 * The caller commits that reward FIRST and only then calls this.
 *
 * The war half is a server command. This posts the token with the cached war
 * row, waits for the answer, and adopts the server's row into the shared cache.
 * The server applies the sealed damage and, when the enemy reaches 0, ends the
 * war with this village as the winner. Nothing here computes a winner or an end
 * time. It used to fire and forget, so the Logbook announced the damage even
 * when the server refused it.
 *
 * Only an outage or a settling row (a 5xx) is retried. The token is single-use
 * and the server answers a repeat with the row it already damaged, so a retry
 * can never land the damage twice. A 4xx refusal is final.
 *
 * The winner's Legendary War Crate is never granted here: `claimServerWarCrates`
 * claims it through /api/village/claim-war-crate on the next sweep.
 */
export async function applyVillageWarMissionDamage(character: Character, warMissionToken?: string): Promise<VillageWarMissionDamageResult> {
    // No gate here: /api/village/war-mission already validated the raid count
    // and the claim order against STORED state, and has committed the reward by
    // the time this runs. Re-checking would refuse every time, because the
    // character handed in has the freshly incremented completed count.
    const war = activeVillageWarsFor(character.village)[0];
    const enemyVillage = war?.villages.find(village => village !== character.village);
    if (!war || !enemyVillage) return { ok: false, note: "Mission reward claimed. Your village is not in an active war, so no war damage was dealt." };
    if (!warMissionToken) return { ok: false, note: `Mission reward claimed, but the server did not authorize its war damage, so ${enemyVillage} took none.` };
    let failure = "the server could not be reached";
    for (let attempt = 0; attempt < VILLAGE_WAR_MISSION_ATTEMPTS; attempt += 1) {
        if (attempt > 0) await new Promise(resolve => setTimeout(resolve, villageWarMissionRetryMs * attempt));
        let reply: { status: number; data: Record<string, unknown> | null };
        try {
            reply = await postVillageWarUpdate({ kind: "war", war: villageWarMissionPayload(war, enemyVillage), warMissionToken });
        } catch {
            failure = "the server could not be reached";
            continue;
        }
        // A refusal can still carry the authoritative row (e.g. the war ended).
        const adopted = applyAuthoritativeVillageWar(reply.data?.war);
        if (reply.status >= 200 && reply.status < 300) {
            const wonWar = Boolean(adopted?.endedAt && adopted.winnerVillage === character.village);
            return {
                ok: true,
                war: adopted,
                note: `Village war mission complete. ${enemyVillage} HP -${VILLAGE_WAR_MISSION_DAMAGE}.${wonWar ? " Your village won the war — your Legendary War Crate is on its way." : ""}`,
            };
        }
        failure = String(reply.data?.error ?? `HTTP ${reply.status}`);
        if (reply.status < 500) break;
    }
    return { ok: false, note: `Mission reward claimed, but its war damage was not applied: ${failure}` };
}
