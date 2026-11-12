/**
 * Cinderhold goes to war (Push 4, owner rulings 2026-11-10).
 *
 * Wars with Cinderhold start BOTH ways:
 *   - a player Kage declares a sector war on a Cinderhold-held sector through
 *     the normal declare (api/village/sector-war.ts; Cinderhold is a
 *     SECTOR_WAR_VILLAGE), and
 *   - Cinderhold itself PROPOSES one when its aggression toward a village
 *     reaches War-Ready. Nothing starts until an admin approves it (pre-launch
 *     manual control); the approval runs the same declare an admin would.
 *
 * A proposal is made by the daily pass only when ALL of these hold:
 *   - aggression toward the target is War-Ready (75+), highest first;
 *   - the target had at least NPC_WAR_MIN_ACTIVE_PLAYERS players active in the
 *     last 7 days (Cinderhold never bullies an empty village);
 *   - Cinderhold is not already attacking anyone and no proposal is pending;
 *   - NPC_WAR_COOLDOWN_MS has passed since its last declared war, and a day
 *     since the last rejection.
 * A proposal lapses after NPC_WAR_PROPOSAL_TTL_MS. A declared war cools that
 * village's aggression back to Watchful.
 *
 * Cinderhold pays for its own declarations: an approval tops its War Resources
 * up to exactly the declare cost first. Its pool has no faucet (the daily WR
 * pass walks WAR_VILLAGES only) and no player can ever spend it.
 */
import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { villageWarMapEnabled } from './_release-flags.js';
import { normalizeVillageWarRecord, sectorConfigFor, villageWarKey } from './_war-state.js';
import { SECTOR_WAR_VILLAGES, homeSectorsForVillage, isProtectedWarSector, isWarVillage } from './_war-map-sectors.js';
import { listActiveSectorWars } from './_sector-war-store.js';
import { readPublicPlayerIndex } from './player/_public-index-store.js';
import { isPublicPlayerIndexKey } from './player/_public-index.js';
import { NPC_AGGRESSION_KEY, aggressionBand, readNpcAggression, type NpcAggressionState } from './_npc-village-aggression.js';
import { NPC_HOME_SECTORS, NPC_VILLAGE, PLAYER_VILLAGES, npcReclaimsHomeSector, type PlayerVillage } from '../shared/npc-village.js';
import { isNpcAccount } from '../shared/npc-village-roster.js';
import { NPC_WAR_DEFENDERS } from './_npc-war-roster.js';
import { npcVillageClosed } from './_npc-village-switch.js';

export const NPC_WAR_PROPOSAL_KEY = 'npc-village:war-proposal';
export const NPC_WAR_HISTORY_KEY = 'npc-village:war-history';
const DAY_MS = 24 * 60 * 60 * 1000;
export const NPC_WAR_COOLDOWN_MS = 14 * DAY_MS;
export const NPC_WAR_REJECT_COOLDOWN_MS = DAY_MS;
export const NPC_WAR_PROPOSAL_TTL_MS = 48 * 60 * 60 * 1000;
export const NPC_WAR_MIN_ACTIVE_PLAYERS = 5;
export const NPC_WAR_ACTIVE_WINDOW_MS = 7 * DAY_MS;
/** Where a declared war leaves that village's meter: the floor of Watchful. */
export const NPC_WAR_AGGRESSION_AFTER_DECLARE = 25;

export type NpcWarProposal = { id: string; village: PlayerVillage; sector: number; aggression: number; createdAt: number; expiresAt: number };
export type NpcWarHistory = { lastDeclaredAt?: number; lastRejectedAt?: number; last?: { village: string; sector: number; at: number; contestId?: string; kind?: 'sector' | 'village'; warId?: string } };

export type NpcWarCandidateInput = {
    aggression: Pick<NpcAggressionState, 'byVillage'>;
    activePlayers: Partial<Record<string, number>>;
    /** Current holder of every war sector (from world:territory). */
    owners: Record<number, string>;
    contestedSectors: ReadonlySet<number>;
    villagesAtWar: ReadonlySet<string>;
    /** The holder's win-condition per sector. Cinderhold presses Combat wars only, so only those are targets, except its own home land (always fought in Combat when it retakes it). */
    winConditions: Record<number, string>;
};

