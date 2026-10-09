import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, parseJsonBody } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { onlineStore } from '../_realtime/online-store.js';
import { resourceNode } from '../../shared/resource-nodes.js';
import { readResourceGathering } from '../../shared/resource-gathering.js';
import { reserveEconomyTx, markEconomyTx, completeEconomyTx, failEconomyTx, economyTxKey, type EconomyTxRecord } from '../_economy-tx.js';
import { kv } from '../_storage.js';
import { refineResource } from './_resource-refine.js';
import { reserveResourcePool, finishResourcePool } from './_resource-pool.js';
import { loadSectorPoolOwner, sectorPoolKey } from './_sector-pool.js';
import { villageStoresEnabled } from '../_release-flags.js';
import { resourcePositionError, resourceAdmissionError, mintResourceSeal, admitResourceAttempt,
    resolveResourceAttempt, equipGatheringTool, type ResourceSeal } from './_resource-gathering.js';
import { safeLogValue } from '../_safe-log.js';
import { battleLockedFor } from '../_elapsed-state.js';
const resourceTxId = (name: string, id: string) => `resource-gathering:${createHash('sha256').update(`${name}:${id}`).digest('hex')}`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    const parsed = parseJsonBody(req.body); if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    if (!parsed.body || typeof parsed.body !== 'object' || Array.isArray(parsed.body)) return res.status(400).json({ error: 'Expected an Outpost action.' });
    const body = parsed.body as Record<string, unknown>;
    const identity = await authedPlayerOrAdmin(req);
    if (!identity || identity.admin) return res.status(401).json({ error: 'Player authentication required.' });
    if (!(await enforceRateLimitKv(req, res, 'world-resource', 90, 60_000, identity.name))) return;
    const action = body.action;
    if (!['status', 'start', 'resolve', 'cancel', 'equip', 'refine'].includes(String(action))) return res.status(400).json({ error: 'Unknown Outpost action.' });
    const id = typeof body.requestId === 'string' ? body.requestId : '';
    if (action !== 'status' && action !== 'equip' && !/^[A-Za-z0-9_-]{16,80}$/.test(id)) return res.status(400).json({ error: 'A valid attempt ID is required.' });
    const node = resourceNode(body.nodeId);
    if (action === 'start' && (!node || !['active', 'relaxed'].includes(String(body.mode)))) return res.status(400).json({ error: 'Choose a valid node and gathering mode.' });
    const now = Date.now();
    let journal: EconomyTxRecord | undefined;
    let refunded = false;
    try {
        const poolEnabled = villageStoresEnabled();
        const owner = action === 'start' && node && poolEnabled ? await loadSectorPoolOwner(node.sector) : { ownerVillage: undefined };
        const result = await mutatePlayerSave<Record<string, unknown>>(identity.name, async ({ character }) => {
            if ((action === 'start' || action === 'resolve') && await battleLockedFor(identity.name))
                return { ok: false, status: 409, error: 'Resolve your active battle before gathering.' };
            let current = character;
            let state = readResourceGathering(current.resourceGathering);
            const activeJournal = state.active ? await kv.get<EconomyTxRecord>(economyTxKey(resourceTxId(identity.name, state.active.id))) : null;
            const activeSeal = activeJournal?.meta?.seal as ResourceSeal | undefined;
            if (state.active && (action === 'status' || action === 'start')) {
                const active = state.active, activeNode = resourceNode(active.nodeId)!;
                const player = onlineStore.get(identity.name);
                if (now >= active.expiresAt || resourcePositionError(player, activeNode)
                    || !activeSeal || (player ? player.movementSeq ?? 0 : -1) !== active.movementSequence || (player ? player.resourceEpoch ?? 0 : -1) !== activeSeal.authorityEpoch) {
                    const closed = resolveResourceAttempt(current, active.id, { cancel: true }, player, now, activeSeal);
                    if (closed.ok) { current = closed.character; state = readResourceGathering(current.resourceGathering); }
                }
            }
            if (action === 'status') return { ok: true, character: current, write: current !== character, value: {} };
            if (action === 'refine') {
                const refined = refineResource(current, body.itemId, body.quantity, id, now);
                return refined.ok ? { ok: true, character: refined.character, write: !refined.replayed, value: { refined: refined.value, replayed: refined.replayed } }
                    : { ok: false, status: 409, error: refined.error };
            }
            if (action === 'equip') {
                const equipped = equipGatheringTool(current, body.itemId, body.unequip);
                return equipped ? { ok: true, character: equipped, value: {} }
                    : { ok: false, status: 409, error: 'Finish gathering first, then equip an owned, usable tool.' };
            }
            if (action === 'resolve' || action === 'cancel') {
                const resolved = resolveResourceAttempt(current, id, { cancel: action === 'cancel', placements: body.placements, events: body.events }, onlineStore.get(identity.name), now, activeSeal);
                if (!resolved.ok) return { ok: false, status: 409, error: resolved.error };
                return { ok: true, character: resolved.character, write: !resolved.replayed,
                    value: { receipt: resolved.receipt, replayed: resolved.replayed } };
            }
            if (!node) return { ok: false, status: 400, error: 'Unknown node.' };
            const fingerprint = `${node.id}:${body.mode}`;
            const txId = resourceTxId(identity.name, id);
            if (state.active?.id === id || state.receipts.some(receipt => receipt.id === id)) {
                const savedJournal = await kv.get<EconomyTxRecord>(economyTxKey(txId));
                if (savedJournal?.meta?.fingerprint !== fingerprint) return { ok: false, status: 409, error: 'This attempt ID belongs to another action.' };
                const sealedStart = savedJournal.meta.seal as ResourceSeal;
                if (savedJournal.meta.poolEnabled) await finishResourcePool(node.sector, sealedStart.startedAt, txId, true);
                await completeEconomyTx(txId);
                return { ok: true, character: current, write: current !== character,
                    value: { attempt: state.active?.id === id ? state.active : undefined, receipt: state.receipts.find(r => r.id === id), replayed: true } };
            }
            const player = onlineStore.get(identity.name);
            const error = resourcePositionError(player, node) || resourceAdmissionError(current, node, now);
            if (error || !player) return { ok: false, status: 409, error: error ?? 'Connect to the world first.' };
            journal = await reserveEconomyTx({ id: txId, kind: 'resource-gathering', debitKey: sectorPoolKey(node.sector, now),
                creditKey: `save:${identity.name}`, resource: 'explores', amount: 1,
                meta: { fingerprint, nodeId: node.id, playerName: identity.name, poolEnabled,
                    seal: mintResourceSeal(current, node, id, body.mode as 'active' | 'relaxed', player, now) } });
            if (journal.meta?.fingerprint !== fingerprint) return { ok: false, status: 409, error: 'This attempt ID was already used for another action.' };
            if (journal.state === 'complete' || journal.state === 'refunded') return { ok: false, status: 409, error: 'This attempt has already closed. Choose the node again to start another.' };
            const seal = journal.meta?.seal as ResourceSeal, reservedAt = seal.startedAt;
            const usesPool = journal.meta?.poolEnabled === true;
            // A failed admission may be retried after its sealed play window.
            // Retire that uncommitted reservation without charging an attempt
            // that can no longer be played. Admitted IDs recover above instead.
            if (now >= seal.expiresAt) {
                if (usesPool) await finishResourcePool(node.sector, reservedAt, txId, false);
                await markEconomyTx(txId, 'refunded', { note: 'Admission expired before the player save committed; nothing charged.' });
                refunded = true;
                return { ok: false, status: 409, error: 'The attempt expired before it could start. Nothing was spent. Choose the node again.' };
            }
            if (usesPool && !(await reserveResourcePool(node.sector, String(current.village ?? ''), reservedAt, owner, txId))) {
                await markEconomyTx(txId, 'refunded', { note: 'Sector pool exhausted; player was not charged.' });
                return { ok: false, status: 409, error: 'This sector has used its gathering pool today.' };
            }
            await markEconomyTx(txId, 'debit-applied');
            const stillHere = onlineStore.get(identity.name);
            if (resourcePositionError(stillHere, node) || (stillHere ? stillHere.movementSeq ?? 0 : -1) !== seal.movementSequence
                || (stillHere ? stillHere.resourceEpoch ?? 0 : -1) !== seal.authorityEpoch) {
                if (usesPool) await finishResourcePool(node.sector, reservedAt, txId, false);
                await markEconomyTx(txId, 'refunded', { note: 'Player moved before admission; no daily action or tool use spent.' });
                return { ok: false, status: 409, error: 'You moved before gathering started. Return to the node.' };
            }
            const admitted = admitResourceAttempt(current, seal, now);
            if (!admitted) throw new Error('Tool admission failed');
            return { ok: true, character: admitted, value: { attempt: readResourceGathering(admitted.resourceGathering).active },
                onConflict: async () => { if (usesPool) await finishResourcePool(node.sector, reservedAt, txId, false); await markEconomyTx(txId, 'refunded'); refunded = true; },
                onUnconfirmedWrite: async () => { await failEconomyTx(txId, 'Gathering admission write needs confirmation. Retry the same attempt ID.'); },
                afterCommit: async () => { if (usesPool) await finishResourcePool(node.sector, reservedAt, txId, true); await completeEconomyTx(txId); } };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) {
        if (journal && !refunded) await failEconomyTx(journal.id, error).catch(() => {});
        console.error('[world/resource]', safeLogValue(error));
        return res.status(refunded ? 409 : 503).json({ error: refunded
            ? 'The attempt did not start and nothing was spent. Choose the node again.'
            : 'Your attempt is recoverable. Retry with the same attempt ID.' });
    }
}
