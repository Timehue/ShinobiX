import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { LockContendedError, withKvLock } from '../_lock.js';
import { isWarVillage } from '../_war-map-sectors.js';
import { heldSectorsForVillage } from '../_war-held-sectors.js';
import {
    MERC_HIRE_RECEIPTS_MAX,
    mercContextKey,
    normalizeVillageWarRecord,
    villageWarKey,
    villageWarSlug,
    type MercHireReceipt,
    type MercLease,
    type MercLeaseContext,
    type VillageWarRecord,
} from '../_war-state.js';
import { wrMercTierById, WR_MERC_TIERS, mercBandSize } from '../_war-economy.js';
import { mercBandKey, mercHireAllowance, mercHireCost, mercHireId, newBoundBand, pruneMercHires, type MercHireAllowance } from '../_war-merc.js';
import { recordWarEcoEvent } from '../_war-telemetry.js';
import { activeContestOnSector, listActiveSectorWars, loadSectorWar } from '../_sector-war-store.js';
import { isSectorWarActive, sectorWarInstanceTag, type SectorWarSession } from '../_sector-war.js';
import { deployOneMerc } from '../_merc-auto.js';
import {
    combatContestLive,
    listVillageWarInstances,
    sectorContestContext,
    villageWarActing,
    villageWarContext,
    villageWarFor,
    type VillageWarInstance,
} from '../_merc-context.js';
import { readVillageElders } from './_elders.js';
import { villageWarMapEnabled } from '../_release-flags.js';

/*
 * /api/village/war-merc — POST only. War Map mercenaries (§17.5 "B"; owner
 * redesign 2026-10-08).
 *
 * A band is hired FOR one war and acts only there, only while that war is live
 * (api/_merc-context.ts):
 *   - all-out village war: the village at war hires for that war. Allowance per
 *     war instance: the Kage seat 3 hires, each Elder seat 1.
 *   - Combat sector war: ONLY the DEFENDING village hires, for that contest —
 *     the Kage or any current Elder, 3 hires per contest in all. The attacking
 *     village can no longer hire.
 *
 * Actions (body.action):
 *   - hire   : a Kage/Elder spends village WR (tier × comeback × Barracks,
 *              recomputed here from the sealed table, never a client figure) for
 *              a band bound to the named war (`context`: 'village' | 'sector' +
 *              `contestId`). The WR is debited once, under the village record's
 *              fail-closed lock, together with the band and its hire receipt.
 *              `requestId` (one per click) makes it idempotent: a retry after a
 *              lost response replays the first answer and charges nothing.
 *   - attack : a Kage/Elder of the DEFENDING village sends one merc of a band
 *              hired for a live Combat contest at any ATTACKING-village player,
 *              wherever they are (owner ruling). Resolved server-side.
 *   - list   : read-only — the WR pool, the tier menu with the cost the server
 *              will actually charge, the wars this village can hire for (with
 *              the allowance left), and its bands.
 *
 * Server-gated by the default-on Sector Map campaign switch.
 */

type Identity = NonNullable<Awaited<ReturnType<typeof authedPlayerOrAdmin>>>;
type Leadership = { member: boolean; seats: string[]; role: 'kage' | 'elder' | 'none' };

// Kage seat key — spaces→dashes, matching api/village/kage.ts + war-terrain.ts.
function kageKey(village: string): string {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}

/** The caller's leadership seats in `village`, read from the authoritative rows
 *  (the seated-Kage row and the Elder council) and cross-checked against the
 *  caller's own save — the same resolution api/village/war-terrain.ts uses. An
 *  admin acts as the Kage. */
async function leadershipOf(village: string, playerName: string, admin: boolean): Promise<Leadership> {
    if (admin) return { member: true, seats: ['kage'], role: 'kage' };
    const [kageState, elderSeats, save] = await Promise.all([
        kv.get<{ seatedKage?: string }>(kageKey(village)),
        readVillageElders(village),
        kv.get<{ character?: { village?: string } }>(`save:${playerName}`),
    ]);
    if (String(save?.character?.village ?? '').trim() !== village) return { member: false, seats: [], role: 'none' };
    const seats: string[] = [];
    if (safeName(String(kageState?.seatedKage ?? '')) === playerName) seats.push('kage');
    elderSeats.forEach((name, index) => {
        if (name && safeName(name) === playerName) seats.push(`elder-${index + 1}`);
    });
    return { member: true, seats, role: seats.includes('kage') ? 'kage' : seats.length ? 'elder' : 'none' };
}