/**
 * Pure: the village and sector Cinderhold would march on, or why not. Hottest
 * village first. Its sector: one Cinderhold lost first (taking its own land
 * back), then the target's home sectors in order, gate excluded (a gate is
 * never conquerable), and only one its holder fights in Combat (the war party
 * presses Combat wars; api/_npc-war-party.ts). Its own home sectors are the
 * exception (owner ruling 2026-11-11): one a player holds is a target whatever
 * its setting, because that war is declared in Combat (npcReclaimsHomeSector).
 */
export function chooseNpcWarTarget(input: NpcWarCandidateInput): { village: PlayerVillage; sector: number; aggression: number } | { reason: 'none-war-ready' | 'too-few-active' | 'no-open-sector' } {
    const ready = PLAYER_VILLAGES
        .map((village) => ({ village, value: input.aggression.byVillage[village] ?? 0 }))
        .filter((row) => aggressionBand(row.value) === 'war-ready')
        .sort((a, b) => b.value - a.value || a.village.localeCompare(b.village));
    if (!ready.length) return { reason: 'none-war-ready' };
    let sawActive = false;
    for (const { village, value } of ready) {
        if ((input.activePlayers[village] ?? 0) < NPC_WAR_MIN_ACTIVE_PLAYERS) continue;
        sawActive = true;
        if (input.villagesAtWar.has(village)) continue;
        const order = [...NPC_HOME_SECTORS, ...homeSectorsForVillage(village),
            ...Object.keys(input.owners).map(Number).sort((a, b) => a - b)];
        // Its own home land is retaken whatever the holder set: that war is
        // fought in Combat (shared/npc-village.ts npcReclaimsHomeSector).
        const sector = order.find((s) => input.owners[s] === village && !isProtectedWarSector(s)
            && !input.contestedSectors.has(s) && (input.winConditions[s] === 'combat' || npcReclaimsHomeSector(NPC_VILLAGE, s)));
        if (sector) return { village, sector, aggression: value };
    }
    return { reason: sawActive ? 'no-open-sector' : 'too-few-active' };
}

/** Players per village seen in the last 7 days (NPCs never count). */
export async function activePlayersByVillage(now: number): Promise<Record<string, number>> {
    const { entries } = await readPublicPlayerIndex({ logContext: 'npc-village-war' });
    const counts: Record<string, number> = {};
    for (const [key, entry] of entries) {
        if (!isPublicPlayerIndexKey(key) || isNpcAccount(key)) continue;
        if (!(now - Number(entry.lastSeen ?? 0) <= NPC_WAR_ACTIVE_WINDOW_MS)) continue;
        const village = String(entry.village ?? '').trim();
        if (village) counts[village] = (counts[village] ?? 0) + 1;
    }
    return counts;
}

/** Every war sector's holder, read from the territory rows. */
async function warSectorOwners(): Promise<Record<number, string>> {
    const sectors = SECTOR_WAR_VILLAGES.flatMap((v) => [...homeSectorsForVillage(v)]);
    const rows = await kv.mget<Array<{ ownerVillage?: string } | null>>(...sectors.map((s) => `world:territory:${s}`));
    const owners: Record<number, string> = {};
    sectors.forEach((s, i) => { const o = String(rows[i]?.ownerVillage ?? '').trim(); if (o) owners[s] = o; });
    return owners;
}

/** Each held sector's win-condition, from its holder's war record (the holder sets it). */
async function winConditionsOf(owners: Record<number, string>): Promise<Record<number, string>> {
    const holders = [...new Set(Object.values(owners))];
    const raws = await kv.mget<Array<Record<string, unknown> | null>>(...holders.map((v) => villageWarKey(v)));
    const records = new Map(holders.map((v, i) => [v, normalizeVillageWarRecord(v, raws[i] ?? undefined)]));
    const out: Record<number, string> = {};
    for (const [key, holder] of Object.entries(owners)) {
        const record = records.get(holder);
        if (record) out[Number(key)] = sectorConfigFor(record, Number(key)).winCondition;
    }
    return out;
}

