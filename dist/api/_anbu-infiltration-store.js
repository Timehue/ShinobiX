"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.START_COUNT_TTL = exports.ANBU_LAST_DEF_TTL = exports.ANBU_SEAL_TTL = exports.INFIL_LEDGER_TTL = exports.INFIL_PAID_TTL = exports.INFIL_RUN_TTL = exports.anbuLastDefKey = exports.anbuSealKey = exports.wrLedgerKey = exports.supplyLedgerKey = exports.infilPaidKey = exports.infilStartCountKey = exports.infilRunKey = void 0;
exports.villageStateKey = villageStateKey;
exports.villageSlug = villageSlug;
exports.readInfilRun = readInfilRun;
exports.writeInfilRun = writeInfilRun;
exports.deleteInfilRun = deleteInfilRun;
exports.bumpInfilStartCount = bumpInfilStartCount;
exports.loadAnbuAppointees = loadAnbuAppointees;
exports.pickAnbuDefender = pickAnbuDefender;
exports.getOrSealAnbuSnapshot = getOrSealAnbuSnapshot;
exports.settleInfiltrationWin = settleInfiltrationWin;
exports.turnInCachesForSave = turnInCachesForSave;
/*
 * Anbu Vault Infiltration — KV storage + server-authoritative settlement.
 *
 * The security core of the raid (docs/anbu-infiltration-plan.md §9). Every payout
 * is server-authoritative and follows the repo's hardened patterns:
 *   - the settle takes the SERVER run record (infil:<runId>) and re-checks
 *     completion — never a client "I won";
 *   - the reward roll is a server-supplied random, and BOTH skims are recomputed
 *     inside each pool's failClosed lock from the FRESH balance (the client sends
 *     no amounts, ever);
 *   - the whole drain is wrapped in an economy-tx (reserve → debit-applied →
 *     complete / needs-reconcile) with "lose, never duplicate" semantics — a
 *     crash after the pool debit can lose the skim but never mint it twice
 *     (mirrors api/clan/territory/collect-supply.ts);
 *   - an NX paid-receipt makes the settle idempotent per run;
 *   - caches + ryo are credited under the raider's save lock with
 *     mergePreservingImages + bumpSaveVersion (the autosave contract).
 *
 * Daily-loss ledgers live in their OWN keys (infil-loss:*) — deliberately NOT as
 * new fields on world:territory:* / the village-war record, because
 * normalizeVillageWarRecord rebuilds records from a whitelist and would silently
 * drop an unknown field on the next write. Separate keys = no schema change to
 * shared records and no clobber risk.
 *
 * The supply skim materializes the sector's LAZY accrual first (stored warSupply
 * is usually 0 between collects — accrual derives from lastSupplyAt): inside the
 * territory lock it computes the true collectible via collectTerritorySupply,
 * skims 1% of THAT, and writes back the remainder with the advanced lastSupplyAt —
 * so the owner's later collect sees exactly (total − skim) + new accrual.
 *
 * kv / lock / now are INJECTABLE (default to the real ones) so the currency logic
 * is unit-testable with a fake in-memory store — same pattern as towers/_tower-store.
 */
