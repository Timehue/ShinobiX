import { kv } from './_storage.js';
import { safeName } from './_utils.js';

/*
 * Sector-war role weights (§17.6 — role-scaled Control HP). A fighter's VILLAGE
 * RANK scales how much a resolved sector-war fight swings the contested sector's
 * Control HP — mirrored 1:1 on the village-war model (client
 * lib/world-state villageWarRoleValue / villageWarLossPenalty): higher ranks DEAL
 * more when they win, and COST their own side more when they fall. Roles are
 * resolved SERVER-SIDE from seated/appointee rows;
 * client-authored rank/story titles never affect the weight.
 *
 * Clan rows are not role authority here: their current mutation contract lets a
 * member edit its own role label and lets founders replace the roster. Until a
 * separate server-owned clan leadership ledger exists, clan-derived Elder
 * weight fails closed to villager.
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

export interface SealedWarRoleEvidence {
    version: 1;
    sealedAt: number;
    p1: { village: string; role: RoleWeights };
    p2: { village: string; role: RoleWeights };
}

function exactServerRole(value: unknown): RoleWeights | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const role = value as Partial<RoleWeights>;
    const known = [ROLE_KAGE, ROLE_ANBU, ROLE_VILLAGER] as const;
    const match = known.find(candidate => candidate.win === role.win && candidate.loss === role.loss);
    return match ? { ...match } : null;
}

/** Read immutable role evidence sealed when the PvP session was created.
 * Missing/malformed legacy evidence fails closed to villager; settlement never
 * imports a Kage seat or ANBU appointment granted after the battle began. */
export function sealedSectorWarRoleOf(
    evidence: unknown,
    side: 'p1' | 'p2',
    expectedVillage: string,
    expectedSealedAt: number,
): RoleWeights {
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return ROLE_VILLAGER;
    const sealed = evidence as Partial<SealedWarRoleEvidence>;
    const entry = sealed[side];
    const role = exactServerRole(entry?.role);
    if (sealed.version !== 1
        || !Number.isSafeInteger(sealed.sealedAt)
        || sealed.sealedAt !== expectedSealedAt
        || !entry
        || String(entry.village ?? '').trim().toLowerCase() !== String(expectedVillage ?? '').trim().toLowerCase()
        || !role) {
        return ROLE_VILLAGER;
    }
    return role;
}

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

interface SaveShape { character?: { village?: string } }
interface VillageStateShape { seatedKage?: string; anbuAppointees?: string[] }

/** Resolve a player's sector-war role weights from authoritative server state.
 *  Kage = the village's seated Kage; ANBU = an appointed ANBU; everyone else
 *  fights as a villager. When `expectedVillage` is supplied from a sealed battle,
 *  a later village switch cannot import the current village's seat or title weight
 *  into that older battle. Never throws — falls back to villager on any miss. */
export async function sectorWarRoleOf(playerName: string, expectedVillage?: string): Promise<RoleWeights> {
    try {
        const name = safeName(String(playerName ?? ''));
        if (!name) return ROLE_VILLAGER;
        const save = await kv.get<SaveShape>(`save:${name}`);
        const ch = save?.character;
        if (!ch) return ROLE_VILLAGER;
        const village = String(ch.village ?? '').trim();
        const sealedVillage = expectedVillage === undefined ? undefined : String(expectedVillage).trim();
        if (sealedVillage !== undefined && village.toLowerCase() !== sealedVillage.toLowerCase()) {
            return ROLE_VILLAGER;
        }
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
        const seatedKage = safeName(String(seat?.seatedKage ?? ''));
        if (seatedKage === name) return ROLE_KAGE;
        const anbu = Array.isArray(vs?.anbuAppointees)
            && vs.anbuAppointees.some((appointee) => safeName(String(appointee)) === name);
        if (anbu) return ROLE_ANBU;
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
