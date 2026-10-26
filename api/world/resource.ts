import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, parseJsonBody } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { onlineStore } from '../_realtime/online-store.js';
import { resourceNode, WORLD_BOSS_CRYSTAL_NODES } from '../../shared/resource-nodes.js';
import { readResourceGathering, type ResourceReceipt } from '../../shared/resource-gathering.js';
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
import { applyWorldBossCrystalHarvest, worldBossCrystalCanBeMined } from '../world-boss-event/_crystals.js';
import { readActiveWorldBossEvent } from '../world-boss-event/_event.js';
import { rememberMinedGround } from './_harvest-ground.js';
import { resourceBattleActive } from './_resource-battle.js';
import { withPlayerResourceNodes, reserveSharedResourceNode, finishSharedResourceAdmission,
    sharedResourceClaimHeld, releaseSharedResourceClaim, sharedResourceViews } from './_shared-resource-nodes.js';
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
    if (!['nodes', 'status', 'start', 'resolve', 'cancel', 'equip', 'refine'].includes(String(action))) return res.status(400).json({ error: 'Unknown Outpost action.' });
    const id = typeof body.requestId === 'string' ? body.requestId : '';
    if (action !== 'nodes' && action !== 'status' && action !== 'equip' && !/^[A-Za-z0-9_-]{16,80}$/.test(id)) return res.status(400).json({ error: 'A valid attempt ID is required.' });
    const node = resourceNode(body.nodeId);
    if (action === 'start' && (!node || !['active', 'relaxed'].includes(String(body.mode)))) return res.status(400).json({ error: 'Choose a valid node and gathering mode.' });
    const now = Date.now();
    if (action === 'start' && node?.worldBossCrystal && !(await worldBossCrystalCanBeMined(node.id, now))) {
        return res.status(409).json({ error: 'This crystal seam has already been claimed or the world event has closed.' });
    }
    let journal: EconomyTxRecord | undefined;
    let refunded = false;
    let worldBossHollowShard: Awaited<ReturnType<typeof applyWorldBossCrystalHarvest>> = null;
    try {
        if (action === 'nodes') {
            const player = onlineStore.get(identity.name);
            if (!player || player.locationUnverified) return res.status(409).json({ error: 'Connect to the world before checking nodes.' });
            return res.status(200).json({ ok: true, sector: player.sector, nodes: await sharedResourceViews(player.sector, Date.now()) });
        }
        const poolEnabled = villageStoresEnabled();
        const owner = action === 'start' && node && poolEnabled ? await loadSectorPoolOwner(node.sector) : { ownerVillage: undefined };
        const requestJournal = id ? await kv.get<EconomyTxRecord>(economyTxKey(resourceTxId(identity.name, id))) : null;
        const requestSeal = requestJournal?.meta?.seal as ResourceSeal | undefined;
        const result = await withPlayerResourceNodes(identity.name, [node?.id, requestSeal?.nodeId], assertActive => mutatePlayerSave<Record<string, unknown>>(identity.name, async ({ character }) => {
            assertActive(character);
            const now = Date.now();
            if (action === 'start' || action === 'resolve' || action === 'status') {
                const fighting = await resourceBattleActive(identity.name);
                if (action === 'start' && fighting) return { ok: false, status: 409, error: 'Resolve your active battle before gathering.' };
            }
            if ((action === 'start' || action === 'resolve') && await battleLockedFor(identity.name))
                return { ok: false, status: 409, error: 'Resolve your active battle before gathering.' };
            let current = character;
            let recoveredReceipt: ResourceReceipt | undefined, recoveredNodeId: string | undefined;
            let state = readResourceGathering(current.resourceGathering);
            const activeJournal = state.active || id ? await kv.get<EconomyTxRecord>(economyTxKey(resourceTxId(identity.name, state.active?.id ?? id))) : null;
            const activeSeal = activeJournal?.meta?.seal as ResourceSeal | undefined;
            const claimLost = !!(state.active && activeSeal?.sharedNode
                && !(await sharedResourceClaimHeld(state.active.nodeId, identity.name, state.active.id, Date.now())));
            const release = async () => {
                if (activeSeal?.sharedNode) await releaseSharedResourceClaim(activeSeal.nodeId, identity.name, activeSeal.id);
            };
            const finishReceipt = async (receipt: ResourceReceipt, settledCharacter: Record<string, unknown>) => {
                // Keep the node locked through event credit, including lost-ACK
                // recovery. The request body never selects the credited crystal.
                if (receipt.outcome === 'success' && receipt.worldBossEventId && activeSeal?.id === receipt.id
                    && resourceNode(activeSeal.nodeId)?.worldBossCrystal) {
                    worldBossHollowShard = await applyWorldBossCrystalHarvest(receipt.worldBossEventId, activeSeal.nodeId, {
                        slug: identity.name, name: String(settledCharacter.name ?? identity.name),
                        village: String(settledCharacter.village ?? ''), clan: String(settledCharacter.clan ?? ''),
                    }, Date.now());
                }
                await release();
            };
            if (state.active && (action === 'status' || action === 'start')) {
                const active = state.active, activeNode = resourceNode(active.nodeId)!;
                const player = onlineStore.get(identity.name);
                if (claimLost || now >= active.expiresAt || resourcePositionError(player, activeNode)
                    || !activeSeal || (player ? player.movementSeq ?? 0 : -1) !== active.movementSequence || (player ? player.resourceEpoch ?? 0 : -1) !== activeSeal.authorityEpoch) {
                    const closed = resolveResourceAttempt(current, active.id, { cancel: true }, player, now, activeSeal);
                    if (closed.ok) {
                        current = closed.character; state = readResourceGathering(current.resourceGathering);
                        recoveredReceipt = closed.receipt; recoveredNodeId = active.nodeId;
                        // This claim is already invalid (movement, battle or expiry).
                        // Release under its node lock before any replacement admission.
                        await release();
                    }
                }
            }
            if ((action === 'status' || action === 'start') && state.active?.activity === 'mining'
                && state.active.mode === 'active' && state.active.template >= 3 && body.miningGameVersion !== 2) {
                return { ok: false, status: 409, error: 'This mining formation needs the updated game. Refresh the page to resume your attempt. Nothing extra has been spent.' };
            }
            if (action === 'status') {
                // Recover a settlement whose response was lost before reload,
                // as well as an interruption closed by this status request.
                const receipt = recoveredReceipt ?? state.receipts.find(receipt => receipt.id === id);
                if (receipt && activeSeal?.id === receipt.id && !state.active) await finishReceipt(receipt, current);
                return { ok: true, character: current, write: current !== character,
                    value: { receipt, nodeId: recoveredNodeId ?? (receipt && node?.activity === receipt.activity ? node.id : undefined) } };
            }
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
                const resolved = resolveResourceAttempt(current, id, { cancel: action === 'cancel' || claimLost, placements: body.placements, events: body.events }, onlineStore.get(identity.name), Date.now(), activeSeal);
                if (!resolved.ok) return { ok: false, status: 409, error: resolved.error };
                if (resolved.replayed && activeSeal?.id === id) await finishReceipt(resolved.receipt, resolved.character);
                return { ok: true, character: resolved.character, write: !resolved.replayed,
                    value: { receipt: resolved.receipt, replayed: resolved.replayed },
                    afterCommit: () => finishReceipt(resolved.receipt, resolved.character) };
            }
            if (!node) return { ok: false, status: 400, error: 'Unknown node.' };
            const fingerprint = `${node.id}:${body.mode}`;
            const txId = resourceTxId(identity.name, id);
            if (state.active?.id === id || state.receipts.some(receipt => receipt.id === id)) {
                const savedJournal = await kv.get<EconomyTxRecord>(economyTxKey(txId));
                if (savedJournal?.meta?.fingerprint !== fingerprint) return { ok: false, status: 409, error: 'This attempt ID belongs to another action.' };
                const sealedStart = savedJournal.meta.seal as ResourceSeal;
                if (sealedStart.sharedNode) await finishSharedResourceAdmission(node.id, txId, true);
                if (savedJournal.meta.poolEnabled) await finishResourcePool(node.sector, sealedStart.startedAt, txId, true);
                await completeEconomyTx(txId);
                const replayReceipt = state.receipts.find(receipt => receipt.id === id);
                if (replayReceipt && activeSeal?.id === id) await finishReceipt(replayReceipt, current);
                return { ok: true, character: current, write: current !== character,
                    value: { attempt: state.active?.id === id ? state.active : undefined, receipt: state.receipts.find(r => r.id === id), replayed: true } };
            }
            const player = onlineStore.get(identity.name);
            const error = resourcePositionError(player, node) || resourceAdmissionError(current, node, now, true);
            if (error || !player) return { ok: false, status: 409, error: error ?? 'Connect to the world first.' };
            let worldBossEventId: string | undefined;
            if (node.worldBossCrystal) {
                if (!(await worldBossCrystalCanBeMined(node.id, now))) return { ok: false, status: 409, error: 'This crystal seam has already been claimed or the world event has closed.' };
                worldBossEventId = (await readActiveWorldBossEvent())?.eventId;
                if (!worldBossEventId) return { ok: false, status: 409, error: 'The world event has closed.' };
            }
            journal = await reserveEconomyTx({ id: txId, kind: 'resource-gathering', debitKey: sectorPoolKey(node.sector, now),
                creditKey: `save:${identity.name}`, resource: 'explores', amount: 1,
                meta: { fingerprint, nodeId: node.id, playerName: identity.name, poolEnabled,
                    seal: { ...mintResourceSeal(current, node, id, body.mode as 'active' | 'relaxed', player, now, body.miningGameVersion === 2),
                        sharedNode: true,
                        ...(worldBossEventId ? { worldBossEventId } : {}) } } });
            if (journal.meta?.fingerprint !== fingerprint) return { ok: false, status: 409, error: 'This attempt ID was already used for another action.' };
            if (journal.state === 'complete' || journal.state === 'refunded') return { ok: false, status: 409, error: 'This attempt has already closed. Choose the node again to start another.' };
            const seal = journal.meta?.seal as ResourceSeal, reservedAt = seal.startedAt;
            const usesPool = journal.meta?.poolEnabled === true;
            // A failed admission may be retried after its sealed play window.
            // Retire that uncommitted reservation without charging an attempt
            // that can no longer be played. Admitted IDs recover above instead.
            if (now >= seal.expiresAt) {
                if (seal.sharedNode) await finishSharedResourceAdmission(node.id, txId, false);
                if (usesPool) await finishResourcePool(node.sector, reservedAt, txId, false);
                await markEconomyTx(txId, 'refunded', { note: 'Admission expired before the player save committed; nothing charged.' });
                refunded = true;
                return { ok: false, status: 409, error: 'The attempt expired before it could start. Nothing was spent. Choose the node again.' };
            }
            if (seal.sharedNode) {
                const blocked = await reserveSharedResourceNode(node.id, identity.name, txId, seal, Date.now());
                if (blocked) {
                    await markEconomyTx(txId, 'refunded', { note: blocked });
                    return { ok: false, status: 409, error: blocked };
                }
            }
            if (usesPool && !(await reserveResourcePool(node.sector, String(current.village ?? ''), reservedAt, owner, txId))) {
                if (seal.sharedNode) await finishSharedResourceAdmission(node.id, txId, false);
                await markEconomyTx(txId, 'refunded', { note: 'Sector pool exhausted; player was not charged.' });
                return { ok: false, status: 409, error: 'This sector has used its gathering pool today.' };
            }
            await markEconomyTx(txId, 'debit-applied');
            const stillHere = onlineStore.get(identity.name);
            if (resourcePositionError(stillHere, node) || (stillHere ? stillHere.movementSeq ?? 0 : -1) !== seal.movementSequence
                || (stillHere ? stillHere.resourceEpoch ?? 0 : -1) !== seal.authorityEpoch) {
                if (seal.sharedNode) await finishSharedResourceAdmission(node.id, txId, false);
                if (usesPool) await finishResourcePool(node.sector, reservedAt, txId, false);
                await markEconomyTx(txId, 'refunded', { note: 'Player moved before admission; no daily action or tool use spent.' });
                return { ok: false, status: 409, error: 'You moved before gathering started. Return to the node.' };
            }
            const admitted = admitResourceAttempt(current, seal, now);
            if (!admitted) throw new Error('Tool admission failed');
            return { ok: true, character: admitted, value: { attempt: readResourceGathering(admitted.resourceGathering).active },
                onConflict: async () => { if (seal.sharedNode) await finishSharedResourceAdmission(node.id, txId, false); if (usesPool) await finishResourcePool(node.sector, reservedAt, txId, false); await markEconomyTx(txId, 'refunded'); refunded = true; },
                onUnconfirmedWrite: async () => { await failEconomyTx(txId, 'Gathering admission write needs confirmation. Retry the same attempt ID.'); },
                afterCommit: async () => { if (seal.sharedNode) await finishSharedResourceAdmission(node.id, txId, true); if (usesPool) await finishResourcePool(node.sector, reservedAt, txId, true); await completeEconomyTx(txId); } };
        }));
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        const value = result.value as Record<string, unknown>;
        await rememberMinedGround(identity.name,value.receipt as ResourceReceipt|undefined,Date.now());
        const shardCredit = worldBossHollowShard as Awaited<ReturnType<typeof applyWorldBossCrystalHarvest>>;
        return res.status(200).json({ ok: true, ...value,
            ...(shardCredit ? { worldBossHollowShard: { ...shardCredit, crystalNodeCount: WORLD_BOSS_CRYSTAL_NODES.length } } : {}),
            character: result.character, _saveVersion: result._saveVersion });
    } catch (error) {
        if (journal && !refunded) await failEconomyTx(journal.id, error).catch(() => {});
        console.error('[world/resource]', safeLogValue(error));
        return res.status(refunded ? 409 : 503).json({ error: refunded
            ? 'The attempt did not start and nothing was spent. Choose the node again.'
            : 'Your attempt is recoverable. Retry with the same attempt ID.' });
    }
}