const _storage_js_1 = require("./_storage.js");
const _lock_js_1 = require("./_lock.js");
const _utils_js_1 = require("./_utils.js");
const _save_version_js_1 = require("./save/_save-version.js");
const _territory_supply_js_1 = require("./_territory-supply.js");
const _war_state_js_1 = require("./_war-state.js");
const _economy_tx_js_1 = require("./_economy-tx.js");
const _seal_js_1 = require("./towers/_seal.js");
const _clan_points_js_1 = require("./_clan-points.js");
const _village_merit_js_1 = require("./village/_village-merit.js");
const _anbu_infiltration_js_1 = require("./_anbu-infiltration.js");
function resolve(deps) {
    return {
        kv: deps.kv ?? _storage_js_1.kv,
        lock: deps.lock ?? _lock_js_1.withKvLock,
        now: deps.now ?? (() => Date.now()),
    };
}
// ─── key scheme (all server-only; own infil:* namespace so the tower/battle
//     endpoints can never resolve these sessions) ─────────────────────────────
const infilRunKey = (runId) => `infil:${runId}`;
exports.infilRunKey = infilRunKey;
const infilStartCountKey = (slug, dateKey) => `infil-start-count:${slug}:${dateKey}`;
exports.infilStartCountKey = infilStartCountKey;
const infilPaidKey = (runId) => `infil-paid:${runId}`;
exports.infilPaidKey = infilPaidKey;
const supplyLedgerKey = (sector) => `infil-loss:supply:${sector}`;
exports.supplyLedgerKey = supplyLedgerKey;
const wrLedgerKey = (villageSlug) => `infil-loss:wr:${villageSlug}`;
exports.wrLedgerKey = wrLedgerKey;
const anbuSealKey = (villageSlug, anbuSlug, dateKey) => `infil-anbu-seal:${villageSlug}:${anbuSlug}:${dateKey}`;
exports.anbuSealKey = anbuSealKey;
const anbuLastDefKey = (villageSlug) => `infil-anbu-last:${villageSlug}`;
exports.anbuLastDefKey = anbuLastDefKey;
const TERRITORY_KEY_PREFIX = 'world:territory:';
const AUDIT_LOG_PREFIX = 'audit:anbu-infiltration:';
exports.INFIL_RUN_TTL = 45 * 60; // refreshed on every action
exports.INFIL_PAID_TTL = 24 * 60 * 60; // per-run settle replay guard
exports.INFIL_LEDGER_TTL = 3 * 24 * 60 * 60; // rollover re-anchors anyway
exports.ANBU_SEAL_TTL = 25 * 60 * 60; // "re-sealed daily" (lazy)
exports.ANBU_LAST_DEF_TTL = 30 * 24 * 60 * 60;
exports.START_COUNT_TTL = 25 * 60 * 60;
/** KEEP IN SYNC with api/_war-role.ts villageStateKey (module-local there). */
function villageStateKey(village) {
    return `game:village-state:${villageSlug(village)}`;
}
function villageSlug(village) {
    return String(village ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}
async function readInfilRun(runId, deps = {}) {
    const { kv } = resolve(deps);
    return await kv.get((0, exports.infilRunKey)(runId));
}
async function writeInfilRun(run, deps = {}) {
    const { kv } = resolve(deps);
    await kv.set((0, exports.infilRunKey)(run.runId), run, { ex: exports.INFIL_RUN_TTL });
}
async function deleteInfilRun(runId, deps = {}) {
    const { kv } = resolve(deps);
    await kv.del((0, exports.infilRunKey)(runId));
}
/** Atomic daily start-count bump (counts ATTEMPTS, like raid-start's mint cap —
 *  abandoning a run does not refund it). Returns the post-increment count. */
async function bumpInfilStartCount(slug, deps = {}) {
    const { kv, now } = resolve(deps);
    return await kv.incr((0, exports.infilStartCountKey)(slug, (0, _anbu_infiltration_js_1.utcDateKey)(now())), { ex: exports.START_COUNT_TTL });
}
// ─── Anbu roster / defender selection / daily seal ───────────────────────────
/** The village's appointed Anbu as safeName slugs (deduped, order-preserving). */
async function loadAnbuAppointees(village, deps = {}) {
    const { kv } = resolve(deps);
    const vs = await kv.get(villageStateKey(village));
    const raw = Array.isArray(vs?.anbuAppointees) ? vs.anbuAppointees : [];
    const out = [];
    for (const a of raw) {
        const slug = (0, _utils_js_1.safeName)(String(a ?? ''));
        if (slug && !out.includes(slug))
            out.push(slug);
    }
    return out;
}
/** Least-recently-defended rotation over the appointee list (missing timestamp =
 *  never defended = picked first; ties break by slug order for determinism).
 *  Stamps the pick's timestamp so the roster rotates. */
async function pickAnbuDefender(village, appointees, deps = {}) {
    if (appointees.length === 0)
        return null;
    const { kv, now } = resolve(deps);
    const key = (0, exports.anbuLastDefKey)(villageSlug(village));
    const lastMap = (await kv.get(key)) ?? {};
    let pick = appointees[0];
    let best = Infinity;
    for (const slug of [...appointees].sort()) {
        const t = num(lastMap[slug], 0);
        if (t < best) {
            best = t;
            pick = slug;
        }
    }
    const nextLastMap = { ...lastMap };
    (0, _utils_js_1.setSafeRecordValue)(nextLastMap, pick, now());
    await kv.set(key, nextLastMap, { ex: exports.ANBU_LAST_DEF_TTL });
    return pick;
}
/** Get today's sealed snapshot of an Anbu, sealing it from their authoritative
 *  save on first use each UTC day ("frozen at appointment + re-sealed daily",
 *  realized lazily — no cron needed). Null if the Anbu has no save. */
async function getOrSealAnbuSnapshot(village, anbuSlug, deps = {}) {
    const { kv, now } = resolve(deps);
    const t = now();
    const key = (0, exports.anbuSealKey)(villageSlug(village), anbuSlug, (0, _anbu_infiltration_js_1.utcDateKey)(t));
    const cached = await kv.get(key);
    if (cached && cached.character)
        return cached;
    const save = await kv.get(`save:${anbuSlug}`);
    const char = save?.character;
    if (!char || typeof char !== 'object')
        return null;
    const snapshot = {
        slug: anbuSlug,
        name: String(char.name ?? anbuSlug),
        character: (0, _seal_js_1.sealTowerFighter)(char, save ?? null, {}),
        sealedAt: t,
    };
    await kv.set(key, snapshot, { ex: exports.ANBU_SEAL_TTL });
    return snapshot;
}
/**
 * Settle a WON run: roll pools, drain each selected pool under its own failClosed
 * lock (fresh-balance recompute + the 50%/day ledger), then mint caches + ryo into
 * the raider's save. Idempotent via the NX paid receipt. `roll` is the handler's
 * server-side random in [0,1).
 */
async function settleInfiltrationWin(run, roll, deps = {}) {
    const { kv, lock, now } = resolve(deps);
    const t = now();
    // Idempotency: one settle per run, ever (the run token at the endpoint layer
    // is the primary gate; this receipt is belt-and-braces against replays).
    const placed = await kv.set((0, exports.infilPaidKey)(run.runId), { ts: t, raider: run.raiderSlug }, { nx: true, ex: exports.INFIL_PAID_TTL });
    if (!placed)
        return { ok: true, alreadySettled: true };
    const rolled = (0, _anbu_infiltration_js_1.rollRewardPools)(roll);
    const vSlug = villageSlug(run.targetVillage);
    const txId = (0, _economy_tx_js_1.makeEconomyTxId)('anbu-infiltration-raid');
    await (0, _economy_tx_js_1.reserveEconomyTx)({
        id: txId,
        kind: 'anbu-infiltration-raid',
        debitKey: `${TERRITORY_KEY_PREFIX}${run.sector}|${(0, _war_state_js_1.villageWarKey)(run.targetVillage)}`,
        creditKey: `save:${run.raiderSlug}`,
        resource: 'war-caches',
        amount: 0,
        meta: { runId: run.runId, sector: run.sector, targetVillage: run.targetVillage, rolled },
    }, { kv: kv });
    try {
        // ── Phase 1a (debit): the sector's warSupply, under the territory lock.
        // Materialize the lazy accrual (collectTerritorySupply mirrors the collect
        // endpoint), skim 1% of the true collectible, write back the remainder.
        let supplySkim = 0;
        if (rolled.supply) {
            const key = `${TERRITORY_KEY_PREFIX}${run.sector}`;
            supplySkim = await lock(key, async () => {
                const fresh = await kv.get(key);
                // Ownership flipped mid-run (sector-war capture) → the pool is no
                // longer the enemy's; nothing to skim.
                if (!fresh || String(fresh.ownerVillage ?? '') !== run.targetVillage)
                    return 0;
                const { collected, nextLastSupplyAt } = (0, _territory_supply_js_1.collectTerritorySupply)(fresh, t);
                const ledger = await kv.get((0, exports.supplyLedgerKey)(run.sector));
                const { skim, ledger: nextLedger } = (0, _anbu_infiltration_js_1.applySkim)(ledger, collected, t);
                if (skim <= 0)
                    return 0;
                await kv.set(key, { ...fresh, warSupply: collected - skim, lastSupplyAt: nextLastSupplyAt, updatedAt: t });
                await kv.set((0, exports.supplyLedgerKey)(run.sector), nextLedger, { ex: exports.INFIL_LEDGER_TTL });
                return skim;
            }, { failClosed: true });
        }
        // ── Phase 1b (debit): the village's WR pool, under the village-war lock.
        let wrSkim = 0;
        if (rolled.wr) {
            const warKey = (0, _war_state_js_1.villageWarKey)(run.targetVillage);
            wrSkim = await lock(warKey, async () => {
                const rec = (0, _war_state_js_1.normalizeVillageWarRecord)(run.targetVillage, (await kv.get(warKey)) ?? undefined);
                const ledger = await kv.get((0, exports.wrLedgerKey)(vSlug));
                const { skim, ledger: nextLedger } = (0, _anbu_infiltration_js_1.applySkim)(ledger, rec.warResources, t);
                if (skim <= 0)
                    return 0;
                await kv.set(warKey, { ...rec, warResources: rec.warResources - skim });
                await kv.set((0, exports.wrLedgerKey)(vSlug), nextLedger, { ex: exports.INFIL_LEDGER_TTL });
                return skim;
            }, { failClosed: true });
        }
        const supplyCaches = (0, _anbu_infiltration_js_1.cachesForSkim)(supplySkim);
        const wrCaches = (0, _anbu_infiltration_js_1.cachesForSkim)(wrSkim);
        await (0, _economy_tx_js_1.markEconomyTx)(txId, 'debit-applied', {
            amount: supplySkim + wrSkim,
            meta: { runId: run.runId, sector: run.sector, targetVillage: run.targetVillage, rolled, supplySkim, wrSkim },
        }, { kv: kv });
        // ── Phase 2 (credit): mint caches + ryo into the raider's save. A failure
        // here KEEPS "lose, never duplicate" (never re-credit the pools — a racing
        // raid could double-mint); record the shortfall durably + loudly instead.
        let overflowLost = 0;
        let saveVersion = 0;
        try {
            const out = await lock(`save:${run.raiderSlug}`, async () => {
                const saveKey = `save:${run.raiderSlug}`;
                const rec = await kv.get(saveKey);
                const char = rec?.character;
                if (!rec || !char)
                    return { error: 'no-save' };
                const stacks = Array.isArray(char.itemStacks)
                    ? char.itemStacks.map(s => ({ ...s }))
                    : [];
                let lost = 0;
                const mint = (pool, add) => {
                    if (add <= 0)
                        return;
                    const itemId = (0, _anbu_infiltration_js_1.cacheItemIdForPool)(pool);
                    const existing = stacks.find(s => s.itemId === itemId);
                    const have = existing ? Math.max(0, Math.floor(num(existing.count))) : 0;
                    const next = Math.min(_anbu_infiltration_js_1.CACHE_STACK_CAP, have + add);
                    lost += (have + add) - next;
                    if (existing)
                        existing.count = next;
                    else
                        stacks.push({ itemId, count: next });
                };
                mint('warSupply', supplyCaches);
                mint('warResources', wrCaches);
                const nextChar = {
                    ...char,
                    itemStacks: stacks,
                    ryo: num(char.ryo) + _anbu_infiltration_js_1.RAID_RYO_REWARD,
                };
                const next = (0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: nextChar });
                await kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)(next, rec));
                return { lost, saveVersion: num(next._saveVersion) };
            }, { failClosed: true });
            if ('error' in out) {
                await (0, _economy_tx_js_1.failEconomyTx)(txId, 'raider save missing at credit', { amount: supplySkim + wrSkim }, { kv: kv });
                return { ok: false, error: 'no-save' };
            }
            overflowLost = out.lost;
            saveVersion = out.saveVersion;
        }
        catch (creditErr) {
            console.error(`[anbu-infiltration] CREDIT FAILED after debit — ${supplySkim + wrSkim} skimmed units unreconciled for ${run.raiderSlug}:`, creditErr);
            await kv.set(`${AUDIT_LOG_PREFIX}LOSS:${run.raiderSlug}:${t}`, {
                ts: t, runId: run.runId, raider: run.raiderSlug, sector: run.sector,
                targetVillage: run.targetVillage, supplySkim, wrSkim,
                error: creditErr instanceof Error ? creditErr.message : String(creditErr),
            }, { ex: 90 * 24 * 60 * 60 }).catch(() => undefined);
            await (0, _economy_tx_js_1.failEconomyTx)(txId, creditErr, { amount: supplySkim + wrSkim }, { kv: kv }).catch(() => undefined);
            return { ok: false, error: 'credit-failed' };
        }
        await (0, _economy_tx_js_1.completeEconomyTx)(txId, {
            amount: supplySkim + wrSkim,
            meta: { runId: run.runId, sector: run.sector, targetVillage: run.targetVillage, rolled, supplySkim, wrSkim, supplyCaches, wrCaches, overflowLost },
        }, { kv: kv });
        await kv.set(`${AUDIT_LOG_PREFIX}${run.raiderSlug}:${t}`, {
            ts: t, runId: run.runId, raider: run.raiderSlug, sector: run.sector,
            targetVillage: run.targetVillage, rolled, supplySkim, wrSkim, ryo: _anbu_infiltration_js_1.RAID_RYO_REWARD,
        }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
        return {
            ok: true, alreadySettled: false, rolled,
            supplySkim, wrSkim, supplyCaches, wrCaches,
            ryo: _anbu_infiltration_js_1.RAID_RYO_REWARD, overflowLost, saveVersion,
        };
    }
    catch (err) {
        // A debit-phase failure (lock contention under failClosed, KV hiccup): the
        // paid receipt stays placed — deliberately. Re-running a settle whose debits
        // may have partially landed risks a double-drain; needs-reconcile + the
        // audit trail make it an admin fix, mirroring collect-supply's stance.
        await (0, _economy_tx_js_1.failEconomyTx)(txId, err, {}, { kv: kv }).catch(() => undefined);
        throw err;
    }
}
/**
 * Convert held caches into standing points at the type-locked ratio (docs §8,
 * decision B): War Supply cache → clan points ('clanRaid' source, 2:1), War
 * Resource cache → personal villageMerit (1:1). Points are clamped to the
 * destination's caps FIRST and only that many caches are consumed — a dump can
 * never burn caches for zero credit. All under the save lock, failClosed.
 * `count` ≤ 0 means "turn in everything held".
 */
