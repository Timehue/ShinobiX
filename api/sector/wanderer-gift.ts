import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { LockContendedError } from '../_lock.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { isPlayerSaveVersionConflict } from '../save/_projected-write.js';
import { decideWandererGift, rollWandererGift, WANDERER_GIFTS_PER_DAY } from './_wanderer-gift.js';
import {
    claimWandererUseCooldown,
    currentWandererCooldownUntil,
    naturalWandererOffers,
    wandererUseCooldownKey,
    withWandererUseState,
} from './_wanderer-encounter.js';
import { bumpLegacyStats } from '../_legacy-track.js';
import { bumpEraDiscoveryContribution } from '../_era.js';
import { sectorPresenceBlock } from '../_sector-presence-gate.js';

/*
 * /api/sector/wanderer-gift — POST only
 *
 * A friendly sector Wanderer hands the player a small gift. Server-authoritative:
 * the reward is RECOMPUTED here (never read from the client) and bounded by a
 * per-day cap, so it can't be farmed into a ryo faucet. Mirrors the
 * recompute-server-side pattern in docs/auth-and-anti-cheat-patterns.md.
 *
 * Body: { playerName, sector?, wandererId }
 * → { ok:true, ryo, totalRyo, claimsLeft } | { ok:false, reason }
 */

function utcDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });
        const wandererId = typeof body.wandererId === 'string' ? body.wandererId.trim() : '';
        // Not just the id's SHAPE: the server re-rolls the roster and refuses an
        // id it does not currently put on the road, plus any archetype/verb/
        // level/name the client echoed back that disagrees with that roll. And
        // only a wanderer the roll makes a gift-giver may pay a gift, whether or
        // not the client sent a verb.
        if (!naturalWandererOffers(wandererId, Date.now(), body, ['gift'])) {
            return res.status(200).json({ ok: false, reason: 'invalid-wanderer' });
        }
        const sector = Math.max(1, Math.min(60, Math.floor(Number(body.sector ?? 0)) || 0));

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'wanderer-gift', 12, 60_000, identity.name))) return;

        // Wanderer encounters happen in the wild and pay out, so they follow the
        // same rule as exploring and attacking: you must actually be standing in
        // the sector you are claiming (api/_sector-presence-gate.ts).
        const presenceBlock = sectorPresenceBlock(playerName, sector);
        if (presenceBlock && !identity.admin) {
            return res.status(presenceBlock.status).json({ error: presenceBlock.error, reason: presenceBlock.reason });
        }

        const dayKey = `wanderer-gift:${playerName}:${utcDateKey()}`;
        let legacyWandererId = '';

        type Reply = Record<string, unknown>;
        const committed = await mutatePlayerSave<Reply>(playerName, async ({ character: char }) => {
            const refuse = (body: Reply) => ({ ok: true as const, write: false, character: char, value: body });
            const now = Date.now();

            const saveCooldownUntil = currentWandererCooldownUntil(char, wandererId, now);
            if (saveCooldownUntil) {
                // The hard server row plus the saved cooldown prove a prior
                // interaction committed. That makes this branch the recovery
                // path if its Legacy side effect failed after payout.
                if (await kv.get(wandererUseCooldownKey(playerName, wandererId))) {
                    legacyWandererId = wandererId;
                }
                return refuse({ ok: false, reason: 'cooldown', cooldownUntil: saveCooldownUntil });
            }

            const claimsSoFar = Math.max(0, Number((await kv.get<number>(dayKey)) ?? 0));
            const decision = decideWandererGift(claimsSoFar);
            if (!decision.ok) {
                return refuse({ ok: false, reason: decision.reason, claimsLeft: 0 });
            }

            const hardCooldown = await claimWandererUseCooldown(kv, playerName, wandererId, now);
            if (!hardCooldown.ok) {
                return refuse({ ok: false, reason: hardCooldown.reason, cooldownUntil: hardCooldown.cooldownUntil });
            }

            // Burn the daily slot after save/cooldown eligibility is verified.
            // The save lock serializes this player's gift requests, so a full
            // daily cap rejects above without spending this wanderer cooldown.
            const countAfter = await kv.incr(dayKey, { ex: 25 * 60 * 60 });
            // Roll the bundle SERVER-SIDE (never trust the client) and grant it.
            const gift = rollWandererGift(Number(char.level ?? 1), Math.random);
            const rewarded = {
                ...char,
                ryo: Number(char.ryo ?? 0) + gift.ryo,
                fateShards: Number(char.fateShards ?? 0) + gift.fateShards,
                boneCharms: Number(char.boneCharms ?? 0) + gift.boneCharms,
            };
            const used = withWandererUseState(rewarded, wandererId, now, sector);
            const updated = used.character;
            return {
                ok: true,
                character: updated,
                value: {
                    ok: true,
                    gift,
                    totals: { ryo: updated.ryo, fateShards: updated.fateShards, boneCharms: updated.boneCharms },
                    claimsLeft: Math.max(0, WANDERER_GIFTS_PER_DAY - countAfter),
                    cooldownUntil: used.cooldownUntil,
                    moveToSector: used.moveToSector,
                },
                // A gift that loses its compare-and-set paid nothing: hand back
                // the wanderer cooldown and the daily slot it spent, so the
                // player's retry is a fresh claim rather than "cooldown". Only
                // this player's gift path touches either key, always under this
                // save lock.
                onConflict: async () => {
                    await kv.delIfEqual(wandererUseCooldownKey(playerName, wandererId), { cooldownUntil: hardCooldown.cooldownUntil });
                    if (await kv.get<number>(dayKey) === countAfter) await kv.set(dayKey, countAfter - 1, { ex: 25 * 60 * 60 });
                },
            };
        });
        if (!committed.ok) {
            if (committed.status === 404) return res.status(404).json({ error: 'Your save was not found.' });
            return res.status(committed.status).json({ error: committed.error });
        }
        const out = { status: 200, body: committed.value };
        if (committed.value.ok === true) {
            legacyWandererId = wandererId;
            committed.value._saveVersion = committed._saveVersion;
        }

        // Legacy tracking (ENABLE_LEGACY): a wanderer encounter is a sector
        // discovery. Rides the same daily cap as the gift itself.
        if (legacyWandererId) {
            const receiptId = `wanderer-discovery:${legacyWandererId}`;
            const delivered = await bumpLegacyStats(playerName, { sectorDiscoveries: 1 }, { receiptId });
            if (!delivered || !(await bumpEraDiscoveryContribution(playerName, receiptId))) {
                return res.status(503).json({
                    error: 'The encounter is safe, but its Legacy record is still being sealed. Retry the same wanderer.',
                    code: 'legacy-delivery-pending',
                    retryable: true,
                });
            }
        }
        return res.status(out.status).json(out.body);
    } catch (err) {
        if (err instanceof LockContendedError || isPlayerSaveVersionConflict(err)) {
            return res.status(503).json({ error: 'Could not grant the gift — please retry.' });
        }
        console.error('[sector/wanderer-gift]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
