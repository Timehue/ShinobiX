import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { normalizeVillageWarRecord, villageWarKey, SECTOR_CONTROL_HP_PER_WIN } from '../_war-state.js';
import { sectorWarDamageMultiplier } from '../_war-structures.js';
import { applyContestBattleByWinner, sectorWarKey } from '../_sector-war.js';
import { loadSectorWar, saveSectorWar, deleteSectorWar } from '../_sector-war-store.js';
import { captureSectorForVillage } from '../world-state.js';
import { runPetDuel } from '../_pet-sim/pet-duel-sim.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import { petStatCeil, type PetCeilStat } from '../_pet-stat-ceil.js';

/*
 * /api/village/sector-pet — POST only. The sector-war "Pet" win-condition (Phase 7).
 *
 * A Pet sector-war is a deterministic 1v1 PET DUEL resolved SERVER-SIDE by the exact
 * engine the client renders — api/pet-sim/pet-duel-sim is a GENERATED copy of
 * lib/pet-duel-sim (scripts/gen-pet-sim.mjs; the parity test guards it byte-for-byte).
 * Two real players each bring a pet: the attacker opens, the defender joins, and the
 * duel auto-resolves the instant both pets are in — no turns, the sim is deterministic
 * from (both pets, seed). The winner maps onto the contest exactly like Combat/Card:
 * attacker win → chip Control HP (flip on capture), defender win → regen, draw → no
 * change. The client REPLAYS the same (pets, seed) to show the fight — identical to
 * the server, so it can never disagree on who won.
 *
 * Pet stats are clamped server-side (petStatCeil) so a tampered save can't seal an OP
 * pet. Server-gated: 404 unless ENABLE_VILLAGE_WAR=1.
 *
 * Body: { action, sectorWarId, petId? }
 *   join  { petId }  attacker opens with a pet / defender joins with a pet → resolve
 *   state {}         read the session (drives the defender join + the client replay)
 */

const SESSION_TTL_SEC = 30 * 60; // 30m hygiene — abandoned duels self-clean
const CEIL_STATS: readonly PetCeilStat[] = ['hp', 'attack', 'defense', 'speed'];

type SectorPetSession = {
    sectorWarId: string;
    sector: number;
    attackerVillage: string;
    defenderVillage: string;
    p1: { name: string; pet: Pet };       // attacker-side opener
    p2?: { name: string; pet: Pet };       // defender-side joiner
    status: 'awaiting-defender' | 'done';
    seed?: number;
    winner?: 'p1' | 'p2' | 'draw';
    terrain?: string | null;   // defender sector terrain sealed at resolve → drives the home-ground element bonus in the (identical) client replay
    appliedToContest?: boolean;
    createdAt: number;
    updatedAt: number;
};

function sessionKey(sectorWarId: string): string { return `sector-pet:${sectorWarId}`; }

async function villageOf(playerName: string): Promise<string> {
    const save = await kv.get<{ character?: { village?: string } }>(`save:${playerName.toLowerCase()}`);
    return String(save?.character?.village ?? '').trim();
}

// Seal a player's chosen pet from their save (by id, else active, else first), then
// CLAMP the four battle stats to the per-rarity anti-tamper ceiling so a tampered
// save can't field an absurd pet into a territory-flipping duel.
async function sealPlayerPet(playerName: string, petId: string): Promise<Pet | null> {
    const save = await kv.get<{ character?: { pets?: unknown[]; activePetId?: string } }>(`save:${playerName.toLowerCase()}`);
    const pets = Array.isArray(save?.character?.pets) ? (save!.character!.pets as Record<string, unknown>[]) : [];
    if (!pets.length) return null;
    const activeId = String(save?.character?.activePetId ?? '');
    const raw = pets.find((p) => String(p.id) === petId)
        ?? pets.find((p) => String(p.id) === activeId)
        ?? pets[0];
    if (!raw) return null;
    const pet = { ...raw } as unknown as Pet;
    for (const stat of CEIL_STATS) {
        const v = Number(raw[stat]) || 0;
        (pet as unknown as Record<string, number>)[stat] = Math.min(v, petStatCeil(raw.rarity, stat));
    }
    return pet;
}