async function turnInCachesForSave(params, deps = {}) {
    const { kv, lock, now } = resolve(deps);
    const t = now();
    const playerName = (0, _utils_js_1.safeName)(params.playerName);
    const itemId = (0, _anbu_infiltration_js_1.cacheItemIdForPool)(params.cache);
    return await lock(`save:${playerName}`, async () => {
        const saveKey = `save:${playerName}`;
        const rec = await kv.get(saveKey);
        const char = rec?.character;
        if (!rec || !char)
            return { ok: false, error: 'no-save' };
        const stacks = Array.isArray(char.itemStacks)
            ? char.itemStacks.map(s => ({ ...s }))
            : [];
        const stack = stacks.find(s => s.itemId === itemId);
        const held = stack ? Math.max(0, Math.floor(num(stack.count))) : 0;
        const want = params.count && params.count > 0 ? Math.min(Math.floor(params.count), held) : held;
        if (want <= 0)
            return { ok: false, error: 'nothing-to-turn-in' };
        const raw = (0, _anbu_infiltration_js_1.turnInCaches)(params.cache, want);
        if (raw.points <= 0)
            return { ok: false, error: 'nothing-to-turn-in' };
        let nextChar;
        let points;
        let consumed;
        if (raw.dest === 'clan') {
            if (!char.clan)
                return { ok: false, error: 'not-in-clan' };
            // Clamp to the award pipe's caps BEFORE consuming caches: per-award 250
            // + the weekly 1000 headroom — never consume more than what credits.
            const weekKey = (0, _clan_points_js_1.clanPointWeekKey)(new Date(t));
            const currentWeekly = String(char.weeklyClanPointsWeek ?? '') === weekKey
                ? Math.max(0, Math.floor(num(char.weeklyClanPoints))) : 0;
            const headroom = Math.max(0, _clan_points_js_1.CLAN_POINTS_WEEKLY_CAP - currentWeekly);
            points = Math.min(raw.points, _clan_points_js_1.MAX_CLAN_POINTS_AWARD, headroom);
            if (points <= 0)
                return { ok: false, error: 'cap-reached' };
            consumed = points * _anbu_infiltration_js_1.CLAN_CACHES_PER_POINT;
            const award = (0, _clan_points_js_1.awardClanPoints)(char, 'clanRaid', points, { eventId: `infil-turnin:${playerName}:${t}` }, new Date(t));
            if (award.awarded !== points)
                return { ok: false, error: 'cap-reached' };
            nextChar = award.character;
        }
        else {
            points = Math.min(raw.points, _anbu_infiltration_js_1.VILLAGE_TURNIN_MAX_POINTS);
            consumed = points; // 1:1
            nextChar = { ...char, villageMerit: (0, _village_merit_js_1.meritNum)(char.villageMerit) + points };
        }
        // Decrement the stack by what was actually consumed; drop empty stacks so
        // the array never accumulates zero-count entries.
        stack.count = held - consumed;
        const nextStacks = stacks.filter(s => Math.max(0, Math.floor(num(s.count))) > 0);
        nextChar = { ...nextChar, itemStacks: nextStacks };
        const next = (0, _save_version_js_1.bumpSaveVersion)({ ...rec, character: nextChar });
        await kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)(next, rec));
        await kv.set(`${AUDIT_LOG_PREFIX}turnin:${playerName}:${t}`, {
            ts: t, playerName, cache: params.cache, dest: raw.dest, points, consumed,
        }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
        return {
            ok: true,
            dest: raw.dest,
            points,
            consumed,
            remaining: held - consumed,
            saveVersion: num(next._saveVersion),
        };
    }, { failClosed: true });
}
