import { randomInt, randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { cors, mergePreservingImages, safeName } from '../_utils.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { hollowGateRunKey, hollowShardDrop, itemStackCount, rewardMultiplierForToken, HG_CLAWBACK_KEYS, type HollowGateRunToken, type HgCurrencyKey } from './_run-token.js';
import {
    HOLLOW_GATE_LEDGER_ITEM_IDS,
    creditHollowGateLedger,
    hollowGateDeathRetention,
    normalizeHollowGateLedger,
    multiplyHollowGateCurrencyCredit,
    reconcileLedgerAmount,
    setCountedItem,
    type HollowGateRewardCredit,
} from './_ledger.js';
import { rollHollowLockedDoor, type HollowLockedDoorResult } from './_locked-door.js';
import { hollowGateManifestNode, hollowGatePositionNodeId } from './_floor-manifest.js';

type HollowGateEventAction =
    | 'shrine'
    | 'chest'
    | 'shard-vein'
    | 'trap'
    | 'hidden-tablet'
    | 'hidden-relic'
    | 'locked-door'
    | 'keeper-heal'
    | 'keeper-torch'
    | 'keeper-key';

type EventRoll = {
    action: HollowGateEventAction;
    credit: HollowGateRewardCredit;
    keyDelta?: number;
    torchDelta?: number;
    lockedResult?: HollowLockedDoorResult & { petToken?: string };
};

const HOSPITAL_DURATION_MS = 60_000;
const EVENT_RECEIPT_TTL_SECONDS = 8 * 24 * 60 * 60;

const whole = (value: unknown): number => Math.max(0, Math.floor(Number(value) || 0));

export function hollowGateEventNeedsSaveRecovery(
    alreadyResolved: boolean,
    appliedIds: readonly unknown[],
    sourceId: string,
): boolean {
    return alreadyResolved && !appliedIds.includes(sourceId);
}

function isAction(value: unknown): value is HollowGateEventAction {
    return value === 'shrine' || value === 'chest' || value === 'shard-vein' || value === 'trap'
        || value === 'hidden-tablet' || value === 'hidden-relic'
        || value === 'locked-door'
        || value === 'keeper-heal' || value === 'keeper-torch' || value === 'keeper-key';
}

function parseNodeId(value: unknown, floor: number): { nodeId: string; index: number } | null {
    const nodeId = String(value ?? '').slice(0, 96);
    const match = /^floor:(\d{1,2}):tile:(\d{1,5})$/.exec(nodeId);
    if (!match || Number(match[1]) !== floor) return null;
    const index = Number(match[2]);
    return Number.isInteger(index) && index >= 0 && index < 31 * 21 ? { nodeId, index } : null;
}

function maxEvents(action: HollowGateEventAction, floor: number): number {
    if (action === 'chest') return 3;
    if (action === 'shard-vein') return 1 + Math.floor(floor / 2);
    if (action === 'trap') return 3 + Math.floor(floor / 2);
    if (action === 'locked-door') return 1;
    return 1;
}

function rollEvent(action: HollowGateEventAction, floor: number, profession: unknown): EventRoll {
    if (action === 'shrine') return { action, credit: {}, torchDelta: 10 };
    if (action === 'chest') {
        return {
            action,
            credit: { currencies: {
                ryo: randomInt(110, 310),
                auraDust: randomInt(0, 10) < 4 ? randomInt(5, 13) : 0,
                auraStones: randomInt(1, 11),
                boneCharms: randomInt(5, 16),
                hollowShards: hollowShardDrop(floor, 'chest'),
            } },
            keyDelta: randomInt(0, 10) < 3 ? 1 : 0,
            torchDelta: 2,
        };
    }
    if (action === 'shard-vein') {
        return { action, credit: { currencies: { hollowShards: hollowShardDrop(floor, 'shardVein') } } };
    }
    if (action === 'hidden-tablet') {
        return { action, credit: { currencies: { auraDust: randomInt(18, 38) } } };
    }
    if (action === 'hidden-relic') {
        const rawHonor = randomInt(15, 35);
        return { action, keyDelta: 1, credit: {
            currencies: {
                honorSeals: profession === 'vanguard' ? rawHonor : 0,
                boneCharms: Math.max(1, Math.floor(rawHonor / 8)),
                fateShards: (randomInt(0, 2) === 0 ? 1 : 0) + Math.floor(rawHonor / 25),
            },
            items: { 'veil-of-the-hollow': 1 },
        } };
    }
    if (action === 'locked-door') throw new Error('Locked-door rolls require the persisted pet-token path.');
    return { action, credit: {}, ...(action === 'keeper-key' ? { keyDelta: 1 } : {}), ...(action === 'keeper-torch' ? { torchDelta: 10 } : {}) };
}

function addCredit(character: Record<string, unknown>, credit: HollowGateRewardCredit): Record<string, unknown> {
    let next = { ...character };
    for (const [key, value] of Object.entries(credit.currencies ?? {}) as Array<[HgCurrencyKey, unknown]>) {
        next[key] = whole(next[key]) + whole(value);
    }
    for (const [itemId, value] of Object.entries(credit.items ?? {})) {
        const count = itemStackCount(next.itemStacks, itemId) + whole(value);
        next.itemStacks = setCountedItem(next.itemStacks, itemId, count);
    }
    return next;
}

function reconcileDeath(character: Record<string, unknown>, run: HollowGateRunToken): Record<string, unknown> {
    const ledger = normalizeHollowGateLedger(run);
    const retention = hollowGateDeathRetention(character);
    let next = { ...character };
    for (const key of HG_CLAWBACK_KEYS) {
        next[key] = reconcileLedgerAmount(next[key], run.entryCurrencies[key], ledger.currencies[key], retention);
    }
    for (const itemId of HOLLOW_GATE_LEDGER_ITEM_IDS) {
        const current = itemStackCount(next.itemStacks, itemId);
        const entry = run.entryItems ? whole(run.entryItems[itemId]) : current;
        next.itemStacks = setCountedItem(next.itemStacks, itemId, reconcileLedgerAmount(current, entry, ledger.items[itemId], 1));
    }
    const now = Date.now();
    return {
        ...next,
        hp: 0,
        hospitalized: true,
        hospitalizedAt: now,
        hospitalizedUntil: now + HOSPITAL_DURATION_MS,
        hollowGateRun: null,
    };
}

/** Resolve one non-combat Hollow Gate event from a run-bound node identity. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const token = String(body.token ?? '').slice(0, 64);
        const action = body.action;
        if (!playerName || !token || !isAction(action)) return res.status(400).json({ error: 'Invalid Hollow Gate event.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your run.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'hollow-gate-event', 60, 60_000, identity.name))) return;

        const runKey = hollowGateRunKey(playerName, token);
        const result = await withKvLock(runKey, async () => {
            const run = await kv.get<HollowGateRunToken>(runKey);
            if (!run || run.playerName !== playerName) return { status: 409, body: { error: 'The Hollow Gate run has expired.' } };
            if (!run.chosenAugmentId) return { status: 409, body: { error: 'Choose the sealed augment before resolving events.' } };
            if (run.activeEncounter) return { status: 409, body: { error: 'Finish the active encounter first.' } };
            const floor = Math.max(1, Math.floor(Number(run.currentFloor) || 1));
            const parsedNode = parseNodeId(body.nodeId, floor);
            if (!parsedNode) return { status: 409, body: { error: 'The event node does not match the sealed floor.' } };
            const group = action.startsWith('keeper-') ? 'keeper' : action;
            const sourceId = `event:${floor}:${group}:${parsedNode.nodeId}`;
            const resolved = Array.isArray(run.resolvedEventIds) ? run.resolvedEventIds : [];
            const alreadyResolved = resolved.includes(sourceId);
            const sameKindCount = resolved.filter((id) => id.startsWith(`event:${floor}:${group}:`)).length;
            if (!alreadyResolved && sameKindCount >= maxEvents(action, floor)) {
                return { status: 429, body: { error: 'That event type is exhausted on this floor.' } };
            }

            const saveKey = `save:${playerName}`;
            const receiptKey = `hg-event-roll:${playerName}:${token}:${sourceId}`;
            const currentRecord = await kv.get<Record<string, unknown>>(saveKey);
            const currentChar = currentRecord?.character as Record<string, unknown> | undefined;
            if (!currentRecord || !currentChar) return { status: 404, body: { error: 'Player save not found.' } };
            const appliedEventIds = Array.isArray(currentChar.settledHollowGateEventIds)
                ? currentChar.settledHollowGateEventIds as unknown[]
                : [];
            const recoveringSave = hollowGateEventNeedsSaveRecovery(alreadyResolved, appliedEventIds, sourceId);
            const expectedKind = action === 'chest' ? 'chest'
                : action === 'shard-vein' ? 'shard_vein'
                    : action === 'trap' ? 'trap'
                        : action === 'locked-door' ? 'locked'
                            : action === 'shrine' || action.startsWith('hidden-') ? 'shrine'
                                : 'npc';
            const manifest = run.floorManifests?.[String(floor)];
            if (!alreadyResolved && (hollowGatePositionNodeId(manifest, run.position) !== parsedNode.nodeId
                || hollowGateManifestNode(manifest, parsedNode.nodeId) !== expectedKind)) {
                return { status: 409, body: { error: 'The event node does not match the sealed shrine floor.' } };
            }
            if (!alreadyResolved && action === 'locked-door' && whole(run.keys) < 1) {
                return { status: 409, body: { error: 'A Shrine Key is required.' } };
            }
            if (!alreadyResolved && action === 'keeper-heal' && run.chosenAugmentId === 'treasure-sense') {
                return { status: 409, body: { error: 'Treasure Sense has sealed the Keeper healing rite.' } };
            }
            let roll = await kv.get<EventRoll>(receiptKey);
            if (!roll) {
                let candidate: EventRoll;
                if (action === 'locked-door') {
                    const unit = () => randomInt(1_000_000_000) / 1_000_000_000;
                    const lockedResult: NonNullable<EventRoll['lockedResult']> = rollHollowLockedDoor(unit, Date.now(), floor);
                    if (lockedResult.outcome === 'pet' && lockedResult.pet) lockedResult.petToken = randomUUID().replace(/-/g, '');
                    const loot = lockedResult.loot;
                    candidate = {
                        action,
                        keyDelta: -1,
                        lockedResult,
                        credit: lockedResult.outcome === 'chest' && loot ? { currencies: {
                            ryo: loot.ryo ?? 0,
                            auraDust: loot.auraDust ?? 0,
                            auraStones: loot.auraStones ?? 0,
                            boneCharms: loot.boneCharms ?? 0,
                            fateShards: loot.fateShards ?? 0,
                            hollowShards: loot.hollowShards,
                        } } : {},
                    };
                } else {
                    candidate = rollEvent(action, floor, currentChar.profession);
                }
                candidate.credit = multiplyHollowGateCurrencyCredit(candidate.credit, rewardMultiplierForToken(run));
                const placed = await kv.set(receiptKey, candidate, { nx: true, ex: EVENT_RECEIPT_TTL_SECONDS });
                roll = placed ? candidate : await kv.get<EventRoll>(receiptKey);
            }
            if (!roll || roll.action !== action) return { status: 409, body: { error: 'The event receipt does not match this action.' } };
            if (alreadyResolved && !recoveringSave) {
                if (!currentChar.hollowGateRun) await kv.del(runKey).catch(() => undefined);
                return { status: 200, body: {
                    ok: true,
                    alreadyReported: true,
                    reward: roll.credit,
                    lockedResult: roll.lockedResult,
                    character: currentChar,
                    runState: { keys: whole(run.keys), torch: whole(run.torch), threat: whole(run.threat), secondWindArmed: run.secondWindArmed === true },
                    _saveVersion: Number(currentRecord._saveVersion ?? 0),
                } };
            }
            if (roll.lockedResult?.outcome === 'pet' && roll.lockedResult.pet && roll.lockedResult.petToken) {
                await kv.set(`pet-encounter:${playerName}:${roll.lockedResult.petToken}`, {
                    playerName,
                    pet: roll.lockedResult.pet,
                    mintedAt: Date.now(),
                }, { ex: 20 * 60, nx: true });
            }

            const saved = await withKvLock(saveKey, async () => {
                const record = await kv.get<Record<string, unknown>>(saveKey);
                const character = record?.character as Record<string, unknown> | undefined;
                if (!record || !character) return null;
                const credited = creditHollowGateLedger(run, sourceId, roll!.credit);
                let nextRun: HollowGateRunToken = {
                    ...run,
                    rewardLedger: credited.ledger,
                    serverCreditedCurrencies: credited.ledger.currencies,
                    keys: alreadyResolved
                        ? whole(run.keys)
                        : Math.max(0, whole(run.keys) + Math.floor(Number(roll!.keyDelta) || 0)),
                    torch: alreadyResolved
                        ? whole(run.torch)
                        : roll!.action === 'keeper-torch' || roll!.action === 'shrine'
                            ? 10
                            : Math.max(0, Math.min(10, whole(run.torch) + whole(roll!.torchDelta))),
                    resolvedEventIds: alreadyResolved ? resolved : [...resolved, sourceId].slice(-512),
                };
                let next = addCredit(character, roll!.credit);
                let damage = 0;
                let revived = false;
                let ended = false;
                if (action === 'keeper-heal') {
                    const heal = Math.floor(whole(next.maxHp) * 0.33);
                    next.hp = Math.min(whole(next.maxHp), whole(next.hp) + heal);
                } else if (action === 'trap' || (action === 'locked-door' && roll!.lockedResult?.outcome === 'trap')) {
                    damage = Math.max(1, Math.floor(whole(next.maxHp) * 0.33));
                    const afterDamage = Math.max(0, whole(next.hp) - damage);
                    if (afterDamage <= 0 && nextRun.secondWindArmed) {
                        revived = true;
                        nextRun = { ...nextRun, secondWindArmed: false };
                        next.hp = Math.max(1, Math.floor(whole(next.maxHp) * 0.5));
                        next.hospitalized = false;
                    } else if (afterDamage <= 0) {
                        ended = true;
                        next = reconcileDeath(next, nextRun);
                    } else {
                        next.hp = afterDamage;
                    }
                }
                const savedRun = next.hollowGateRun && typeof next.hollowGateRun === 'object'
                    ? next.hollowGateRun as Record<string, unknown>
                    : null;
                if (!ended && savedRun) {
                    next.hollowGateRun = {
                        ...savedRun,
                        keys: nextRun.keys,
                        torch: nextRun.torch,
                        threat: nextRun.threat,
                        secondWindArmed: nextRun.secondWindArmed === true,
                    };
                }
                const settledEventIds = Array.isArray(next.settledHollowGateEventIds)
                    ? (next.settledHollowGateEventIds as unknown[]).filter((id): id is string => typeof id === 'string')
                    : [];
                next.settledHollowGateEventIds = [...settledEventIds.filter((id) => id !== sourceId).slice(-511), sourceId];
                await kv.set(runKey, nextRun);
                try {
                    const updated = bumpSaveVersion({ ...record, character: next }) as Record<string, unknown>;
                    await kv.set(saveKey, mergePreservingImages(updated, record));
                    if (ended) await kv.del(runKey).catch(() => undefined);
                    return { character: next, run: nextRun, damage, revived, ended, saveVersion: Number(updated._saveVersion ?? 0) };
                } catch (error) {
                    await kv.set(runKey, run).catch(() => undefined);
                    throw error;
                }
            }, { failClosed: true, ttlSec: 10 });
            if (!saved) return { status: 404, body: { error: 'Player save not found.' } };
            return { status: 200, body: {
                ok: true,
                action,
                reward: roll.credit,
                lockedResult: roll.lockedResult,
                damage: saved.damage,
                revived: saved.revived,
                ended: saved.ended,
                character: saved.character,
                runState: { keys: whole(saved.run.keys), torch: whole(saved.run.torch), threat: whole(saved.run.threat), secondWindArmed: saved.run.secondWindArmed === true },
                _saveVersion: saved.saveVersion,
            } };
        }, { failClosed: true, ttlSec: 15 });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('[hollow-gate/event]', error);
        return res.status(500).json({ error: 'The Hollow Gate event could not be sealed.' });
    }
}