// Apply the duel winner to the sector-war contest — p1 = attacker, p2 = defender, so
// the winner maps straight on (attacker chip / defender regen / draw no-op). Idempotent
// via appliedToContest; nested under the session lock the caller holds.
async function applyPetOutcomeToContest(session: SectorPetSession): Promise<void> {
    await withKvLock(sectorWarKey(session.sectorWarId), async () => {
        const contest = await loadSectorWar(session.sectorWarId);
        if (!contest || contest.flipped) return;
        const atkRecord = normalizeVillageWarRecord(session.attackerVillage, (await kv.get<Record<string, unknown>>(villageWarKey(session.attackerVillage))) ?? undefined);
        const damage = Math.round(SECTOR_CONTROL_HP_PER_WIN * sectorWarDamageMultiplier(atkRecord));
        const outcome = applyContestBattleByWinner(contest, session.winner ?? 'draw', { now: Date.now(), damage });
        if (!outcome) return; // draw — Control HP untouched
        if (outcome.captured) {
            await captureSectorForVillage(session.sector, session.attackerVillage, Date.now());
            await deleteSectorWar(session.sectorWarId);
        } else {
            await saveSectorWar(outcome.session);
        }
    }, { failClosed: true });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (process.env.ENABLE_VILLAGE_WAR !== '1') return res.status(404).json({ error: 'Not found.' });

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'sector-pet', 60, 60_000, identity.name))) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const action = String(body?.action ?? '').toLowerCase();
        const sectorWarId = String(body?.sectorWarId ?? '').trim();
        if (!sectorWarId) return res.status(400).json({ error: 'Missing sectorWarId.' });
        const me = identity.admin ? safeName(String(body?.playerName ?? '')) : identity.name;

        if (action === 'state') {
            const session = await kv.get<SectorPetSession>(sessionKey(sectorWarId));
            if (!session) return res.status(404).json({ error: 'No pet duel session yet.' });
            return res.status(200).json({ session });
        }
        if (action !== 'join') return res.status(400).json({ error: `Unknown action: ${action}` });

        const result = await withKvLock(sessionKey(sectorWarId), async () => {
            const contest = await loadSectorWar(sectorWarId);
            if (!contest || contest.flipped) return { status: 409 as const, body: { error: 'No active sector war for that id.' } };
            if (contest.winCondition !== 'pet') return { status: 409 as const, body: { error: 'That sector is not a Pet contest.' } };
            const { attackerVillage, defenderVillage } = contest;

            const myVillage = identity.admin
                ? (String(body?.side ?? 'p1') === 'p2' ? defenderVillage : attackerVillage)
                : await villageOf(me);
            const isAttacker = myVillage === attackerVillage;
            const isDefender = myVillage === defenderVillage;
            if (!isAttacker && !isDefender) return { status: 403 as const, body: { error: 'You are not a participant in this sector war.' } };

            const pet = await sealPlayerPet(me, String(body?.petId ?? ''));
            if (!pet) return { status: 400 as const, body: { error: 'You have no pet to send into battle.' } };

            const existing = await kv.get<SectorPetSession>(sessionKey(sectorWarId));
            const now = Date.now();

            // Attacker opens a fresh duel (or re-opens after the last one finished).
            if (!existing || existing.status === 'done') {
                if (!isAttacker) return { status: 409 as const, body: { error: 'Waiting for an attacker to send a pet.' } };
                const session: SectorPetSession = {
                    sectorWarId, sector: contest.sector, attackerVillage, defenderVillage,
                    p1: { name: me, pet }, status: 'awaiting-defender', createdAt: now, updatedAt: now,
                };
                await kv.set(sessionKey(sectorWarId), session, { ex: SESSION_TTL_SEC });
                return { status: 200 as const, body: { session } };
            }
            // Idempotent re-open by the same attacker (e.g. a retry before a defender answered).
            if (existing.p1.name.toLowerCase() === me.toLowerCase()) {
                return { status: 200 as const, body: { session: existing } };
            }
            if (existing.status !== 'awaiting-defender') return { status: 409 as const, body: { error: 'This pet duel is no longer accepting a defender.' } };
            if (!isDefender) return { status: 409 as const, body: { error: 'A defender of this sector must answer the pet duel.' } };

            // Defender joins → resolve the deterministic duel SERVER-SIDE + apply it.
            // Seal the defender sector's terrain so the pet whose element matches gets
            // the +10% home-ground bonus (§17.3), and store it on the session so the
            // client REPLAYS with the same terrain and stays byte-identical.
            const defRec = normalizeVillageWarRecord(defenderVillage, (await kv.get<Record<string, unknown>>(villageWarKey(defenderVillage))) ?? undefined);
            const terrain = defRec.sectors[String(contest.sector)]?.terrain ?? null;
            const seed = (now ^ (contest.sector * 2654435761)) >>> 0;
            const duel = runPetDuel(existing.p1.pet, pet, seed, 1, 1, false, false, false, terrain);
            const winner: 'p1' | 'p2' | 'draw' = duel.winner === 'player' ? 'p1' : duel.winner === 'enemy' ? 'p2' : 'draw';
            const session: SectorPetSession = { ...existing, p2: { name: me, pet }, status: 'done', seed, winner, terrain, updatedAt: now };
            await applyPetOutcomeToContest(session);
            session.appliedToContest = true;
            await kv.set(sessionKey(sectorWarId), session, { ex: SESSION_TTL_SEC });
            return { status: 200 as const, body: { session } };
        });

        return res.status(result.status).json(result.body);
    } catch (err) {
        console.error('[village/sector-pet]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