export async function readNpcWarProposal(now = Date.now()): Promise<NpcWarProposal | null> {
    const row = await kv.get<NpcWarProposal>(NPC_WAR_PROPOSAL_KEY);
    return row?.id && Number(row.expiresAt) > now ? row : null;
}

export async function readNpcWarHistory(): Promise<NpcWarHistory> {
    return (await kv.get<NpcWarHistory>(NPC_WAR_HISTORY_KEY)) ?? {};
}

export type ProposeResult = { proposal: NpcWarProposal } | { skipped: string };

/** Daily-pass step: write a proposal when every rule above allows one. */
export async function proposeNpcWar(now = Date.now()): Promise<ProposeResult> {
    // Closed (the kill switch, or no session tokens): it could not fight the war it proposed.
    if (npcVillageClosed()) return { skipped: 'disabled' };
    if (!villageWarMapEnabled()) return { skipped: 'war-map-off' };
    return withKvLock(NPC_WAR_PROPOSAL_KEY, async () => {
        if (await readNpcWarProposal(now)) return { skipped: 'pending' };
        const history = await readNpcWarHistory();
        if (now - (history.lastDeclaredAt ?? -Infinity) < NPC_WAR_COOLDOWN_MS) return { skipped: 'cooldown' };
        if (now - (history.lastRejectedAt ?? -Infinity) < NPC_WAR_REJECT_COOLDOWN_MS) return { skipped: 'rejected-recently' };
        const contests = await listActiveSectorWars(now, { strict: true });
        if (contests.some((c) => c.attackerVillage === NPC_VILLAGE)) return { skipped: 'already-attacking' };
        const { villageHasActiveWar } = await import('./world-state.js');
        const atWar = new Set<string>();
        for (const village of PLAYER_VILLAGES) if (await villageHasActiveWar(village)) atWar.add(village);
        const owners = await warSectorOwners();
        const choice = chooseNpcWarTarget({
            aggression: await readNpcAggression(now),
            activePlayers: await activePlayersByVillage(now),
            owners,
            contestedSectors: new Set(contests.map((c) => c.sector)),
            villagesAtWar: atWar,
            winConditions: await winConditionsOf(owners),
        });
        if ('reason' in choice) return { skipped: choice.reason };
        const proposal: NpcWarProposal = {
            id: `npc-war-${now.toString(36)}`, village: choice.village, sector: choice.sector,
            aggression: choice.aggression, createdAt: now, expiresAt: now + NPC_WAR_PROPOSAL_TTL_MS,
        };
        await kv.set(NPC_WAR_PROPOSAL_KEY, proposal, { ex: Math.ceil(NPC_WAR_PROPOSAL_TTL_MS / 1000) });
        return { proposal };
    }, { failClosed: true });
}

/** An admin's "no": the proposal goes, and Cinderhold waits a day before proposing again. */
export async function rejectNpcWar(proposalId: string, now = Date.now()): Promise<boolean> {
    return withKvLock(NPC_WAR_PROPOSAL_KEY, async () => {
        const proposal = await readNpcWarProposal(now);
        if (!proposal || proposal.id !== proposalId) return false;
        await kv.del(NPC_WAR_PROPOSAL_KEY);
        await kv.set(NPC_WAR_HISTORY_KEY, { ...(await readNpcWarHistory()), lastRejectedAt: now });
        return true;
    }, { failClosed: true });
}

/** Tops Cinderhold's War Resources up to `cost` (never down), under the pool's own lock. */
export async function fundNpcDeclaration(cost: number): Promise<void> {
    const key = villageWarKey(NPC_VILLAGE);
    await withKvLock(key, async () => {
        const raw = await kv.get<Record<string, unknown>>(key);
        const record = normalizeVillageWarRecord(NPC_VILLAGE, raw ?? undefined);
        if (record.warResources >= cost) return;
        await kv.set(key, { ...(raw ?? {}), ...record, warResources: Math.ceil(cost) });
    }, { failClosed: true });
}