async function villageOf(playerName: string): Promise<string> {
    const save = await kv.get<{ character?: { village?: string } }>(`save:${playerName}`);
    return String(save?.character?.village ?? '').trim();
}

async function readRecord(village: string): Promise<VillageWarRecord> {
    return normalizeVillageWarRecord(village, (await kv.get<Record<string, unknown>>(villageWarKey(village))) ?? undefined);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (!villageWarMapEnabled()) return res.status(404).json({ error: 'Not found.' });

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
            case 'hire': return await doHire(req, res, identity, playerName, body);
            case 'attack': return await doMercAttack(req, res, identity, playerName, body);
            case 'list': return await doList(res, identity, playerName, body);
            default: return res.status(400).json({ error: 'Unknown action.' });
        }
    } catch (err) {
        // A busy village record: nothing was written. A hire retried with the
        // same request id is safe either way.
        if (err instanceof LockContendedError) return res.status(503).json({ error: 'The war chest is busy. Try again.' });
        console.error('[village/war-merc]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

// ── hire (debit WR from the village pool, add a band bound to one war) ─────────

type HireContext = { context: MercLeaseContext; endsAt: number };

/** The war a hire is FOR, checked live. */
async function resolveHireContext(
    village: string,
    body: Record<string, unknown>,
    now: number,
): Promise<{ ok: true; value: HireContext } | { ok: false; status: number; error: string }> {
    const kind = String(body.context ?? '');
    if (kind === 'village') {
        const war = villageWarFor(await listVillageWarInstances(now), village);
        if (!war) return { ok: false, status: 409, error: 'Your village is not in an active village war.' };
        return { ok: true, value: { context: villageWarContext(war), endsAt: war.endsAt } };
    }
    if (kind === 'sector') {
        const contestId = String(body.contestId ?? '').trim();
        const sector = Math.floor(Number(body.sector) || 0);
        const contest = contestId ? await loadSectorWar(contestId) : sector > 0 ? await activeContestOnSector(sector, now) : null;
        if (!contest || !isSectorWarActive(contest, now)) return { ok: false, status: 409, error: 'That sector war is not active.' };
        if (contest.winCondition !== 'combat') return { ok: false, status: 409, error: 'Mercenaries fight only in Combat sector wars.' };
        if (contest.attackerVillage === village) {
            return { ok: false, status: 403, error: 'Attacking villages can no longer hire mercenaries. Only the village defending a Combat sector war may.' };
        }
        if (contest.defenderVillage !== village) return { ok: false, status: 403, error: 'Your village is not defending that sector.' };
        return { ok: true, value: { context: sectorContestContext(contest), endsAt: contest.endsAt } };
    }
    return { ok: false, status: 400, error: 'Choose the war this band is for.' };
}

function findHire(record: VillageWarRecord, hireId: string): MercHireReceipt | null {
    return (record.mercHires ?? []).find((h) => h.id === hireId) ?? null;
}

function hireBody(receipt: MercHireReceipt, replayed: boolean, hiresLeft?: number) {
    return {
        ok: true,
        replayed,
        hireId: receipt.id,
        tierId: receipt.tierId,
        cost: receipt.cost,
        expiresAt: receipt.expiresAt,
        band: mercBandSize(receipt.tierId),
        context: receipt.context,
        ...(hiresLeft !== undefined ? { hiresLeft } : {}),
    };
}

function replayHire(res: VercelResponse, receipt: MercHireReceipt, playerName: string) {
    if (receipt.player !== playerName) return res.status(409).json({ error: 'That request id belongs to another hire.' });
    return res.status(200).json(hireBody(receipt, true));
}

function allowanceRefusal(context: MercLeaseContext, allowance: MercHireAllowance): string {
    return context.kind === 'sector'
        ? `This sector war already has its ${allowance.limit} mercenary hires.`
        : 'Your seat has used its mercenary hires for this war (the Kage seat hires 3 bands, each Elder seat 1).';
}

async function doHire(req: VercelRequest, res: VercelResponse, identity: Identity, playerName: string, body: Record<string, unknown>) {
    const village = typeof body.village === 'string' ? body.village.trim() : '';
    const tierId = String(body.tierId ?? '');
    if (!isWarVillage(village)) return res.status(400).json({ error: 'Not a war village.' });
    if (!wrMercTierById(tierId)) return res.status(400).json({ error: 'Unknown mercenary tier.' });
    const hireId = mercHireId(body.requestId);
    if (!hireId) return res.status(400).json({ error: 'This hire has no request id. Refresh the War Map and try again.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'war-merc-hire', 20, 60_000, identity.name))) return;

    // A retried click replays its first answer BEFORE anything that may have
    // changed since is re-checked — the war may even be over by now.
    const prior = findHire(await readRecord(village), hireId);
    if (prior) return replayHire(res, prior, playerName);

    const leader = await leadershipOf(village, playerName, identity.admin);
    if (!leader.member) return res.status(403).json({ error: 'You must belong to this village.' });
    if (!leader.seats.length) return res.status(403).json({ error: 'Only the seated Kage or a current Elder can hire mercenaries.' });

    const now = Date.now();
    const resolved = await resolveHireContext(village, body, now);
    if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.error });
    const { context, endsAt } = resolved.value;
    // Live held count from the authoritative territory rows, so a village pushed
    // off the map actually gets the comeback discount on mercenaries.
    const sectorsHeld = await heldSectorsForVillage(village);

    const key = villageWarKey(village);
    const out = await withKvLock(key, async () => {
        const record = normalizeVillageWarRecord(village, (await kv.get<Record<string, unknown>>(key)) ?? undefined);
        const replayed = findHire(record, hireId);
        if (replayed) return { kind: 'replay' as const, receipt: replayed };
        const hires = pruneMercHires(record.mercHires ?? [], now);
        const allowance = mercHireAllowance(hires, context, leader.seats);
        if (!allowance.seat) return { kind: 'limit' as const, allowance };
        // Fail closed rather than evict a live war's receipt (its allowance).
        if (hires.length >= MERC_HIRE_RECEIPTS_MAX) return { kind: 'full' as const };
        const cost = mercHireCost(tierId, sectorsHeld, record);
        if (record.warResources < cost) return { kind: 'poor' as const, cost };
        const { lease, receipt } = newBoundBand({ id: hireId, tierId, player: playerName, seat: allowance.seat, context, contextEndsAt: endsAt, cost, now });
        await kv.set(key, {
            ...record,
            warResources: record.warResources - cost,
            mercLeases: [...record.mercLeases, lease],
            mercHires: [...hires, receipt],
        });
        return { kind: 'hired' as const, receipt, hiresLeft: Math.max(0, allowance.callerLeft - 1) };
    }, { failClosed: true });

    if (out.kind === 'replay') return replayHire(res, out.receipt, playerName);
    if (out.kind === 'limit') return res.status(409).json({ error: allowanceRefusal(context, out.allowance) });
    if (out.kind === 'full') return res.status(409).json({ error: 'Too many mercenary contracts are on the books. Try again once a war ends.' });
    if (out.kind === 'poor') return res.status(402).json({ error: `Hiring this mercenary costs ${out.cost} War Resources.` });
    // Telemetry (best-effort): WR spent on the hire (0 = a free comeback hire → no event).
    if (out.receipt.cost > 0) {
        void recordWarEcoEvent({ eventId: `merc:${villageWarSlug(village)}:${hireId}`, village, kind: 'wr.spend.merc', amount: out.receipt.cost, meta: tierId });
    }
    return res.status(200).json(hireBody(out.receipt, false, out.hiresLeft));
}

// ── list (read-only menu, contexts, allowances, bands) ─────────────────────────

interface MercContextView {
    kind: 'village' | 'sector';
    key: string;
    enemy: string;
    /** The contest's end, or the village war's 14-day lifetime bound. */
    endsAt: number;
    /** Village war in its pre-war window: when its bands start acting. */
    startsAt?: number;
    contestId?: string;
    sector?: number;
    /** Bands of this war act right now. */
    acting: boolean;
    hiresUsed: number;
    hiresLimit: number;
    callerHiresLeft: number;
    seats?: Array<{ seat: string; used: number; limit: number }>;
}

function villageWarView(war: VillageWarInstance, village: string, hires: readonly MercHireReceipt[], seats: readonly string[], now: number): MercContextView {
    const context = villageWarContext(war);
    const allowance = mercHireAllowance(hires, context, seats);
    return {
        kind: 'village',
        key: mercContextKey(context),
        enemy: war.villages.find((v) => v !== village) ?? '',
        endsAt: war.endsAt,
        ...(war.pending && war.pendingUntil > now ? { startsAt: war.pendingUntil } : {}),
        acting: villageWarActing(war),
        hiresUsed: allowance.used,
        hiresLimit: allowance.limit,
        callerHiresLeft: allowance.callerLeft,
        ...(allowance.seats ? { seats: allowance.seats } : {}),
    };
}

function sectorView(contest: SectorWarSession, hires: readonly MercHireReceipt[], seats: readonly string[]): MercContextView {
    const context = sectorContestContext(contest);
    const allowance = mercHireAllowance(hires, context, seats);
    return {
        kind: 'sector',
        key: mercContextKey(context),
        enemy: contest.attackerVillage,
        endsAt: contest.endsAt,
        contestId: contest.id,
        sector: contest.sector,
        acting: true,
        hiresUsed: allowance.used,
        hiresLimit: allowance.limit,
        callerHiresLeft: allowance.callerLeft,
    };
}

async function doList(res: VercelResponse, identity: Identity, playerName: string, body: Record<string, unknown>) {
    const village = typeof body.village === 'string' ? body.village.trim() : '';
    if (!isWarVillage(village)) return res.status(400).json({ error: 'Not a war village.' });
    const leader = await leadershipOf(village, playerName, identity.admin);
    if (!leader.member) return res.status(403).json({ error: 'You must belong to this village.' });

    const now = Date.now();
    const [record, wars, contests, sectorsHeld] = await Promise.all([
        readRecord(village),
        listVillageWarInstances(now),
        listActiveSectorWars(now),
        heldSectorsForVillage(village),
    ]);
    const hires = pruneMercHires(record.mercHires ?? [], now);

    const contexts: MercContextView[] = [];
    const war = villageWarFor(wars, village);
    if (war) contexts.push(villageWarView(war, village, hires, leader.seats, now));
    for (const contest of contests) {
        if (combatContestLive(contest, now) && contest.defenderVillage === village) contexts.push(sectorView(contest, hires, leader.seats));
    }
    // Sieges this village runs: it can no longer hire for them (shown as a hint).
    const attacking = contests
        .filter((c) => combatContestLive(c, now) && c.attackerVillage === village)
        .map((c) => ({ contestId: c.id, sector: c.sector, enemy: c.defenderVillage, endsAt: c.endsAt }));

    const actingKeys = new Set(contexts.filter((c) => c.acting).map((c) => c.key));
    const legacyActing = !!war && villageWarActing(war);
    const leases = record.mercLeases
        .filter((l) => l.expiresAt > now)
        .map((l) => leaseView(l, actingKeys, legacyActing, leader.seats.length > 0));

    return res.status(200).json({
        ok: true,
        warResources: record.warResources,
        // `cost` is what the server charges right now (comeback × Barracks
        // applied); `costWr` stays the undiscounted base for older clients.
        tiers: WR_MERC_TIERS.map((t) => ({ ...t, cost: mercHireCost(t.id, sectorsHeld, record), band: mercBandSize(t.id) })),
        contexts,
        attacking,
        leases,
        viewer: { role: leader.role, seats: leader.seats, canHire: leader.seats.length > 0, canDeploy: leader.seats.length > 0 },
    });
}

function leaseView(lease: MercLease, actingKeys: ReadonlySet<string>, legacyActing: boolean, leader: boolean) {
    const contextKey = lease.context ? mercContextKey(lease.context) : null;
    const live = contextKey ? actingKeys.has(contextKey) : legacyActing;
    return {
        id: lease.id ?? null,
        tierId: lease.tierId,
        player: lease.player,
        expiresAt: lease.expiresAt,
        count: lease.count,
        contextKey,
        contextKind: lease.context?.kind ?? null,
        sector: lease.context?.kind === 'sector' ? lease.context.sector : null,
        legacy: !lease.context,
        live,
        // Only a defender's sector band can be SENT at a player; village-war
        // bands hunt on their own.
        deployable: leader && live && lease.count > 0 && lease.context?.kind === 'sector',
    };
}

// ── attack (send one merc of a defender's band at an attacking-village player) ─
// SERVER-AUTHORITATIVE: the merc-vs-player fight is run headless by the towers
// engine (resolveMercBattle), so the outcome can't be faked by either client.
// A band win scores the defence in full; an attacker who beats it scores a
// quarter; a stall is inert. Each deployment spends one merc of the band.
async function doMercAttack(req: VercelRequest, res: VercelResponse, identity: Identity, playerName: string, body: Record<string, unknown>) {
    const village = typeof body.village === 'string' ? body.village.trim() : '';
    const targetPlayer = safeName(String(body.targetPlayer ?? ''));
    const bandId = String(body.bandId ?? '').trim();
    if (!isWarVillage(village)) return res.status(400).json({ error: 'Not a war village.' });
    if (!targetPlayer) return res.status(400).json({ error: 'Missing target player.' });
    if (targetPlayer === playerName) return res.status(400).json({ error: 'You cannot send mercenaries at yourself.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'war-merc-attack', 40, 60_000, identity.name))) return;

    const leader = await leadershipOf(village, playerName, identity.admin);
    if (!leader.member || !leader.seats.length) {
        return res.status(403).json({ error: 'Only the seated Kage or a current Elder can send mercenaries.' });
    }

    const now = Date.now();
    const record = await readRecord(village);
    let lease: MercLease | null = bandId ? record.mercLeases.find((l) => l.id === bandId && !!l.context) ?? null : null;
    if (!lease && !bandId) {
        // An older client names (tier, sector): the band of that tier hired to
        // defend the contest on that sector.
        const contest = await activeContestOnSector(Math.floor(Number(body.sector) || 0), now);
        lease = contest
            ? record.mercLeases.find((l) => l.tierId === String(body.tierId ?? '') && l.count > 0 && l.expiresAt > now
                && l.context?.kind === 'sector' && l.context.contestId === contest.id) ?? null
            : null;
    }
    if (!lease || lease.expiresAt <= now || lease.count <= 0) {
        return res.status(409).json({ error: 'That band is spent or its contract has lapsed.' });
    }
    if (lease.context?.kind !== 'sector') {
        return res.status(409).json({ error: 'Village-war bands hunt on their own. Only a band defending a sector war can be sent at a player.' });
    }
    const band = lease.context;
    const contest = await loadSectorWar(band.contestId);
    if (!combatContestLive(contest, now) || sectorWarInstanceTag(contest) !== band.instance || contest.defenderVillage !== village) {
        return res.status(409).json({ error: 'The sector war this band was hired for is over.' });
    }
    // Any member of the attacking village, wherever they are (owner ruling).
    if ((await villageOf(targetPlayer)) !== contest.attackerVillage) {
        return res.status(403).json({ error: `That player is not in ${contest.attackerVillage}, the village attacking this sector.` });
    }
    const tier = wrMercTierById(lease.tierId);
    if (!tier) return res.status(409).json({ error: 'Unknown mercenary tier.' });

    // Deploy via the shared core (server-auth resolve + contest scoring), the
    // same path the autonomous tick and the roaming encounter use.
    const r = await deployOneMerc({
        village, tierId: lease.tierId, hirer: lease.player, bandKey: mercBandKey(lease),
        sector: contest.sector, targetPlayer, targetVillage: contest.attackerVillage,
        contestId: contest.id, instance: band.instance, mercLevel: tier.level, now,
    });
    if (!r) {
        return res.status(409).json({ error: 'No mercenary could be sent: the band is spent, the war just ended, or a mercenary fought that player in the last 15 minutes.' });
    }
    return res.status(200).json({ ok: true, winner: r.winner, attackerPoints: r.attackerPoints, defenderPoints: r.defenderPoints, mercsRemaining: r.mercsRemaining });
}
