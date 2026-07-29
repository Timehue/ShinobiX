import { randomInt } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, mergePreservingImages, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { gainXp } from '../_xp-engine.js';
import { readSession, settleConsumedItemsForMember } from '../towers/_tower-store.js';
import { hollowGateRunKey, HOLLOW_GATE_RUN_EXPIRED_MESSAGES, type HollowGateRunToken } from './_run-token.js';
import {
    hollowGateCombatBindingKey,
    hollowGatePostWinHp,
    hollowGateCombatReward,
    hollowGateEncounterKey,
    HOLLOW_GATE_COMBAT_TTL_SECONDS,
    settleHollowGateCombatBinding,
    validateHollowGateCombatSession,
    validateHollowGatePetClaim,
    validateHollowGatePveClaim,
    type HollowGateCombatBinding,
    type HollowGateCombatReward,
} from './_combat-session.js';

const COMBAT_RECEIPT_TTL_SECONDS = 8 * 24 * 60 * 60;
const HOSPITAL_DURATION_MS = 60_000;
const HG_FRAGMENT_ID = 'dungeon-legendary-fragment';
const ELEMENTAL_SHARD_ID = 'elemental-shard';
const VEIL_OF_THE_HOLLOW_ID = 'veil-of-the-hollow';

type CombatReceipt = {
    won: boolean;
    revived?: boolean;
    escaped?: boolean;
    petDefeat?: boolean;
    reward: HollowGateCombatReward;
    elementalShards: number;
    settledAt: number;
};

type HollowGatePetResultReceipt = {
    playerName: string;
    runId: string;
    outcome: 'win' | 'loss' | 'draw';
    playerPetIds: string[];
    settledAt: number;
};

