import { kv } from './_storage.js';

/*
 * Sector-war role weights (§17.6 — role-scaled Control HP). A fighter's VILLAGE
 * RANK scales how much a resolved sector-war fight swings the contested sector's
 * Control HP — mirrored 1:1 on the village-war model (client
 * lib/world-state villageWarRoleValue / villageWarLossPenalty): higher ranks DEAL
 * more when they win, and COST their own side more when they fall. Roles are
 * resolved SERVER-SIDE from the player's save (rank/story title) + the village
 * state (seated Kage, ANBU appointees), so a client can't inflate its own weight.
 *
 * Elder here = the appointed VILLAGE-Elder seats (title-based, no clan-size gate);
 * a clan leader without a village seat fights as a villager. This is the fully
 * server-verifiable subset of the village-war Elder tier.
 */

export interface RoleWeights {
    /** Control-HP contribution when this fighter WINS. */
    win: number;
    /** Extra swing added when this fighter LOSES (the "worth more when they fall" tier). */
    loss: number;
}

export const ROLE_KAGE: RoleWeights = { win: 30, loss: 50 };
export const ROLE_ELDER: RoleWeights = { win: 20, loss: 20 };
export const ROLE_ANBU: RoleWeights = { win: 15, loss: 0 };
export const ROLE_VILLAGER: RoleWeights = { win: 5, loss: 0 };
// An AI mercenary fights as rank-and-file: a villager's chip, nothing lost when it falls.
export const ROLE_MERC: RoleWeights = ROLE_VILLAGER;

const VILLAGE_STATE_PREFIX = 'game:village-state:';
function villageStateKey(village: string): string {
    return `${VILLAGE_STATE_PREFIX}${village.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}
/** The AUTHORITATIVE seated-Kage row (`village:kage:<slug>`, spaces → dashes) —
 *  the one every Kage power reads. Note the slug differs from villageStateKey's:
 *  that one strips punctuation entirely, this one hyphenates. */
function kageSeatKey(village: string): string {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}

interface SaveShape { character?: { rankTitle?: string; storyTitle?: string; village?: string } }
interface VillageStateShape { seatedKage?: string; anbuAppointees?: string[] }

/** Resolve a player's sector-war role weights from authoritative server state.
 *  Kage = the village's seated Kage (or a "kage" rank title); Elder = an appointed
 *  village-Elder seat; ANBU = an appointed ANBU (or an "anbu" title); everyone else
 *  fights as a villager. Never throws — falls back to villager on any miss. */
export async function sectorWarRoleOf(playerName: string): Promise<RoleWeights> {
    try {
        const name = String(playerName ?? '').trim().toLowerCase();
        if (!name) return ROLE_VILLAGER;
        const save = await kv.get<SaveShape>(`save:${name}`);
        const ch = save?.character;
        if (!ch) return ROLE_VILLAGER;
        const title = `${ch.rankTitle ?? ''} ${ch.storyTitle ?? ''}`.toLowerCase();
        const village = String(ch.village ?? '');
        // The seat comes from the AUTHORITATIVE `village:kage:` row; ANBU appointees
        // only exist on the village-state, so that is still read for them.
        //
        // This used to take the Kage from `game:village-state:<slug>.seatedKage`, a
        // LAGGING MIRROR that only refreshes on a validated villageState write. A
        // genuinely seated Kage therefore fought at VILLAGER weight (swing 5 instead
        // of 30 — a sector costs 20 wins instead of 5) until some member's next save
        // rehydrated it, and a just-dethroned one kept Kage weight. Observed live on
        // a real seated Kage. world-state.ts isSeatedKageOf documents the same trap.
        const [seat, vs] = village
            ? await Promise.all([
                kv.get<VillageStateShape>(kageSeatKey(village)),
                kv.get<VillageStateShape>(villageStateKey(village)),
            ])
            : [null, null];
        const seatedKage = String(seat?.seatedKage ?? '').trim().toLowerCase();
        if (seatedKage === name || title.includes('kage')) return ROLE_KAGE;
        if (title.includes('first elder') || title.includes('second elder') || title.includes('third elder') || title.includes('village elder')) return ROLE_ELDER;
        const anbu = Array.isArray(vs?.anbuAppointees) && vs!.anbuAppointees!.some((a) => String(a).trim().toLowerCase() === name);
        if (anbu || title.includes('anbu')) return ROLE_ANBU;
        return ROLE_VILLAGER;
    } catch {
        return ROLE_VILLAGER;
    }
}

/** The Control-HP swing for one resolved fight: the winner's contribution plus the
 *  loser's rank penalty, scaled by the attacker village's War-Academy multiplier.
 *  Always ≥ 1 so a fight is never a no-op. Pure. */
export function sectorControlSwing(winner: RoleWeights, loser: RoleWeights, academyMult = 1): number {
    return Math.max(1, Math.round((winner.win + loser.loss) * academyMult));
}
