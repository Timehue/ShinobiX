import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { alreadyHoldsKvLock } from '../_kv-lock-context.js';
import { onlineStore } from '../_realtime/online-store.js';
import { RESOURCE_NODES, WORLD_BOSS_CRYSTAL_NODES, resourceNode } from '../../shared/resource-nodes.js';
import { readResourceGathering, RESOURCE_NODE_ATTEMPTS, RESOURCE_REFILL_MS } from '../../shared/resource-gathering.js';
import type { SharedResourceNodeView } from '../../shared/shared-resource-node.js';
import type { ResourceSeal } from './_resource-gathering.js';
import { resourceBattleActive } from './_resource-battle.js';

export const sharedResourceNodeKey = (id: string) => `world:resource-node:${id}`;
type Reservation = { generation: number; committed: boolean };
type Claim = { txId: string; player: string; id: string; expiresAt: number; movementSequence: number; authorityEpoch: number };
export type SharedResourceNodeRow = {
    generation: number; attempts: number; refillAt: number;
    claim?: Claim; reservations: Record<string, Reservation>;
};
function fresh(): SharedResourceNodeRow { return { generation: 0, attempts: 0, refillAt: 0, reservations: {} }; }
function normalize(row: SharedResourceNodeRow | null, now: number): SharedResourceNodeRow {
    if (!row) return fresh();
    if (row.refillAt && now >= row.refillAt) return { ...row, generation: row.generation + 1, attempts: 0, refillAt: 0,
        claim: undefined, reservations: Object.fromEntries(Object.entries(row.reservations).filter(([, r]) => !r.committed)) };
    return row;
}
async function liveClaim(id: string, claim: Claim | undefined, now: number): Promise<Claim | undefined> {
    if (!claim || now >= claim.expiresAt) return;
    const node = resourceNode(id), player = onlineStore.get(claim.player);
    if (!node || !player || player.locationUnverified || player.inBattle || (player.travelingUntil ?? 0) > now
        || player.sector !== node.sector || player.tile !== node.approach
        || (player.movementSeq ?? 0) !== claim.movementSequence || (player.resourceEpoch ?? 0) !== claim.authorityEpoch) return;
    if (await resourceBattleActive(claim.player)) return;
    return claim;
}
function assertLocked(id: string) {
    if (!alreadyHoldsKvLock(sharedResourceNodeKey(id))) throw new Error('Shared resource node must be locked before mutation.');
}
async function write(id: string, row: SharedResourceNodeRow) {
    assertLocked(id);
    // No TTL: unresolved admission receipts must survive until reconciled.
    await kv.set(sharedResourceNodeKey(id), row);
}

/** Lock order: sorted node keys -> player save -> sector pool. Snapshot the
 * active node, then verify it again under the save lock before any mutation. */
export async function withPlayerResourceNodes<T>(name: string, requested: string | undefined | (string | undefined)[],
    run: (assertActive: (character: Record<string, unknown>) => void) => Promise<T>): Promise<T> {
    const saved = await kv.get<{ character?: Record<string, unknown> }>(`save:${name}`);
    const active = readResourceGathering(saved?.character?.resourceGathering).active;
    const ids = [...new Set([...(Array.isArray(requested) ? requested : [requested]), active?.nodeId].filter((id): id is string => !!id && !!resourceNode(id)))].sort();
    const enter = (index: number): Promise<T> => index < ids.length
        ? withKvLock(sharedResourceNodeKey(ids[index]), () => enter(index + 1), { failClosed: true, ttlSec: 15 })
        : run(character => {
            const nodeId = readResourceGathering(character.resourceGathering).active?.nodeId;
            if (nodeId && !ids.includes(nodeId)) throw new Error('Gathering changed while acquiring node locks. Retry.');
        });
    return enter(0);
}
export async function reserveSharedResourceNode(nodeId: string, player: string, txId: string, seal: ResourceSeal, now: number) {
    assertLocked(nodeId);
    const row = normalize(await kv.get<SharedResourceNodeRow>(sharedResourceNodeKey(nodeId)), now);
    const prior = row.reservations[txId];
    if (prior) return row.claim?.id === seal.id && row.claim.player === player && prior.generation === row.generation
        ? null : 'This shared gathering claim has ended. Start a new attempt.';
    if (await liveClaim(nodeId, row.claim, now)) return 'Another shinobi is gathering here. Contest the node or wait for their attempt to finish.';
    if (row.attempts >= RESOURCE_NODE_ATTEMPTS) return 'This shared node is empty. Return after it replenishes.';
    row.attempts++;
    if (row.attempts === RESOURCE_NODE_ATTEMPTS) row.refillAt = now + RESOURCE_REFILL_MS;
    row.claim = { txId, player, id: seal.id, expiresAt: seal.expiresAt, movementSequence: seal.movementSequence, authorityEpoch: seal.authorityEpoch };
    row.reservations[txId] = { generation: row.generation, committed: false };
    await write(nodeId, row);
    return null;
}
export async function finishSharedResourceAdmission(nodeId: string, txId: string, committed: boolean) {
    assertLocked(nodeId);
    const row = await kv.get<SharedResourceNodeRow>(sharedResourceNodeKey(nodeId));
    const reservation = row?.reservations[txId];
    if (!row || !reservation || reservation.committed) return;
    if (committed) reservation.committed = true;
    else {
        if (reservation.generation === row.generation) { row.attempts = Math.max(0, row.attempts - 1); row.refillAt = 0; }
        delete row.reservations[txId];
        if (row.claim?.txId === txId) row.claim = undefined;
    }
    await write(nodeId, row);
}
export async function sharedResourceClaimHeld(nodeId: string, player: string, id: string, now: number) {
    assertLocked(nodeId);
    const row = await kv.get<SharedResourceNodeRow>(sharedResourceNodeKey(nodeId));
    const claim = await liveClaim(nodeId, row?.claim, now);
    return claim?.player === player && claim.id === id;
}
export async function releaseSharedResourceClaim(nodeId: string, player: string, id: string) {
    assertLocked(nodeId);
    const row = await kv.get<SharedResourceNodeRow>(sharedResourceNodeKey(nodeId));
    if (row?.claim?.player !== player || row.claim.id !== id) return;
    row.claim = undefined;
    await write(nodeId, row);
}
export async function sharedResourceViews(sector: number, now: number): Promise<Record<string, SharedResourceNodeView>> {
    const nodes = [...RESOURCE_NODES, ...WORLD_BOSS_CRYSTAL_NODES].filter(node => node.sector === sector);
    if (!nodes.length) return {};
    const rows = await kv.mget(...nodes.map(node => sharedResourceNodeKey(node.id)));
    return Object.fromEntries(await Promise.all(nodes.map(async (node, i) => {
        const row = normalize(rows[i] as SharedResourceNodeRow | null, now), claim = await liveClaim(node.id, row.claim, now);
        return [node.id, { remaining: Math.max(0, RESOURCE_NODE_ATTEMPTS - row.attempts), refillAt: row.refillAt,
            ...(claim ? { gatherer: claim.player, claimExpiresAt: claim.expiresAt } : {}) }];
    })));
}
