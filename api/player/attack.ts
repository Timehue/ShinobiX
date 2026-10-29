import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, parseJsonBody, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { onlineStore } from '../_realtime/online-store.js';
import { attackBlock, worldInteractionBlock } from '../_realtime/presence-gating.js';
import { kickPlayer } from '../_realtime/notify.js';
import { kv } from '../_storage.js';
import { isIncapacitated } from '../_elapsed-state.js';
import { activeContestOnSector } from '../_sector-war-store.js';
import type { SectorWarSession } from '../_sector-war.js';
import { alertSectorPreparation } from '../_war-preparations.js';
import { endOwnFieldRecoveryShield } from '../_field-recovery-shield.js';
import { worldBossPvpProtectionBlock, withWorldBossPvpLock } from '../world-boss-event/_pvp-protection.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Require a logged-in player. Prevents anonymous DoS where any name
    // can be marked as "engaged" to block their PvP.
    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });

    // Per-actor rate limit. Without this, an authed attacker could hammer
    // /api/player/attack against arbitrary `targetName` values, repeatedly
    // overwriting their presence row (and refreshing the 60s TTL — keeping
    // them perpetually "engaged" so their own PvP gets blocked). 6 per
    // 60s leaves plenty of headroom for legitimate fights but kills the
    // spam vector.
    const rlName = identity.admin ? undefined : identity.name;
    if (!identity.admin && !enforceRateLimit(req, res, 'player-attack', 6, 60_000, rlName)) return;

    try {
        const parsed = parseJsonBody(req.body);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        const { targetName, attacker } = parsed.body as { targetName?: string; attacker?: { name?: string } | null };
        if (!targetName) return res.status(400).json({ error: 'Missing targetName.' });

        const targetWorldBossBlock = await worldBossPvpProtectionBlock(safeName(String(targetName)));
        if (targetWorldBossBlock) return res.status(targetWorldBossBlock.status).json({ error: targetWorldBossBlock.error });
        if (!identity.admin) {
            const attackerWorldBossBlock = await worldBossPvpProtectionBlock(identity.name);
            if (attackerWorldBossBlock) return res.status(attackerWorldBossBlock.status).json({ error: attackerWorldBossBlock.error });
        }

        // Attacker's reported name (if any) must match the authed identity —
        // a player can't initiate an attack masquerading as someone else.
        if (!identity.admin && attacker && attacker.name) {
            const claimedName = safeName(String(attacker.name));
            if (claimedName !== identity.name) {
                return res.status(403).json({ error: 'Attacker name does not match authenticated user.' });
            }
        }

        // Presence is in process memory; get → check → set runs synchronously on
        // Node's single thread (no await gap for a concurrent heartbeat to
        // interleave), so no lock is needed. setPendingAttacker does NOT bump the
        // target's lastSeen — the same "can't be perpetually refreshed" property
        // the old `ex: 60` re-stamp guaranteed. attackBlock carries the offline
        // (404), Academy-protection (403 for sub-Genin), and traveling / engaged
        // / in-battle (409) gates.
        const targetPresence = onlineStore.get(targetName);
        if (!identity.admin) {
            const locationBlock = worldInteractionBlock(onlineStore.get(identity.name), targetPresence);
            if (locationBlock) return res.status(locationBlock.status).json({ error: locationBlock.error });
        }
        const block = attackBlock(targetPresence);
        if (block) return res.status(block.status).json({ error: block.error });
        // Post-defeat protection, read from the target's AUTHORITATIVE save.
        //
        // It is deliberately not read from presence: the presence character is
        // whatever the target's own client sent, so a `hospitalized` or shield
        // field there would be self-declared permanent immunity — the exact bug
        // server-owned `inBattle` was introduced to close. `hospitalized` /
        // `hospitalizedUntil` / `pvpShieldUntil` are all enforced server-side in
        // the save validator, so the save is the only trustworthy source.
        //
        // Why this matters beyond the fight itself: stamping `pendingAttacker` on
        // a downed player makes `engagedInWorldDuel` refuse their safe-zone exit
        // (api/_realtime/world-duel-engagement.ts). The heartbeat clears the
        // stamp each cycle, so at 6 attacks/minute a single attacker could pin a
        // recovering player out of town indefinitely — and unlike the rewards,
        // which are capped at 3 per target per day, nothing capped the attacks.
        // The offline path already refused this ("Target has already been
        // defeated.", api/player/sleeper-kill.ts); the online path now agrees.
        // The war on the target's sector, when this attack is between its two sides.
        let war: { contest: SectorWarSession; targetVillage: string } | null = null;
        if (!identity.admin) {
            const targetSave = await kv.get<{ character?: Record<string, unknown> }>(`save:${safeName(targetName)}`);
            const targetChar = targetSave?.character;
            if (targetPresence) war = await warBetween(identity.name, targetChar, targetPresence.sector);
            // In a Card or Pet war the two sides fight in the war's own game. A
            // shinobi fight here would score nothing for the war, so it never
            // starts. The client normally routes there itself
            // (lib/sector-war-engagement.ts), but its copy of the contest can be
            // missing or stale; the refusal names the contest so it can start the
            // right battle instead.
            if (war && war.contest.winCondition !== 'combat') {
                return res.status(409).json({
                    error: `This sector's war is fought with ${war.contest.winCondition} battles.`,
                    sectorContest: { kind: war.contest.winCondition, sectorWarId: war.contest.id },
                });
            }
            if (targetChar) {
                const now = Date.now();
                if (isIncapacitated(targetChar, now)) {
                    return res.status(409).json({ error: 'Target has already been defeated.' });
                }
                const shieldedUntil = Math.floor(Number(targetChar.pvpShieldUntil ?? 0)) || 0;
                if (shieldedUntil > now) {
                    return res.status(409).json({
                        error: 'Target is recovering from a recent defeat.',
                        retryAfterMs: shieldedUntil - now,
                    });
                }
            }
        }
        // PvP admission is serialized against world-boss queue joins for both participants.
        if (!identity.admin) endOwnFieldRecoveryShield(identity.name);
        const protectedPlayers = identity.admin ? [safeName(String(targetName))] : [identity.name, safeName(String(targetName))];
        const admission = await withWorldBossPvpLock(protectedPlayers, () =>
            onlineStore.setPendingAttacker(targetName, attacker ?? null));
        if (!admission.ok) return res.status(admission.block.status).json({ error: admission.block.error });
        if (!identity.admin && !admission.value) return res.status(404).json({ error: 'Target is no longer online.' });
        // Instant delivery: nudge the target to run an immediate heartbeat (which
        // is the authoritative path that reads + clears pendingAttacker). No-op if
        // the target has no socket / realtime is off — the poll still delivers it.
        kickPlayer(targetName, 'attack');
        if (!identity.admin && attacker && war) {
            // Only an admitted world attack between this contest's two sides.
            const now = Date.now();
            await alertSectorPreparation(war.contest, `combat:${identity.name}:${safeName(targetName)}:${now}`, 'combat', now, war.targetVillage)
                .catch(() => undefined);
        }
        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('[attack]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

/**
 * The active sector war on `sector`, when the attacker and the target are its
 * two sides. Fails open to null: an unreadable war leaves the attack the plain
 * fight it always was, which scores nothing but blocks nobody.
 */
async function warBetween(
    attackerName: string,
    targetChar: Record<string, unknown> | undefined,
    sector: number,
): Promise<{ contest: SectorWarSession; targetVillage: string } | null> {
    try {
        const contest = await activeContestOnSector(sector);
        if (!contest) return null;
        const from = await kv.get<{ character?: { village?: string } }>(`save:${attackerName}`);
        const a = String(from?.character?.village ?? '').trim();
        const b = String(targetChar?.village ?? '').trim();
        const sides = [contest.attackerVillage, contest.defenderVillage];
        return a && b && a !== b && sides.includes(a) && sides.includes(b) ? { contest, targetVillage: b } : null;
    } catch {
        return null;
    }
}
