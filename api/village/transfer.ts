import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { cors, parseJsonBody, safeName } from '../_utils.js';
import { LockContendedError, withKvLock } from '../_lock.js';
import { battleLockedFor, isIncapacitated } from '../_elapsed-state.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { appendSettlementReceipt, inspectSettlementReceipt, parseSettlementRequestId } from '../_settlement-receipts.js';
import { isTransferVillage, VILLAGE_TRANSFER_SCROLL_ID, villageTransferUnlockError } from '../../shared/village-transfer.js';
import { readVillageUpgrades, VILLAGE_UPGRADE_KEYS } from './_upgrade.js';
import { elderVillageKey } from './_elders.js';
import { elderCouncilKey } from './_elder-council.js';
import { invalidateProcCache } from '../_proc-cache.js';
import { safeLogValue } from '../_safe-log.js';

/** Remove old appointments so returning later does not restore an abandoned seat. */
async function clearAppointments(village: string, playerName: string) {
    const clear = (seats: unknown) => Array.isArray(seats)
        ? seats.map(name => safeName(String(name ?? '')) === playerName ? '' : name) : seats;
    await withKvLock(elderCouncilKey(village), async () => {
        const council = await kv.get<Record<string, unknown>>(elderCouncilKey(village));
        if (council) await kv.set(elderCouncilKey(village), { ...council, seats: clear(council.seats) });
    }, { failClosed: true });
    await withKvLock(elderVillageKey(village), async () => {
        const state = await kv.get<Record<string, unknown>>(elderVillageKey(village));
        if (state) await kv.set(elderVillageKey(village), {
            ...state, elderAppointees: clear(state.elderAppointees), anbuAppointees: clear(state.anbuAppointees),
        });
    }, { failClosed: true });
    invalidateProcCache('game-state:frame');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    res.setHeader('Cache-Control', 'private, no-store');
    try {
        const parsed = parseJsonBody(req.body);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const body = parsed.body as Record<string, unknown> | null;
        const playerName = safeName(String(body?.playerName ?? ''));
        const fromVillage = body?.fromVillage;
        const village = body?.village;
        const requestId = parseSettlementRequestId(body?.requestId);
        if (!playerName || !requestId || !isTransferVillage(fromVillage) || !isTransferVillage(village) || village === fromVillage) {
            return res.status(400).json({ error: 'Choose a different village and a valid transfer request.' });
        }
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'You can only transfer your own character.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'village-transfer', 10, 60_000, identity.name))) return;

        // Matches succession's lock order: Kage first, then the player save.
        // This prevents installing the outgoing player as Kage during transfer.
        const key = `village:kage:${fromVillage.toLowerCase().replace(/\s+/g, '-')}`;
        const result = await withKvLock(`village-transfer:${playerName}`, async () => {
            // Complete interrupted cleanup before returning to a former village.
            // No save lock is held while taking shared village/council locks.
            const snapshot = await kv.get<{ character?: Record<string, unknown> }>(`save:${playerName}`);
            const priorReceipts = snapshot?.character?.serverSettlementReceipts;
            const pendingVillages = new Set<string>();
            for (const receipt of Array.isArray(priorReceipts) ? priorReceipts : []) {
                const oldVillage = receipt?.value?.fromVillage;
                if (receipt?.value?.kind === 'village-transfer' && isTransferVillage(oldVillage) && oldVillage !== snapshot?.character?.village) pendingVillages.add(oldVillage);
            }
            for (const oldVillage of pendingVillages) await clearAppointments(oldVillage, playerName);
            return await withKvLock(key, async () => {
                const transfer = await mutatePlayerSave(playerName, async ({ character, record }) => {
                    const fingerprint = `village-transfer:${fromVillage}:${village}`;
                    const inspected = inspectSettlementReceipt(character, requestId, fingerprint);
                    if (inspected.status === 'replay') return { ok: true as const, character, value: { replayed: true }, write: false };
                    if (inspected.status !== 'fresh') return { ok: false as const, status: 409, error: 'Transfer request conflicts with a previous action.' };
                    if (character.village !== fromVillage) return { ok: false as const, status: 409, error: 'Your village changed. Refresh before transferring again.' };
                    const locked = villageTransferUnlockError(character);
                    if (locked) return { ok: false as const, status: 403, error: locked };
                    const inventory = Array.isArray(character.inventory) ? [...character.inventory] : [];
                    const itemStacks = Array.isArray(character.itemStacks) ? [...character.itemStacks] : [];
                    const scrollIndex = inventory.indexOf(VILLAGE_TRANSFER_SCROLL_ID);
                    const scrollStackIndex = itemStacks.findIndex(stack => stack?.itemId === VILLAGE_TRANSFER_SCROLL_ID
                        && Number.isSafeInteger(Number(stack.count)) && Number(stack.count) > 0);
                    if (scrollIndex < 0 && scrollStackIndex < 0) return { ok: false as const, status: 409, error: 'Buy a Village Transfer Scroll in the Grand Marketplace first.' };
                    if (await battleLockedFor(playerName) || isIncapacitated(character) || character.hollowGateRun || record.activeTraining || record.activeJutsuTraining) {
                        return { ok: false as const, status: 409, error: 'Finish your battle, training, or Hollow Gate run and recover from the hospital before transferring.' };
                    }
                    if (await kv.get(`guard:${playerName}`)) return { ok: false as const, status: 409, error: 'Leave village guard duty before transferring.' };
                    const kage = await kv.get<{ seatedKage?: string; challenge?: { challenger?: string } }>(key);
                    if (safeName(kage?.seatedKage ?? '') === playerName) return { ok: false as const, status: 409, error: 'Hand over your Kage seat at the Town Hall before transferring.' };
                    if (safeName(kage?.challenge?.challenger ?? '') === playerName) return { ok: false as const, status: 409, error: 'Resolve your Kage challenge before transferring.' };

                    const destination = await kv.get<Record<string, unknown>>(elderVillageKey(village));
                    const upgrades = readVillageUpgrades(destination);
                    if (scrollIndex >= 0) inventory.splice(scrollIndex, 1);
                    else {
                        const count = Number(itemStacks[scrollStackIndex].count) - 1;
                        if (count === 0) itemStacks.splice(scrollStackIndex, 1);
                        else itemStacks[scrollStackIndex] = { ...itemStacks[scrollStackIndex], count };
                    }
                    const next = {
                        ...character, inventory, itemStacks, village,
                        storyVillage: character.storyVillage || fromVillage,
                        elderFocus: undefined,
                        villageMerit: 0,
                        guardQueued: false,
                        // Explicit zeroes stop the save's recursive merge retaining old bonuses.
                        villageUpgrades: Object.fromEntries(VILLAGE_UPGRADE_KEYS.map(id => [id, upgrades[id] ?? 0])),
                    };
                    return {
                        ok: true as const,
                        character: appendSettlementReceipt(next, inspected.receipts, {
                            requestId, fingerprint, settledAt: Date.now(),
                            value: { kind: 'village-transfer', fromVillage, village },
                        }),
                        value: { replayed: false },
                    };
                });
                // The saved receipt makes cleanup retryable if a storage failure follows
                // the atomic scroll + membership write. A replay never spends another scroll.
                if (transfer.ok && transfer.character.village !== fromVillage) await clearAppointments(fromVillage, playerName);
                return transfer;
            }, { failClosed: true, ttlSec: 30 });
        }, { failClosed: true, ttlSec: 30 });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) {
        if (error instanceof LockContendedError) return res.status(503).json({ error: 'Village transfer is busy. Please retry the same transfer.' });
        console.error('[village/transfer]', safeLogValue(error));
        return res.status(503).json({ error: 'The transfer could not be confirmed. Retry the same transfer to recover it safely.' });
    }
}