/** Cools one village's meter to Watchful after the war it earned was declared. */
async function coolAggression(village: string): Promise<void> {
    await withKvLock(NPC_AGGRESSION_KEY, async () => {
        const state = await readNpcAggression();
        const current = state.byVillage[village as PlayerVillage] ?? 0;
        if (current <= NPC_WAR_AGGRESSION_AFTER_DECLARE) return;
        await kv.set(NPC_AGGRESSION_KEY, { ...state, byVillage: { ...state.byVillage, [village]: NPC_WAR_AGGRESSION_AFTER_DECLARE } });
    }, { failClosed: true });
}

type Reply = { status: number; body: Record<string, unknown> };
type Handler = (req: unknown, res: unknown) => unknown;
function routeHandler(mod: unknown): Handler {
    const first = (mod as { default?: unknown }).default;
    const fn = typeof first === 'function' ? first : (first as { default?: unknown } | undefined)?.default;
    if (typeof fn !== 'function') throw new Error('npc-village-war: route handler not found');
    return fn as Handler;
}

/** Runs the real sector-war declare in-process with the approving admin's own credentials. */
async function declareAsAdmin(adminHeaders: Record<string, string>, remoteAddress: string, sector: number): Promise<Reply> {
    const handler = routeHandler(await import('./village/sector-war.js'));
    const out: Reply = { status: 200, body: {} };
    const res = {
        statusCode: 200, headersSent: false,
        setHeader() { return res; }, getHeader() { return undefined; },
        status(code: number) { out.status = code; res.statusCode = code; return res; },
        json(value: unknown) { out.body = (value ?? {}) as Record<string, unknown>; res.headersSent = true; return res; },
        send(value: unknown) { out.body = { value }; res.headersSent = true; return res; },
        end() { res.headersSent = true; return res; },
    };
    await handler({
        method: 'POST', url: '/api/village/sector-war', query: {},
        // The route needs a playerName; as an admin it acts as no one, so name
        // Cinderhold's senior Commander for the record.
        body: { action: 'declare', village: NPC_VILLAGE, sector, playerName: NPC_WAR_DEFENDERS[0]?.id ?? 'cinderhold' },
        headers: { 'content-type': 'application/json', ...adminHeaders },
        socket: { remoteAddress },
    }, res);
    return out;
}

export type ApproveResult = { ok: true; kind: NpcWarKind; contestId?: string; warId?: string; cost?: number } | { ok: false; status: number; error: string };
/** What the admin approves a proposal as (Push 4b): a sector war on its sector, or a five-day village war on its village. */
export type NpcWarKind = 'sector' | 'village';

/**
 * Runs the real world-state village-war declare in-process as Cinderhold's
 * senior war commander, with its own server-minted token and the server-only
 * declaration mark (api/_npc-war-authority.ts) the Kage gate accepts for
 * Cinderhold alone. Every other rule of the declare (cooldown, funding,
 * reservations, the sector-war exclusion) runs unchanged.
 */
async function declareVillageWarAsCinderhold(target: string): Promise<Reply> {
    const commander = NPC_WAR_DEFENDERS[0];
    if (!commander) return { status: 503, body: { error: 'Cinderhold has no war commander.' } };
    const { npcOwnsSlugFresh } = await import('./_npc-ownership.js');
    if (!(await npcOwnsSlugFresh(commander.id))) return { status: 409, body: { error: `The account ${commander.id} belongs to a player, so it cannot declare for Cinderhold.` } };
    const { issuePlayerToken, readPlayerSessionEpoch } = await import('./_auth.js');
    const token = issuePlayerToken(commander.id, 5 * 60_000, await readPlayerSessionEpoch(commander.id));
    if (!token) return { status: 503, body: { error: 'Session tokens are off on this server (SESSION_SECRET unset), so Cinderhold cannot declare.' } };
    const { markNpcVillageWarDeclaration } = await import('./_npc-war-authority.js');
    const handler = routeHandler(await import('./world-state.js'));
    const out: Reply = { status: 200, body: {} };
    const res = {
        statusCode: 200, headersSent: false,
        setHeader() { return res; }, getHeader() { return undefined; },
        status(code: number) { out.status = code; res.statusCode = code; return res; },
        json(value: unknown) { out.body = (value ?? {}) as Record<string, unknown>; res.headersSent = true; return res; },
        send(value: unknown) { out.body = { value }; res.headersSent = true; return res; },
        end() { res.headersSent = true; return res; },
    };
    await handler(markNpcVillageWarDeclaration({
        method: 'POST', url: '/api/world-state', query: {},
        body: { kind: 'war', war: { villages: [NPC_VILLAGE, target], startedAt: Date.now() } },
        headers: { 'content-type': 'application/json', 'x-player-token': token, 'x-player-name': commander.name },
        socket: { remoteAddress: '127.0.0.1' },
    }), res);
    return out;
}