function num(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function addCountedItem(itemStacks: unknown, itemId: string, amountRaw: unknown): Array<Record<string, unknown>> {
    const amount = Math.max(0, Math.floor(num(amountRaw)));
    const stacks = Array.isArray(itemStacks) ? itemStacks as Array<Record<string, unknown>> : [];
    if (!amount) return stacks;
    let found = false;
    const next = stacks.map((stack) => {
        if (!stack || String(stack.itemId ?? '') !== itemId) return stack;
        found = true;
        return { ...stack, count: Math.max(0, Math.floor(num(stack.count))) + amount };
    });
    return found ? next : [...next, { itemId, count: amount }];
}

async function persistRunCombatSettlement(
    runKey: string,
    run: HollowGateRunToken,
    binding: HollowGateCombatBinding,
    receipt: CombatReceipt,
): Promise<void> {
    const encounterKey = hollowGateEncounterKey(binding.floor, binding.kind, binding.nodeId);
    const resolved = Array.isArray(run.resolvedEncounterIds) ? run.resolvedEncounterIds : [];
    const alreadyResolved = resolved.includes(encounterKey);
    const priorCredits = run.serverCreditedCurrencies ?? {};
    const paid = receipt.reward;
    const activeIsThisFight = run.activeEncounter?.runId === binding.runId;
    if (!activeIsThisFight && !alreadyResolved) {
        await kv.set(hollowGateCombatBindingKey(binding.runId), settleHollowGateCombatBinding(binding, receipt.won, receipt.settledAt), { ex: HOLLOW_GATE_COMBAT_TTL_SECONDS });
        return;
    }
    const nextRun: HollowGateRunToken = {
        ...run,
        ...(activeIsThisFight ? { activeEncounter: null } : {}),
        ...(receipt.revived ? { secondWindArmed: false } : {}),
        resolvedEncounterIds: receipt.revived || receipt.escaped || receipt.petDefeat || alreadyResolved
            ? resolved
            : [...resolved.slice(-127), encounterKey],
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
    if (!receipt.won && !receipt.revived && !receipt.escaped && !receipt.petDefeat) await kv.del(runKey);
    else await kv.set(runKey, nextRun, { ex: HOLLOW_GATE_COMBAT_TTL_SECONDS });
    await kv.set(hollowGateCombatBindingKey(binding.runId), settleHollowGateCombatBinding(binding, receipt.won, receipt.settledAt), { ex: HOLLOW_GATE_COMBAT_TTL_SECONDS });
}

/** Idempotently banks the server-recorded combat result and clears the run's active encounter. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const token = String(body.token ?? '').slice(0, 64);
        const runId = String(body.runId ?? '').slice(0, 96);
        const claimedOutcome = body.outcome === 'win' || body.outcome === 'loss' || body.outcome === 'fled'
            ? body.outcome
            : null;
        const claimedSurvivingHp = Math.max(0, Math.floor(Number(body.survivingHp) || 0));
        const petReceipt = typeof body.petReceipt === 'string' && /^[A-Za-z0-9]+$/.test(body.petReceipt)
            ? body.petReceipt
            : '';
        if (!playerName || !token || !runId) return res.status(400).json({ error: 'Missing Hollow Gate combat identity.' });
        if (!enforceRateLimit(req, res, 'hollow-gate-combat-settle', 30, 60_000, playerName)) return;

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your run.' });

        const bindingKey = hollowGateCombatBindingKey(runId);
        const initialBinding = await kv.get<HollowGateCombatBinding>(bindingKey);
        if (!initialBinding || initialBinding.playerName !== playerName) return res.status(404).json({ error: 'Encounter not found.' });
        const receiptKey = `hg-combat-paid:${runId}`;

        const runKey = hollowGateRunKey(playerName, token);
        const result = await withKvLock(runKey, async () => {
            const [run, binding, session, existingReceipt] = await Promise.all([
                kv.get<HollowGateRunToken>(runKey),
                kv.get<HollowGateCombatBinding>(bindingKey),
                readSession(runId),
                kv.get<CombatReceipt>(receiptKey),
            ]);
            if (!binding || binding.playerName !== playerName) return { status: 404, body: { error: 'Encounter not found.' } };
            if (existingReceipt) {
                if (run) await persistRunCombatSettlement(runKey, run, binding, existingReceipt);
                else await kv.set(bindingKey, settleHollowGateCombatBinding(binding, existingReceipt.won, existingReceipt.settledAt), { ex: HOLLOW_GATE_COMBAT_TTL_SECONDS });
                const current = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                return { status: 200, body: {
                    ok: true,
                    alreadyReported: true,
                    won: existingReceipt.won,
                    revived: existingReceipt.revived ?? false,
                    escaped: existingReceipt.escaped ?? false,
                    petDefeat: existingReceipt.petDefeat ?? false,
                    reward: existingReceipt.reward,
                    elementalShards: existingReceipt.elementalShards,
                    character: current?.character ?? null,
                    _saveVersion: Number(current?._saveVersion ?? 0),
                } };
            }
            if (binding.status !== 'active' || binding.settledAt) {
                return { status: 409, body: { error: 'The encounter is settled but its reward receipt is unavailable.' } };
            }
            if (!run) return { status: 409, body: { error: HOLLOW_GATE_RUN_EXPIRED_MESSAGES.combatSettle } };
            let won = false;
            let escaped = false;
            let petDefeat = false;
            let petIds: string[] = [];
            let survivingHp = 0;
            if (binding.combatMode === 'pet') {
                const validation = validateHollowGatePetClaim({ binding, activeEncounter: run.activeEncounter, playerName, token });
                if (!validation.ok) return { status: 409, body: { error: `Hollow Gate pet settlement rejected: ${validation.reason}.` } };
                if (!petReceipt) return { status: 400, body: { error: 'A server-verified Hollow Hound pet result is required.' } };
                const verifiedPetResult = await kv.get<HollowGatePetResultReceipt>(`hg-pet-result:${playerName}:${petReceipt}`);
                if (!verifiedPetResult || verifiedPetResult.playerName !== playerName || verifiedPetResult.runId !== runId) {
                    return { status: 409, body: { error: 'The Hollow Hound pet result is invalid, expired, or belongs to another encounter.' } };
                }
                won = verifiedPetResult.outcome === 'win';
                petDefeat = !won;
                petIds = Array.isArray(verifiedPetResult.playerPetIds) ? verifiedPetResult.playerPetIds : [];
            } else if (binding.combatMode === 'pve') {
                const validation = validateHollowGatePveClaim({ binding, activeEncounter: run.activeEncounter, playerName, token });
                if (!validation.ok) return { status: 409, body: { error: `Hollow Gate settlement rejected: ${validation.reason}.` } };
                if (!claimedOutcome) return { status: 400, body: { error: 'Missing normal PvE combat outcome.' } };
                if (claimedOutcome === 'fled' && run.chosenAugmentId === 'berserkers-gamble') {
                    return { status: 409, body: { error: "Berserker's Gamble seals retreat until the final Hollow Hound falls." } };
                }
                won = claimedOutcome === 'win';
                escaped = claimedOutcome === 'fled';
                survivingHp = claimedSurvivingHp;
            } else {
                const validation = validateHollowGateCombatSession({ binding, session, activeEncounter: run.activeEncounter, playerName, token });
                if (!validation.ok) return { status: 409, body: { error: `Hollow Gate settlement rejected: ${validation.reason}.` } };
                won = session!.winner === 'squad';
                const survivingActor = session!.actors.find((actor) => actor.side === 'squad' && actor.ownerSlug === playerName);
                survivingHp = Math.max(0, Math.floor(Number(survivingActor?.hp) || 0));
                await settleConsumedItemsForMember({ session: session!, slug: playerName });
            }
            const revived = !won && !escaped && !petDefeat && binding.secondWindArmed === true;
            const saveKey = `save:${playerName}`;
            const banked = await withKvLock(saveKey, async () => {
                const record = await kv.get<Record<string, unknown>>(saveKey);
                const char = record?.character as Record<string, unknown> | undefined;
                if (!record || !char) return null;
                const existing = await kv.get<CombatReceipt>(receiptKey);
                if (existing) return { receipt: existing, character: char, saveVersion: Number(record._saveVersion ?? 0) };

                const reward = won ? hollowGateCombatReward(binding!.floor, binding!.kind, char.profession) : hollowGateCombatReward(binding!.floor, binding!.kind, undefined);
                if (!won) {
                    for (const key of Object.keys(reward) as Array<keyof HollowGateCombatReward>) reward[key] = 0;
                }
                const elementalShards = won && binding!.kind === 'boss'
                    && randomInt(0, 10_000) < Math.floor(Math.min(0.8, 0.5 + binding!.floor * 0.03) * 10_000) ? 1 : 0;
                const receipt: CombatReceipt = { won, revived, escaped, petDefeat, reward, elementalShards, settledAt: Date.now() };
                const placed = await kv.set(receiptKey, receipt, { nx: true, ex: COMBAT_RECEIPT_TTL_SECONDS });
                if (!placed) {
                    const raced = await kv.get<CombatReceipt>(receiptKey);
                    return { receipt: raced ?? receipt, character: char, saveVersion: Number(record._saveVersion ?? 0) };
                }

                let next = { ...char } as Record<string, unknown>;
                if (binding!.combatMode === 'pet' && petIds.length) {
                    const pets = Array.isArray(next.pets) ? next.pets as Array<Record<string, unknown>> : [];
                    next.pets = pets.map((pet) => petIds.includes(String(pet?.id ?? '')) && pet.loadout && typeof pet.loadout === 'object'
                        ? { ...pet, loadout: { ...(pet.loadout as Record<string, unknown>), consumable: undefined } }
                        : pet);
                }
                if (won) {
                    next = gainXp(next, reward.xp) as Record<string, unknown>;
                    next.hp = binding!.combatMode === 'pet'
                        ? Math.max(1, Math.min(Math.floor(num(next.maxHp) || 1), Math.floor(num(next.hp) || 1)))
                        : hollowGatePostWinHp(next.maxHp, survivingHp, binding!.kind);
                    next.ryo = num(next.ryo) + reward.ryo;
                    next.auraDust = num(next.auraDust) + reward.auraDust;
                    next.honorSeals = num(next.honorSeals) + reward.honorSeals;
                    next.boneCharms = num(next.boneCharms) + reward.boneCharms;
                    next.fateShards = num(next.fateShards) + reward.fateShards;
                    next.hollowShards = num(next.hollowShards) + reward.hollowShards;
                    next.itemStacks = addCountedItem(next.itemStacks, HG_FRAGMENT_ID, reward.fragments);
                    next.itemStacks = addCountedItem(next.itemStacks, VEIL_OF_THE_HOLLOW_ID, reward.veils);
                    next.itemStacks = addCountedItem(next.itemStacks, ELEMENTAL_SHARD_ID, elementalShards);
                    if (binding!.kind === 'boss') next.hollowGateWardenKills = num(next.hollowGateWardenKills) + 1;
                    if (next.hollowGateRun && typeof next.hollowGateRun === 'object') {
                        const nextRun = { ...(next.hollowGateRun as Record<string, unknown>) };
                        delete nextRun.activeCombat;
                        next.hollowGateRun = nextRun;
                    }
                } else if (petDefeat) {
                    const savedRun = next.hollowGateRun && typeof next.hollowGateRun === 'object'
                        ? next.hollowGateRun as Record<string, unknown>
                        : {};
                    const recoil = Math.max(1, Math.floor(num(next.maxHp) * 0.20));
                    next = {
                        ...next,
                        hp: Math.max(1, Math.floor(num(next.hp)) - recoil),
                        hospitalized: false,
                        hollowGateRun: { ...savedRun, threat: 0, activeCombat: undefined },
                    };
                } else if (escaped) {
                    const savedRun = next.hollowGateRun && typeof next.hollowGateRun === 'object'
                        ? next.hollowGateRun as Record<string, unknown>
                        : {};
                    next = {
                        ...next,
                        hp: Math.min(
                            Math.max(1, Math.floor(num(next.hp) || 1)),
                            Math.max(1, Math.floor(survivingHp || 1)),
                        ),
                        hospitalized: false,
                        hollowGateRun: { ...savedRun, threat: 0, activeCombat: undefined },
                    };
                } else if (revived) {
                    const savedRun = next.hollowGateRun && typeof next.hollowGateRun === 'object'
                        ? next.hollowGateRun as Record<string, unknown>
                        : {};
                    next = {
                        ...next,
                        hp: Math.max(1, Math.floor(num(next.maxHp) * 0.5)),
                        hospitalized: false,
                        hospitalizedAt: 0,
                        hospitalizedUntil: 0,
                        hollowGateRun: { ...savedRun, secondWindArmed: false, threat: 0, activeCombat: undefined },
                    };
                } else {
                    const now = Date.now();
                    // Preserve the shipped death rule: retain 50% of positive
                    // run gains, never refund an in-run spend below the entry
                    // snapshot, then close the run and hospitalize the player.
                    for (const key of ['ryo', 'auraDust', 'auraStones', 'boneCharms', 'fateShards', 'honorSeals', 'hollowShards']) {
                        const current = Math.max(0, num(next[key]));
                        const entry = Math.max(0, num(run.entryCurrencies[key as keyof typeof run.entryCurrencies]));
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
                    const updated: Record<string, unknown> = bumpSaveVersion({ ...record, character: next });
                    await kv.set(saveKey, mergePreservingImages(updated, record));
                    return { receipt, character: next, saveVersion: Number(updated._saveVersion ?? 0) };
                } catch (error) {
                    await kv.del(receiptKey).catch(() => undefined);
                    throw error;
                }
            }, { failClosed: true, ttlSec: 10 });
            if (!banked) return { status: 404, body: { error: 'Player save not found.' } };

            await persistRunCombatSettlement(runKey, run, binding, banked.receipt);

            return { status: 200, body: {
                ok: true,
                won,
                revived,
                escaped,
                petDefeat,
                reward: banked.receipt.reward,
                elementalShards: banked.receipt.elementalShards,
                character: banked.character,
                _saveVersion: banked.saveVersion,
            } };
        }, { failClosed: true, ttlSec: 15 });

        return res.status(result.status).json(result.body);
    } catch (err) {
        console.error('[hollow-gate/combat-settle]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
