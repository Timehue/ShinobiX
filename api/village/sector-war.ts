import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { isWarVillage, homeSectorsForVillage } from '../_war-map-sectors.js';
import {
    normalizeVillageWarRecord,
    villageWarKey,
    SECTOR_CONTROL_HP_PER_WIN,
    type WinCondition,
} from '../_war-state.js';
import { sectorControlHpMax, sectorWarDamageMultiplier } from '../_war-structures.js';
import {
    sectorWarId,
    sectorWarKey,
    newSectorWarSession,
    applySectorBattleResult,
    canDeclareSectorWar,
    newSectorWarBattleToken,
    type SectorWarDeclineReason,
} from '../_sector-war.js';
import {
    loadSectorWar,
    saveSectorWar,
    deleteSectorWar,
    activeContestOnSector,
    listActiveSectorWars,
    mintSectorWarToken,
    loadSectorWarToken,
    consumeSectorWarToken,
    getSectorOwnerVillage,
} from '../_sector-war-store.js';
import { villageHasActiveWar, captureSectorForVillage, seedHomeSectorOwnership } from '../world-state.js';
import { recordWarEcoEvent } from '../_war-telemetry.js';

/*
 * /api/village/sector-war — POST only. The sector-war battle-wiring (Phase 4c).
 *
 * Actions (body.action):
 *   - declare : the seated Kage opens a sector war on an enemy-held sector — debits
 *               250 WR (× comeback discount) from the attacking village's WR pool and
 *               opens the Control-HP siege. Mutually exclusive with a village war.
 *   - attack  : after the launcher fights the sector's defender through the existing
 *               sector-attack → PvP flow, this mints a SINGLE-USE token sealing the
 *               contest context for the resulting pvp:<battleId>.
 *   - resolve : reads the AUTHORITATIVE finished pvp:<battleId> (never a client claim),
 *               applies the win/loss to Control HP (War-Academy-boosted), and on
 *               capture flips world:territory:<sector>.ownerVillage to the attacker.
 *   - status  : read-only — the owner + active contest for a sector (or all contests).
 *   - seed    : admin — one-time idempotent seed of home-sector ownership (Phase 4d).
 *
 * Server-gated: 404 unless ENABLE_VILLAGE_WAR=1 (inert until launch). Combat
 * battles run here (attack/resolve); Card battles run via /village/sector-card and
 * settle the same contest. Pet stays blocked until its server sim lands (Phase 7)
 * — a client-claimed result must never flip territory.
 */

// Win-conditions whose server-authoritative battle path is wired this build
// (Combat here, Card via /village/sector-card). Pet → Phase 7.
const WIRED_WIN_CONDITIONS: readonly WinCondition[] = ['combat', 'card'];

type Identity = NonNullable<Awaited<ReturnType<typeof authedPlayerOrAdmin>>>;
type ReadBattle = { status?: string; winner?: string | null; p1?: { name?: string }; p2?: { name?: string } };

function kageKey(village: string): string {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}
async function isSeatedKage(village: string, playerName: string): Promise<boolean> {
    const st = await kv.get<{ seatedKage?: string }>(kageKey(village));
    return safeName(st?.seatedKage ?? '') === playerName;
}
async function villageOf(playerName: string): Promise<string> {
    const save = await kv.get<{ character?: { village?: string } }>(`save:${playerName}`);
    return String(save?.character?.village ?? '').trim();
}