/**
 * An admin's "yes": fund, declare through the normal path, then record it.
 * The proposal is consumed only by a declaration that landed, so a refused one
 * (the sector changed hands, a war opened meanwhile) can be retried or rejected.
 * `kind` (Push 4b) is the admin's choice at approval: the proposal's sector
 * war, or a five-day village war on the proposal's village.
 */
export async function approveNpcWar(proposalId: string, admin: { headers: Record<string, string>; remoteAddress: string }, now = Date.now(), kind: NpcWarKind = 'sector'): Promise<ApproveResult> {
    if (process.env.DISABLE_NPC_VILLAGE === '1') return { ok: false, status: 503, error: 'Cinderhold is switched off on this server (DISABLE_NPC_VILLAGE).' };
    if (npcVillageClosed()) return { ok: false, status: 503, error: 'Session tokens are off on this server (SESSION_SECRET unset), so Cinderhold could not fight a war.' };
    if (kind === 'village') return approveNpcVillageWar(proposalId, now);
    if (!villageWarMapEnabled()) return { ok: false, status: 503, error: 'Sector wars are switched off on this server (DISABLE_VILLAGE_WAR).' };
    const proposal = await readNpcWarProposal(now);
    if (!proposal || proposal.id !== proposalId) return { ok: false, status: 409, error: 'That proposal is no longer pending.' };
    if (!isWarVillage(proposal.village)) return { ok: false, status: 409, error: 'That proposal names no player village.' };
    // Fund only a declaration that can still land: the sector may have changed
    // hands since the proposal was made. (The declare re-checks everything.)
    const holder = String((await kv.get<{ ownerVillage?: string }>(`world:territory:${proposal.sector}`))?.ownerVillage ?? '').trim();
    if (holder !== proposal.village) return { ok: false, status: 409, error: `Sector ${proposal.sector} is no longer held by ${proposal.village}. Reject this proposal.` };
    const { discountedWrCost, SECTOR_WAR_WR } = await import('./_war-economy.js');
    const { heldSectorsForVillage } = await import('./_war-held-sectors.js');
    // The real charge (no intel discount: Cinderhold gathers none) at its live
    // held count, so the declare below can never fail for want of WR.
    await fundNpcDeclaration(discountedWrCost(SECTOR_WAR_WR, await heldSectorsForVillage(NPC_VILLAGE)));
    const reply = await declareAsAdmin(admin.headers, admin.remoteAddress, proposal.sector);
    if (reply.status !== 200) return { ok: false, status: reply.status, error: String(reply.body.error ?? 'The declaration was refused.') };
    const contestId = typeof (reply.body.contest as { id?: unknown } | undefined)?.id === 'string'
        ? (reply.body.contest as { id: string }).id
        : typeof reply.body.sectorWarId === 'string' ? reply.body.sectorWarId : undefined;
    await withKvLock(NPC_WAR_PROPOSAL_KEY, async () => {
        const current = await kv.get<NpcWarProposal>(NPC_WAR_PROPOSAL_KEY);
        if (current?.id === proposal.id) await kv.del(NPC_WAR_PROPOSAL_KEY);
        await kv.set(NPC_WAR_HISTORY_KEY, { ...(await readNpcWarHistory()), lastDeclaredAt: now, last: { village: proposal.village, sector: proposal.sector, at: now, ...(contestId ? { contestId } : {}) } });
    }, { failClosed: true });
    await coolAggression(proposal.village).catch(() => undefined);
    return { ok: true, kind: 'sector', ...(contestId ? { contestId } : {}), ...(typeof reply.body.cost === 'number' ? { cost: reply.body.cost } : {}) };
}

