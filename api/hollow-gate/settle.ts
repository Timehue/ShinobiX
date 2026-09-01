import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import {
    HG_CLAWBACK_KEYS,
    HG_HIGH_VALUE_ITEM_ID,
    hollowGateRunKey,
    itemStackCount,
    type HollowGateRunToken,
} from './_run-token.js';
import { bumpLegacyStats } from '../_legacy-track.js';
import { acknowledgeEraContribution, bumpEraContributionOnce } from '../_era.js';
import {
    hollowGateCombatBindingKey,
    isHollowGatePetAuthority,
    type HollowGateCombatBinding,
} from './_combat-session.js';
import { hollowGatePetResultKey } from './_pet-authority.js';
import { recordBetaMetric } from '../_beta-metrics.js';
import { soloPveSessionKey } from '../solo-pve/_store.js';
import {
    HOLLOW_GATE_LEDGER_ITEM_IDS,
    hollowGateDeathRetention,
    normalizeHollowGateLedger,
    reconcileLedgerAmount,
    setCountedItem,
} from './_ledger.js';
import { hollowGateManifestNode, hollowGatePositionNodeId } from './_floor-manifest.js';

/*
 * /api/hollow-gate/settle  — POST only  (docs/hollow-gate-augments.md)
 *
 * The authoritative end of a dive. The request carries only an action intent;
 * every retained currency/item is derived from the sealed entry snapshot and
 * the exact server reward ledger. Abandonment applies the stored Greedy Hands
 * retention rule. Single-use and safe to replay after a lost response.
 */

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const HOLLOW_GATE_HOSPITAL_MS = 60_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const token = String(body.token ?? '').slice(0, 64);
        const action = body.action === 'abandon' ? 'abandon' : body.action === 'extract' ? 'extract' : null;
        if (!playerName || !token) return res.status(400).json({ error: 'Missing playerName or token.' });
        if (!action) return res.status(400).json({ error: 'Invalid Hollow Gate end action.' });
        const outcome = action === 'abandon' ? 'death' : 'extract';

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your run.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'hollow-gate-settle', 20, 60_000, identity.name))) return;

        const runKey = hollowGateRunKey(playerName, token);
        return await withKvLock(runKey, async () => {
        const run = await kv.get<HollowGateRunToken>(runKey);
        // Graceful: a stale client (or SESSION_SECRET unset re-mint) just gets a
        // no-op — never a save-breaking error (token-first invariant).
        if (!run) {
            // A retry can arrive after the single-use run token was consumed. Return
            // the current committed character so the client can still reconcile a
            // response that was lost after the save write succeeded.
            const current = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            await recordBetaMetric({
                event: 'hollow_gate.run_settle_replayed',
                playerName,
                source: outcome,
            });
            return res.status(200).json({
                ok: true,
                reason: 'invalid-or-spent',
                character: current?.character ?? null,
                _saveVersion: Number(current?._saveVersion ?? 0),
            });
        }
        if (run.playerName.toLowerCase() !== playerName.toLowerCase()) return res.status(403).json({ error: 'Not your run.' });
        if (outcome === 'extract' && !run.chosenAugmentId) {
            return res.status(409).json({ error: 'Choose the sealed augment before extracting.' });
        }

        if (run.activeEncounter && outcome !== 'death') {
            return res.status(409).json({ error: 'Finish the active Hollow Gate encounter before leaving.' });
        }
        // Emergency forfeits must remain available even if a combat renderer or
        // resume pointer is broken. A death settlement receives no combat reward,
        // closes the active binding, and then applies the normal run-loss rules.
        if (run.activeEncounter && outcome === 'death') {
            const abandonedRunId = run.activeEncounter.runId;
            const bindingKey = hollowGateCombatBindingKey(abandonedRunId);
            await withKvLock(bindingKey, async () => {
                const binding = await kv.get<HollowGateCombatBinding>(bindingKey);
                const petAuthority = isHollowGatePetAuthority(binding?.petAuthority)
                    ? binding.petAuthority
                    : null;
                const activeProof = petAuthority
                    ? petAuthority.proofId
                    : await kv.get<string>(`pet:battle-active:${playerName}`);
                const activeSeal = activeProof
                    ? await kv.get<{ playerName?: string; hollowGate?: { runId?: string } }>(
                        `pet:battle-token:${playerName}:${activeProof}`,
                    )
                    : null;
                const retainedLegacyProof = !petAuthority
                    && activeProof
                    && /^[A-Za-z0-9]{8,96}$/.test(activeProof)
                    && activeSeal?.playerName?.toLowerCase() === playerName.toLowerCase()
                    && activeSeal.hollowGate?.runId === abandonedRunId
                    ? activeProof
                    : null;
                const proofToRevoke = petAuthority?.proofId ?? retainedLegacyProof;
                await kv.del(
                    bindingKey,
                    soloPveSessionKey(abandonedRunId),
                    ...(proofToRevoke ? [
                        hollowGatePetResultKey(playerName, proofToRevoke),
                        `pet:battle-token:${playerName}:${proofToRevoke}`,
                    ] : []),
                );
                if (proofToRevoke) {
                    await kv.delIfEqual(`pet:battle-active:${playerName}`, proofToRevoke);
                }
            }, { failClosed: true });
            run.activeEncounter = null;
        }
        const bossResolved = (run.resolvedEncounterIds ?? []).some((entry) => entry.startsWith(`${run.floorDepth}:boss:`));
        if (outcome === 'extract' && run.chosenAugmentId === 'berserkers-gamble' && !bossResolved) {
            return res.status(409).json({ error: "Berserker's Gamble seals retreat until the final Hollow Hound Alpha falls." });
        }

        if (outcome === 'extract' && !bossResolved) {
            const position = run.position;
            const currentFloor = Math.max(1, Math.floor(Number(run.currentFloor) || 1));
            const manifest = run.floorManifests?.[String(currentFloor)];
            const nodeId = hollowGatePositionNodeId(manifest, position);
            if (hollowGateManifestNode(manifest, nodeId) !== 'exit') {
                return res.status(409).json({ error: 'Reach the sealed exit before extracting.' });
            }
        }

        const runAgeMs = Date.now() - Number(run.mintedAt ?? 0);
        if (outcome === 'extract' && runAgeMs < 3 * 60 * 1000 && !bossResolved) {
            return res.status(409).json({ error: 'The run is too new to extract.' });
        }

        const ledger = normalizeHollowGateLedger(run);

        const credited = {} as Record<string, number>;
        let fragmentsClampedTo: number | null = null;
        const saveKey = `save:${playerName}`;
        const result = await withKvLock(saveKey, async () => {
            const fresh = await kv.get<Record<string, unknown>>(saveKey);
            const c = (fresh?.character ?? null) as Record<string, unknown> | null;
            if (!fresh || !c) return { ok: false as const, character: null, _saveVersion: 0 };
            const redeemedRuns = Array.isArray(c.redeemedHollowGateRuns)
                ? (c.redeemedHollowGateRuns as unknown[]).filter((entry): entry is string => typeof entry === 'string')
                : [];
            if (redeemedRuns.includes(token)) {
                return { ok: true as const, alreadyReported: true as const, character: c, _saveVersion: Number(fresh._saveVersion ?? 0) };
            }
            let next: Record<string, unknown> = { ...c };
            const retention = outcome === 'death' ? hollowGateDeathRetention(c) : 1;
            for (const k of HG_CLAWBACK_KEYS) {
                const value = reconcileLedgerAmount(
                    c[k],
                    run.entryCurrencies[k],
                    ledger.currencies[k],
                    retention,
                );
                next[k] = value;
                credited[k] = Math.max(0, value - num(run.entryCurrencies[k]));
            }
            for (const itemId of HOLLOW_GATE_LEDGER_ITEM_IDS) {
                const current = itemStackCount(next.itemStacks, itemId);
                // Pre-ledger tokens did not seal all item baselines; preserve
                // their already-stored item state instead of confiscating it.
                const entry = run.entryItems
                    ? num(run.entryItems[itemId])
                    : itemId === HG_HIGH_VALUE_ITEM_ID && typeof run.entryFragments === 'number'
                        ? run.entryFragments
                        : current;
                const target = reconcileLedgerAmount(current, entry, ledger.items[itemId], 1);
                next.itemStacks = setCountedItem(next.itemStacks, itemId, target);
            }
            if (outcome === 'death') {
                const now = Date.now();
                next.hp = 0;
                next.hospitalized = true;
                next.hospitalizedAt = now;
                next.hospitalizedUntil = now + HOLLOW_GATE_HOSPITAL_MS;
            }
            next.hollowGateRun = null;
            delete next.lastHollowGateStart;
            next.redeemedHollowGateRuns = [...redeemedRuns.slice(-99), token];
            fragmentsClampedTo = itemStackCount(next.itemStacks, HG_HIGH_VALUE_ITEM_ID);
            const updated: Record<string, unknown> = bumpSaveVersion({ ...fresh, character: next });
            await kv.set(saveKey, mergePreservingImages(updated, fresh));
            return {
                ok: true as const,
                alreadyReported: false as const,
                character: next,
                _saveVersion: Number(updated._saveVersion ?? 0),
            };
        }, { failClosed: true });

        if (!result.ok) return res.status(404).json({ error: 'Your save was not found.' });

        // Deliver the sidecar proof BEFORE consuming the run token. The player
        // save receipt above makes settlement replayable; a stable Legacy
        // receipt makes the associated clear exact-once. If delivery is
        // temporarily unavailable we leave the run record in place and return
        // a retryable response — the next call enters alreadyReported and
        // repairs the missing proof without paying currency twice.
        const legacyQualifyingClear = outcome === 'extract'
            && (runAgeMs >= 3 * 60 * 1000 || bossResolved);
        if (legacyQualifyingClear) {
            const legacyBootstrapCharacter = bossResolved
                ? {
                    ...result.character,
                    // combat-settle already raised this mirror for the run's
                    // boss. Seed pre-run history, then add the extraction deed.
                    hollowGateWardenKills: Math.max(
                        0,
                        Math.floor(Number(result.character.hollowGateWardenKills) || 0) - 1,
                    ),
                }
                : result.character;
            const legacyDelivered = await bumpLegacyStats(
                playerName,
                { hollowGateClears: 1, dungeonClears: 1, eliteKills: 2 },
                {
                    characterForBootstrap: legacyBootstrapCharacter,
                    receiptId: `hollow-gate:${playerName}:${token}`,
                },
            );
            if (!legacyDelivered) {
                return res.status(503).json({
                    error: 'Your extraction is safe, but its Legacy record is still being sealed. Please retry.',
                    code: 'legacy-delivery-pending',
                    character: result.character,
                    _saveVersion: result._saveVersion,
                });
            }
            const eraReceiptId = `hollow-gate:${playerName}:${token}:era`;
            await bumpEraContributionOnce('gateClears', eraReceiptId);
            await acknowledgeEraContribution('gateClears', eraReceiptId);
        }
        await kv.set(`hg-settled:${playerName}:${token}`, {
            outcome,
            legacyQualifyingClear,
            settledAt: Date.now(),
        }, { ex: 24 * 60 * 60 }).catch(() => undefined);
        await kv.del(runKey).catch(() => undefined);
        if (result.alreadyReported) {
            await recordBetaMetric({
                event: 'hollow_gate.run_settle_replayed',
                playerName,
                source: outcome,
            });
            return res.status(200).json({ ok: true, alreadyReported: true, character: result.character, _saveVersion: result._saveVersion });
        }
        await recordBetaMetric({
            event: outcome === 'death'
                ? 'hollow_gate.run_forfeited'
                : bossResolved
                    ? 'hollow_gate.run_completed'
                    : 'hollow_gate.run_extracted',
            playerName,
            source: `floor-${run.currentFloor ?? 1}-of-${run.floorDepth}`,
        });
        return res.status(200).json({
            ok: true,
            outcome,
            credited,
            fragmentsClampedTo,
            character: result.character,
            _saveVersion: result._saveVersion,
        });
        }, { failClosed: true, ttlSec: 30 });
    } catch (err) {
        console.error('[hollow-gate/settle]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