function declineStatus(e: SectorWarDeclineReason): number {
    switch (e) {
        case 'mutual-exclusion-attacker':
        case 'mutual-exclusion-defender':
        case 'already-contested':
            return 409;
        default:
            return 400;
    }
}
function declineMessage(e: SectorWarDeclineReason, cost?: number): string {
    switch (e) {
        case 'self': return 'You cannot sector-war your own village.';
        case 'not-war-village': return 'Both villages must be war villages.';
        case 'not-war-sector': return 'That sector is not a war sector.';
        case 'not-enemy-held': return 'That sector is not currently held by an enemy village.';
        case 'mutual-exclusion-attacker': return 'Your village is in a village war — finish it before running sector wars.';
        case 'mutual-exclusion-defender': return 'The defending village is in a village war and cannot be sector-warred.';
        case 'already-contested': return 'That sector already has an active sector war.';
        case 'win-condition-unavailable': return 'That sector’s win-condition is not available yet.';
        case 'insufficient-wr': return `Declaring this sector war costs ${cost ?? 0} War Resources.`;
        default: return 'Cannot declare a sector war on that sector.';
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (process.env.ENABLE_VILLAGE_WAR !== '1') return res.status(404).json({ error: 'Not found.' });

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = String(body.action ?? '');
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act as yourself.' });
        }

        switch (action) {
            case 'declare': return await doDeclare(req, res, identity, playerName, body);
            case 'attack': return await doAttack(req, res, identity, playerName, body);
            case 'resolve': return await doResolve(req, res, identity, playerName, body);
            case 'status': return await doStatus(req, res, body);
            case 'seed': return await doSeed(res, identity);
            default: return res.status(400).json({ error: 'Unknown action.' });
        }
    } catch (err) {
        console.error('[village/sector-war]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

// ── declare ──────────────────────────────────────────────────────────────────
async function doDeclare(req: VercelRequest, res: VercelResponse, identity: Identity, playerName: string, body: Record<string, unknown>) {
    const village = typeof body.village === 'string' ? body.village.trim() : ''; // attacker
    const sector = Math.floor(Number(body.sector) || 0);
    if (!isWarVillage(village)) return res.status(400).json({ error: 'Not a war village.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'sector-war-declare', 20, 60_000, identity.name))) return;
    if (!identity.admin && !(await isSeatedKage(village, playerName))) {
        return res.status(403).json({ error: 'Only the seated Kage can declare a sector war.' });
    }

    const defender = await getSectorOwnerVillage(sector);
    if (!defender) return res.status(409).json({ error: 'That sector has no current owner — it must be seeded first.' });

    const atkKey = villageWarKey(village);
    const [attackerInWar, defenderInWar, existing, atkRecord, defRaw] = await Promise.all([
        villageHasActiveWar(village),
        isWarVillage(defender) ? villageHasActiveWar(defender) : Promise.resolve(false),
        activeContestOnSector(sector),
        kv.get<Record<string, unknown>>(atkKey),
        isWarVillage(defender) ? kv.get<Record<string, unknown>>(villageWarKey(defender)) : Promise.resolve(null),
    ]);
    const attackerRecord = normalizeVillageWarRecord(village, atkRecord ?? undefined);
    const defenderRecord = isWarVillage(defender) ? normalizeVillageWarRecord(defender, defRaw ?? undefined) : null;
    const winCondition = (defenderRecord?.sectors[String(sector)]?.winCondition ?? 'combat') as WinCondition;
    const controlHpMax = defenderRecord ? sectorControlHpMax(defenderRecord) : undefined;

    const check = canDeclareSectorWar({
        attackerVillage: village,
        defenderVillage: defender,
        sector,
        sectorOwnerVillage: defender,
        winCondition,
        attackerInActiveVillageWar: attackerInWar,
        defenderInActiveVillageWar: defenderInWar,
        contestAlreadyActive: !!existing,
        attackerWr: attackerRecord.warResources,
        attackerSectorsHeld: homeSectorsForVillage(village).length,
        allowedWinConditions: WIRED_WIN_CONDITIONS,
    });
    if (!check.ok) return res.status(declineStatus(check.error)).json({ error: declineMessage(check.error, check.cost) });

    const id = sectorWarId(sector, village, defender);
    const cost = check.cost;
    const out = await withKvLock(atkKey, async () => {
        const rec = normalizeVillageWarRecord(village, (await kv.get<Record<string, unknown>>(atkKey)) ?? undefined);
        if (rec.warResources < cost) return { ok: false as const, cost };
        const contestRes = await withKvLock(sectorWarKey(id), async () => {
            const exist = await loadSectorWar(id);
            if (exist && !exist.flipped) return { created: false as const, session: exist };
            const s = newSectorWarSession({ sector, attackerVillage: village, defenderVillage: defender, winCondition, now: Date.now(), controlHpMax });
            await saveSectorWar(s);
            return { created: true as const, session: s };
        }, { failClosed: true });
        if (!contestRes.created) return { ok: true as const, cost: 0, contest: contestRes.session, alreadyOpen: true };
        await kv.set(atkKey, { ...rec, warResources: rec.warResources - cost });
        return { ok: true as const, cost, contest: contestRes.session, alreadyOpen: false };
    }, { failClosed: true });

    if (!out.ok) return res.status(400).json({ error: `Declaring this sector war costs ${out.cost} War Resources.` });
    // Telemetry (best-effort): the WR actually spent declaring (0 when re-opening an
    // already-active contest, so no event). Never blocks the declare.
    if (out.cost > 0) void recordWarEcoEvent({ eventId: `declare:${id}`, village, kind: 'wr.spend.declare', amount: out.cost, meta: `sector:${sector}` });
    return res.status(200).json({ ok: true, cost: out.cost, alreadyOpen: out.alreadyOpen, contest: out.contest });
}

// ── attack (register a battle → mint the single-use token) ────────────────────
// Either warring side may register a battle they fought over the sector (so the
// defender's wins count for regen, §17.6). The token records the CONTEST's
// villages, so resolve maps the authoritative winner by village regardless of
// who registered — an attacker can't suppress the defender's regen by only
// reporting their own wins.
async function doAttack(req: VercelRequest, res: VercelResponse, identity: Identity, playerName: string, body: Record<string, unknown>) {
    const sector = Math.floor(Number(body.sector) || 0);
    const battleId = String(body.battleId ?? '').trim();
    if (!battleId) return res.status(400).json({ error: 'Missing battleId.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'sector-war-attack', 40, 60_000, identity.name))) return;

    const contest = await activeContestOnSector(sector);
    if (!contest) return res.status(409).json({ error: 'No active sector war on that sector.' });
    if (contest.winCondition !== 'combat') return res.status(409).json({ error: 'That sector is not a Combat contest.' });
    const { attackerVillage, defenderVillage } = contest;

    // The caller must be a member of one of the two warring villages.
    if (!identity.admin) {
        const callerVillage = await villageOf(playerName);
        if (callerVillage !== attackerVillage && callerVillage !== defenderVillage) {
            return res.status(403).json({ error: 'You are not a participant in this sector war.' });
        }
    }

    // The battle must be a real PvP session fought between a member of the
    // attacking village and a member of the defending village (the sanctioned
    // sector-attack). We seal the contest binding into the token; resolve trusts
    // only the authoritative session winner.
    const battle = await kv.get<ReadBattle>(`pvp:${battleId}`);
    if (!battle) return res.status(404).json({ error: 'Battle session not found or expired.' });
    const p1 = safeName(battle.p1?.name ?? '');
    const p2 = safeName(battle.p2?.name ?? '');
    if (!p1 || !p2) return res.status(409).json({ error: 'That battle is not a two-fighter PvP session.' });
    const [v1, v2] = await Promise.all([villageOf(p1), villageOf(p2)]);
    if (v1 === v2 || !(v1 === attackerVillage || v2 === attackerVillage) || !(v1 === defenderVillage || v2 === defenderVillage)) {
        return res.status(403).json({ error: 'That battle is not between the two villages at war over this sector.' });
    }

    await mintSectorWarToken(newSectorWarBattleToken({
        battleId,
        sectorWarId: contest.id,
        sector,
        attackerVillage,
        defenderVillage,
        registeredBy: playerName,
        winCondition: 'combat',
        now: Date.now(),
    }));
    return res.status(200).json({ ok: true, battleId, sectorWarId: contest.id });
}

// ── resolve (apply the authoritative outcome; flip on capture) ─────────────────
async function doResolve(req: VercelRequest, res: VercelResponse, identity: Identity, playerName: string, body: Record<string, unknown>) {
    const battleId = String(body.battleId ?? '').trim();
    if (!battleId) return res.status(400).json({ error: 'Missing battleId.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'sector-war-resolve', 40, 60_000, identity.name))) return;

    const token = await loadSectorWarToken(battleId);
    if (!token) return res.status(409).json({ error: 'No pending sector-war battle for that id (already resolved or expired).' });

    const battle = await kv.get<ReadBattle>(`pvp:${battleId}`);
    if (!battle || battle.status !== 'done' || !battle.winner || battle.winner === 'draw') {
        return res.status(409).json({ error: 'Battle is not finished, or it ended in a draw.' });
    }
    const winnerName = safeName(battle.winner === 'p1' ? (battle.p1?.name ?? '') : (battle.p2?.name ?? ''));
    const winnerVillage = winnerName ? await villageOf(winnerName) : '';
    const attackerWon = !!winnerVillage && winnerVillage === token.attackerVillage;

    const id = token.sectorWarId;
    const result = await withKvLock(sectorWarKey(id), async () => {
        // Re-check the token inside the lock so a battle is applied exactly once.
        if (!(await loadSectorWarToken(battleId))) return { ok: false as const, error: 'already-resolved' as const };
        const contest = await loadSectorWar(id);
        if (!contest || contest.flipped) {
            await consumeSectorWarToken(battleId);
            return { ok: false as const, error: 'contest-closed' as const };
        }
        const atkRecord = normalizeVillageWarRecord(token.attackerVillage, (await kv.get<Record<string, unknown>>(villageWarKey(token.attackerVillage))) ?? undefined);
        const damage = Math.round(SECTOR_CONTROL_HP_PER_WIN * sectorWarDamageMultiplier(atkRecord));
        const outcome = applySectorBattleResult(contest, attackerWon, { now: Date.now(), damage });
        if (outcome.captured) {
            // Flip the sector's persistent owner (territory lock, nested) BEFORE
            // closing the contest, so the capture + flip commit under one lock
            // scope. Re-running is idempotent (ownerVillage already set).
            await captureSectorForVillage(token.sector, token.attackerVillage, Date.now());
            await deleteSectorWar(id);
            // Telemetry (best-effort): a sector flipped to the attacker.
            void recordWarEcoEvent({ eventId: `capture:${id}`, village: token.attackerVillage, kind: 'sector.capture', amount: 1, meta: `sector:${token.sector}` });
        } else {
            await saveSectorWar(outcome.session);
        }
        await consumeSectorWarToken(battleId);
        return { ok: true as const, outcome };
    }, { failClosed: true });

    if (!result.ok) {
        return res.status(409).json({
            error: result.error === 'already-resolved' ? 'That battle was already resolved.' : 'The contest is no longer active.',
        });
    }
    return res.status(200).json({
        ok: true,
        attackerWon,
        captured: result.outcome.captured,
        controlHp: result.outcome.captured ? 0 : result.outcome.session.controlHp,
        controlHpMax: result.outcome.session.controlHpMax,
        hpDealt: result.outcome.hpDealt,
        hpRegen: result.outcome.hpRegen,
    });
}

// ── status (read-only) ─────────────────────────────────────────────────────────
async function doStatus(_req: VercelRequest, res: VercelResponse, body: Record<string, unknown>) {
    const sector = Math.floor(Number(body.sector) || 0);
    if (sector) {
        const [ownerVillage, contest] = await Promise.all([getSectorOwnerVillage(sector), activeContestOnSector(sector)]);
        return res.status(200).json({ ok: true, sector, ownerVillage, contest });
    }
    const contests = await listActiveSectorWars();
    return res.status(200).json({ ok: true, contests });
}

// ── seed (admin, Phase 4d) ─────────────────────────────────────────────────────
async function doSeed(res: VercelResponse, identity: Identity) {
    if (!identity.admin) return res.status(403).json({ error: 'Admin only.' });
    const seeded = await seedHomeSectorOwnership(Date.now());
    return res.status(200).json({ ok: true, ...seeded });
}