/**
 * The village-war approval. Its own precondition first (neither side already
 * in a village war, neither fighting a sector war; the declare re-checks all
 * of it under its reservations), then Cinderhold's War Resources are topped up
 * to exactly the declare's price, and the real declare runs.
 */
async function approveNpcVillageWar(proposalId: string, now: number): Promise<ApproveResult> {
    if (!villageWarMapEnabled()) return { ok: false, status: 503, error: 'The war map is switched off on this server (DISABLE_VILLAGE_WAR), so Cinderhold has no War Resources to declare with.' };
    const proposal = await readNpcWarProposal(now);
    if (!proposal || proposal.id !== proposalId) return { ok: false, status: 409, error: 'That proposal is no longer pending.' };
    if (!isWarVillage(proposal.village)) return { ok: false, status: 409, error: 'That proposal names no player village.' };
    const { villageHasActiveWar } = await import('./world-state.js');
    const { activeSectorWarsForVillage } = await import('./_sector-war-store.js');
    for (const village of [NPC_VILLAGE, proposal.village]) {
        if (await villageHasActiveWar(village)) return { ok: false, status: 409, error: `${village} is already in a village war.` };
        if ((await activeSectorWarsForVillage(village, now, { strict: true })).length) {
            return { ok: false, status: 409, error: `${village} is fighting a sector war. A village war waits until its sector wars end.` };
        }
    }
    const { discountedWrCost, DECLARE_WAR_WR } = await import('./_war-economy.js');
    const { heldSectorsForVillage } = await import('./_war-held-sectors.js');
    // The declare's own price (no discount Cinderhold has not earned) at its
    // live held count, so it can never fail for want of WR.
    await fundNpcDeclaration(discountedWrCost(DECLARE_WAR_WR, await heldSectorsForVillage(NPC_VILLAGE)));
    const reply = await declareVillageWarAsCinderhold(proposal.village);
    if (reply.status !== 200) return { ok: false, status: reply.status, error: String(reply.body.error ?? 'The declaration was refused.') };
    const warId = typeof (reply.body.war as { id?: unknown } | undefined)?.id === 'string' ? (reply.body.war as { id: string }).id : undefined;
    await withKvLock(NPC_WAR_PROPOSAL_KEY, async () => {
        const current = await kv.get<NpcWarProposal>(NPC_WAR_PROPOSAL_KEY);
        if (current?.id === proposal.id) await kv.del(NPC_WAR_PROPOSAL_KEY);
        await kv.set(NPC_WAR_HISTORY_KEY, { ...(await readNpcWarHistory()), lastDeclaredAt: now, last: { village: proposal.village, sector: proposal.sector, at: now, kind: 'village', ...(warId ? { warId } : {}) } });
    }, { failClosed: true });
    await coolAggression(proposal.village).catch(() => undefined);
    return { ok: true, kind: 'village', ...(warId ? { warId } : {}) };
}

/**
 * The sectors where Cinderhold is fighting a Combat sector war right now, for
 * the presence tick to post NPCs to. Cached for a minute: the tick runs every
 * 20 s and a war's sector never changes mid-war.
 */
let frontsCache: { at: number; sectors: number[] } | null = null;
export async function npcWarFronts(now = Date.now()): Promise<number[]> {
    if (frontsCache && now - frontsCache.at < 60_000) return frontsCache.sectors;
    let sectors: number[] = [];
    try {
        if (villageWarMapEnabled()) {
            sectors = (await listActiveSectorWars(now))
                .filter((c) => c.winCondition === 'combat' && (c.attackerVillage === NPC_VILLAGE || c.defenderVillage === NPC_VILLAGE))
                .map((c) => c.sector)
                .sort((a, b) => a - b);
        }
    } catch { sectors = frontsCache?.sectors ?? []; }
    frontsCache = { at: now, sectors };
    return sectors;
}
export function resetNpcWarFrontsCacheForTest(): void { frontsCache = null; }

/** Seeds Cinderhold's eight territory rows to Cinderhold (idempotent; an owned row is left alone). */
export async function seedNpcVillageTerritory(now = Date.now()): Promise<{ seeded: number; sectors: number[] }> {
    const { seedHomeSectorOwnership } = await import('./world-state.js');
    return seedHomeSectorOwnership(now, [NPC_VILLAGE]);
}
