"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _xp_engine_js_1 = require("../_xp-engine.js");
const _tower_store_js_1 = require("../towers/_tower-store.js");
const _run_token_js_1 = require("./_run-token.js");
const _combat_session_js_1 = require("./_combat-session.js");
const COMBAT_RECEIPT_TTL_SECONDS = 8 * 24 * 60 * 60;
const HOSPITAL_DURATION_MS = 60_000;
const HG_FRAGMENT_ID = 'dungeon-legendary-fragment';
const ELEMENTAL_SHARD_ID = 'elemental-shard';
const VEIL_OF_THE_HOLLOW_ID = 'veil-of-the-hollow';
function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}
function addCountedItem(itemStacks, itemId, amountRaw) {
    const amount = Math.max(0, Math.floor(num(amountRaw)));
    const stacks = Array.isArray(itemStacks) ? itemStacks : [];
    if (!amount)
        return stacks;
    let found = false;
    const next = stacks.map((stack) => {
        if (!stack || String(stack.itemId ?? '') !== itemId)
            return stack;
        found = true;
        return { ...stack, count: Math.max(0, Math.floor(num(stack.count))) + amount };
    });
    return found ? next : [...next, { itemId, count: amount }];
}
async function persistRunCombatSettlement(runKey, run, binding, receipt) {
    const encounterKey = (0, _combat_session_js_1.hollowGateEncounterKey)(binding.floor, binding.kind, binding.nodeId);
    const resolved = Array.isArray(run.resolvedEncounterIds) ? run.resolvedEncounterIds : [];
    const alreadyResolved = resolved.includes(encounterKey);
    const priorCredits = run.serverCreditedCurrencies ?? {};
    const paid = receipt.reward;
    const activeIsThisFight = run.activeEncounter?.runId === binding.runId;
    if (!activeIsThisFight && !alreadyResolved) {
        await _storage_js_1.kv.set((0, _combat_session_js_1.hollowGateCombatBindingKey)(binding.runId), (0, _combat_session_js_1.settleHollowGateCombatBinding)(binding, receipt.won, receipt.settledAt), { ex: _combat_session_js_1.HOLLOW_GATE_COMBAT_TTL_SECONDS });
        return;
    }
    const nextRun = {
        ...run,
        ...(activeIsThisFight ? { activeEncounter: null } : {}),
        ...(receipt.revived ? { secondWindArmed: false } : {}),
        resolvedEncounterIds: receipt.revived || alreadyResolved ? resolved : [...resolved.slice(-127), encounterKey],
        serverCreditedCurrencies: receipt.won && !alreadyResolved ? {
            ...priorCredits,
            ryo: num(priorCredits.ryo) + paid.ryo,
            auraDust: num(priorCredits.auraDust) + paid.auraDust,
            honorSeals: num(priorCredits.honorSeals) + paid.honorSeals,
            boneCharms: num(priorCredits.boneCharms) + paid.boneCharms,
            fateShards: num(priorCredits.fateShards) + paid.fateShards,
            hollowShards: num(priorCredits.hollowShards) + paid.hollowShards,
        } : priorCredits,
    };
    if (!receipt.won && !receipt.revived)
        await _storage_js_1.kv.del(runKey);
    else
        await _storage_js_1.kv.set(runKey, nextRun, { ex: _combat_session_js_1.HOLLOW_GATE_COMBAT_TTL_SECONDS });
    await _storage_js_1.kv.set((0, _combat_session_js_1.hollowGateCombatBindingKey)(binding.runId), (0, _combat_session_js_1.settleHollowGateCombatBinding)(binding, receipt.won, receipt.settledAt), { ex: _combat_session_js_1.HOLLOW_GATE_COMBAT_TTL_SECONDS });
}
/** Idempotently banks the server-recorded combat result and clears the run's active encounter. */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const token = String(body.token ?? '').slice(0, 64);
        const runId = String(body.runId ?? '').slice(0, 96);
        if (!playerName || !token || !runId)
            return res.status(400).json({ error: 'Missing Hollow Gate combat identity.' });
        if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'hollow-gate-combat-settle', 30, 60_000, playerName))
            return;
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Not your run.' });
        const bindingKey = (0, _combat_session_js_1.hollowGateCombatBindingKey)(runId);
        const initialBinding = await _storage_js_1.kv.get(bindingKey);
        if (!initialBinding || initialBinding.playerName !== playerName)
            return res.status(404).json({ error: 'Encounter not found.' });
        const receiptKey = `hg-combat-paid:${runId}`;
        const runKey = (0, _run_token_js_1.hollowGateRunKey)(playerName, token);
        const result = await (0, _lock_js_1.withKvLock)(runKey, async () => {
            const [run, binding, session, existingReceipt] = await Promise.all([
                _storage_js_1.kv.get(runKey),
                _storage_js_1.kv.get(bindingKey),
                (0, _tower_store_js_1.readSession)(runId),
                _storage_js_1.kv.get(receiptKey),
            ]);
            if (!binding || binding.playerName !== playerName)
                return { status: 404, body: { error: 'Encounter not found.' } };
            if (existingReceipt) {
                if (run)
                    await persistRunCombatSettlement(runKey, run, binding, existingReceipt);
                else
                    await _storage_js_1.kv.set(bindingKey, (0, _combat_session_js_1.settleHollowGateCombatBinding)(binding, existingReceipt.won, existingReceipt.settledAt), { ex: _combat_session_js_1.HOLLOW_GATE_COMBAT_TTL_SECONDS });
                const current = await _storage_js_1.kv.get(`save:${playerName}`);
                return { status: 200, body: {
                        ok: true,
                        alreadyReported: true,
                        won: existingReceipt.won,
                        revived: existingReceipt.revived ?? false,
                        reward: existingReceipt.reward,
                        elementalShards: existingReceipt.elementalShards,
                        character: current?.character ?? null,
                        _saveVersion: Number(current?._saveVersion ?? 0),
                    } };
            }
            if (binding.status !== 'active' || binding.settledAt) {
                return { status: 409, body: { error: 'The encounter is settled but its reward receipt is unavailable.' } };
            }
            if (!run)
                return { status: 409, body: { error: _run_token_js_1.HOLLOW_GATE_RUN_EXPIRED_MESSAGES.combatSettle } };
            const validation = (0, _combat_session_js_1.validateHollowGateCombatSession)({ binding, session, activeEncounter: run.activeEncounter, playerName, token });
            if (!validation.ok)
                return { status: 409, body: { error: `Hollow Gate settlement rejected: ${validation.reason}.` } };
            const won = session.winner === 'squad';
            const revived = !won && binding.secondWindArmed === true;
            const survivingActor = session.actors.find((actor) => actor.side === 'squad' && actor.ownerSlug === playerName);
            await (0, _tower_store_js_1.settleConsumedItemsForMember)({ session: session, slug: playerName });
            const saveKey = `save:${playerName}`;
            const banked = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
                const record = await _storage_js_1.kv.get(saveKey);
                const char = record?.character;
                if (!record || !char)
                    return null;
                const existing = await _storage_js_1.kv.get(receiptKey);
                if (existing)
                    return { receipt: existing, character: char, saveVersion: Number(record._saveVersion ?? 0) };
                const reward = won ? (0, _combat_session_js_1.hollowGateCombatReward)(binding.floor, binding.kind, char.profession) : (0, _combat_session_js_1.hollowGateCombatReward)(binding.floor, binding.kind, undefined);
                if (!won) {
                    for (const key of Object.keys(reward))
                        reward[key] = 0;
                }
                const elementalShards = won && binding.kind === 'boss'
                    && (0, node_crypto_1.randomInt)(0, 10_000) < Math.floor(Math.min(0.8, 0.5 + binding.floor * 0.03) * 10_000) ? 1 : 0;
                const receipt = { won, revived, reward, elementalShards, settledAt: Date.now() };
                const placed = await _storage_js_1.kv.set(receiptKey, receipt, { nx: true, ex: COMBAT_RECEIPT_TTL_SECONDS });
                if (!placed) {
                    const raced = await _storage_js_1.kv.get(receiptKey);
                    return { receipt: raced ?? receipt, character: char, saveVersion: Number(record._saveVersion ?? 0) };
                }
                let next = { ...char };
                if (won) {
                    next = (0, _xp_engine_js_1.gainXp)(next, reward.xp);
                    next.hp = (0, _combat_session_js_1.hollowGatePostWinHp)(next.maxHp, survivingActor?.hp, binding.kind);
                    if (binding.petAssisted) {
                        next.chakra = num(next.maxChakra);
                        next.stamina = num(next.maxStamina);
                    }
                    next.ryo = num(next.ryo) + reward.ryo;
                    next.auraDust = num(next.auraDust) + reward.auraDust;
                    next.honorSeals = num(next.honorSeals) + reward.honorSeals;
                    next.boneCharms = num(next.boneCharms) + reward.boneCharms;
                    next.fateShards = num(next.fateShards) + reward.fateShards;
                    next.hollowShards = num(next.hollowShards) + reward.hollowShards;
                    next.itemStacks = addCountedItem(next.itemStacks, HG_FRAGMENT_ID, reward.fragments);
                    next.itemStacks = addCountedItem(next.itemStacks, VEIL_OF_THE_HOLLOW_ID, reward.veils);
                    next.itemStacks = addCountedItem(next.itemStacks, ELEMENTAL_SHARD_ID, elementalShards);
                    if (binding.kind === 'boss')
                        next.hollowGateWardenKills = num(next.hollowGateWardenKills) + 1;
                    if (next.hollowGateRun && typeof next.hollowGateRun === 'object') {
                        const nextRun = { ...next.hollowGateRun };
                        delete nextRun.activeCombat;
                        next.hollowGateRun = nextRun;
                    }
                }
                else if (revived) {
                    const savedRun = next.hollowGateRun && typeof next.hollowGateRun === 'object'
                        ? next.hollowGateRun
                        : {};
                    next = {
                        ...next,
                        hp: Math.max(1, Math.floor(num(next.maxHp) * 0.5)),
                        hospitalized: false,
                        hospitalizedAt: 0,
                        hospitalizedUntil: 0,
                        hollowGateRun: { ...savedRun, secondWindArmed: false, threat: 0, activeCombat: undefined },
                    };
                }
                else {
                    const now = Date.now();
                    // Preserve the shipped death rule: retain 50% of positive
                    // run gains, never refund an in-run spend below the entry
                    // snapshot, then close the run and hospitalize the player.
                    for (const key of ['ryo', 'auraDust', 'auraStones', 'boneCharms', 'fateShards', 'honorSeals', 'hollowShards']) {
                        const current = Math.max(0, num(next[key]));
                        const entry = Math.max(0, num(run.entryCurrencies[key]));
                        next[key] = current > entry ? entry + Math.floor((current - entry) * 0.5) : current;
                    }
                    next = {
                        ...next,
                        hp: 0,
                        hospitalized: true,
                        hospitalizedAt: now,
                        hospitalizedUntil: now + HOSPITAL_DURATION_MS,
                        hollowGateRun: null,
                    };
                }
                try {
                    const updated = (0, _save_version_js_1.bumpSaveVersion)({ ...record, character: next });
                    await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)(updated, record));
                    return { receipt, character: next, saveVersion: Number(updated._saveVersion ?? 0) };
                }
                catch (error) {
                    await _storage_js_1.kv.del(receiptKey).catch(() => undefined);
                    throw error;
                }
            }, { failClosed: true, ttlSec: 10 });
            if (!banked)
                return { status: 404, body: { error: 'Player save not found.' } };
            await persistRunCombatSettlement(runKey, run, binding, banked.receipt);
            return { status: 200, body: {
                    ok: true,
                    won,
                    revived,
                    reward: banked.receipt.reward,
                    elementalShards: banked.receipt.elementalShards,
                    character: banked.character,
                    _saveVersion: banked.saveVersion,
                } };
        }, { failClosed: true, ttlSec: 15 });
        return res.status(result.status).json(result.body);
    }
    catch (err) {
        console.error('[hollow-gate/combat-settle]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
