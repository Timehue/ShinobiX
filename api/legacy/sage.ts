import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { appendLegacyEvent, legacyEnabled } from '../_legacy-track.js';
import { currentEraNumber } from '../_era.js';
import { getLegacyOverlay } from '../_legacy-score.js';
import { LEGACY_BY_ID } from '../_legacy-defs.js';
import {
    legacyAcceptedKey, trialProgress, trialIntroFor,
    type CharacterLegacy,
} from '../_legacy-core.js';
import {
    attemptSageRoll,
    bumpSageMetric,
    publicSageOffer,
    sageMetricKey,
    sageOfferKey as offerKey,
    sagePityKey as pityKey,
    SAGE_OFFER_TTL_SECONDS as OFFER_TTL_SECONDS,
    type SageOffer,
} from '../_legacy-sage-roll.js';
import {
    AURA_STONES_BY_RARITY,
    commitLegacyAcceptance,
    deliverLegacyAcceptanceEffects,
    ensureAcceptanceTrial,
    recoverLegacyAcceptance,
    type LegacyAcceptanceMarker,
} from './_acceptance.js';

/*
 * /api/legacy/sage — the Wandering Sage.
 *
 *   GET  ?playerName=            → { offer, legacy, pity }
 *   POST { action:'roll' }       → admin-only forced/recovery control. Ordinary
 *                                  rolls are triggered only by verified server
 *                                  progress writes, never by client polling.
 *   POST { action:'decline' }    → offer declined, NO lock, re-offer cooldown
 *   POST { action:'accept', legacyId } → THE PERMANENT CHOICE. NX marker
 *                                  `legacy:accepted:<player>` is the one-legacy-
 *                                  forever constraint; the save's character.legacy
 *                                  is a server-owned display copy.
 *
 * Spawn odds: base 5% per qualifying roll, +5% per full day since the player
 * first became offer-eligible without a spawn, hard guarantee at day 7
 * (soft+hard pity). Tunable via the shared:legacy-defs overlay.
 */

type PityState = {
    eligibleSince?: number;    // first roll where the player had >=1 eligible legacy
    lastSpawnAt?: number;
    declinedUntil?: number;    // re-offer cooldown after a decline
};

const DAY_MS = 24 * 60 * 60 * 1000;
export { sageMetricKey };

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (!legacyEnabled()) return res.status(404).json({ error: 'The Sage has not begun to wander.' });

    try {
        const isGet = req.method === 'GET';
        const body = isGet ? {} : (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(isGet ? req.query.playerName ?? '' : body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }

        // ── GET: current offer + legacy state ───────────────────────────────
        if (isGet) {
            if (!identity.admin && !(await enforceRateLimitKv(req, res, 'legacy-sage-get', 20, 60_000, identity.name))) return;
            const recovery = await recoverLegacyAcceptance(playerName);
            if (recovery.status === 'missing') return res.status(404).json({ error: 'Save not found.' });
            if (recovery.status === 'invalid-marker') {
                return res.status(409).json({ error: 'The sealed Legacy record is invalid.', reason: 'invalid-seal' });
            }
            if (recovery.status === 'conflict') {
                return res.status(409).json({ error: 'The sealed Legacy conflicts with the save.', reason: 'legacy-save-conflict' });
            }
            const [offer, accepted, rec] = await Promise.all([
                kv.get<SageOffer>(offerKey(playerName)),
                kv.get<LegacyAcceptanceMarker>(legacyAcceptedKey(playerName)),
                kv.get<Record<string, unknown>>(`save:${playerName}`),
            ]);
            const character = (rec?.character ?? null) as Record<string, unknown> | null;
            const legacy = (character?.legacy ?? null) as CharacterLegacy | null;
            return res.status(200).json({
                offer: offer && offer.status === 'spawned' ? publicSageOffer(offer) : null,
                legacy,
                sealed: Boolean(accepted),
                repaired: recovery.status === 'ok' && recovery.repaired,
                effectsPending: recovery.status === 'ok' && recovery.effectsPending,
                ...(recovery.status === 'ok' && recovery.repaired
                    ? { character, _saveVersion: Number(rec?._saveVersion) || 0 }
                    : {}),
            });
        }

        if (req.method !== 'POST') return res.status(405).end();
        const action = typeof body.action === 'string' ? body.action : '';

        // ── ROLL: server-decided spawn attempt ───────────────────────────────
        if (action === 'roll') {
            if (!identity.admin) {
                return res.status(403).json({
                    error: 'Sage appearances are decided by witnessed deeds.',
                    reason: 'verified-progress-only',
                });
            }
            const result = await attemptSageRoll(playerName, {
                sector: typeof body.sector === 'number' ? body.sector : null,
                forced: Boolean(body.force),
            });
            if (result.reason === 'no-save') return res.status(404).json({ error: 'Save not found.' });
            return res.status(200).json(result);
        }

        // ── DECLINE: free walk-away, cooldown before re-offers ──────────────
        if (action === 'decline') {
            if (!identity.admin && !(await enforceRateLimitKv(req, res, 'legacy-sage-act', 5, 60_000, identity.name))) return;
            const overlay = await getLegacyOverlay();
            const declineCooldownDays = overlay.sage?.declineCooldownDays ?? 3;
            const offer = await kv.get<SageOffer>(offerKey(playerName));
            if (!offer || offer.status !== 'spawned') return res.status(200).json({ ok: false, reason: 'no-offer' });
            const now = Date.now();
            await kv.set(offerKey(playerName), { ...offer, status: 'declined', declinedAt: now }, { ex: OFFER_TTL_SECONDS });
            const pity = (await kv.get<PityState>(pityKey(playerName))) ?? {};
            await kv.set(pityKey(playerName), { declinedUntil: now + declineCooldownDays * DAY_MS });
            await appendLegacyEvent(playerName, { type: 'offer-declined', meta: { offers: offer.offers.map((o) => o.legacyId) } });
            await bumpSageMetric('declines');
            return res.status(200).json({ ok: true });
        }

        // ── ACCEPT: the permanent choice ─────────────────────────────────────
        if (action === 'accept') {
            if (!identity.admin && !(await enforceRateLimitKv(req, res, 'legacy-sage-act', 5, 60_000, identity.name))) return;
            const legacyId = typeof body.legacyId === 'string' ? body.legacyId : '';
            const def = LEGACY_BY_ID.get(legacyId);
            if (!def) return res.status(400).json({ error: 'Unknown legacy.' });

            const out = await withKvLock<{ status: number; body: unknown }>(`legacy:accept:${playerName}`, async () => {
                const now = Date.now();
                // Sealed-marker check FIRST: if a previous accept crashed after
                // claiming the NX marker but before the save/trial writes, the
                // repair must not depend on the offer still existing — the
                // player was sealed the moment the marker landed, and this path
                // finishes the job even after the offer expired (verification
                // finding: the old order could seal a player with NO legacy).
                let sealed = await kv.get<LegacyAcceptanceMarker>(legacyAcceptedKey(playerName));
                const replayingSealedAcceptance = Boolean(sealed);
                if (sealed && sealed.legacyId !== legacyId) {
                    return { status: 409, body: { ok: false, reason: 'sealed', legacyId: sealed.legacyId } };
                }
                // Idempotency/repair guard: a save already carrying this Legacy
                // is never reset. The path may still atomically migrate a missing
                // acceptance receipt or recreate the initial trial after a
                // response-loss crash, then returns the current versioned save.
                if (sealed) {
                    const recNow = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                    const charNow = (recNow?.character ?? null) as Record<string, unknown> | null;
                    const legacyNow = (charNow?.legacy ?? null) as CharacterLegacy | null;
                    if (legacyNow && legacyNow.legacyId === legacyId) {
                        const replaySave = await commitLegacyAcceptance(
                            playerName,
                            legacyNow,
                            AURA_STONES_BY_RARITY[def.rarity] ?? 0,
                            now,
                        );
                        if (replaySave.status === 'missing') return { status: 404, body: { error: 'Save not found.' } };
                        if (replaySave.status === 'conflict') {
                            return { status: 409, body: { ok: false, reason: 'legacy-save-conflict' } };
                        }
                        const replayTrial = await ensureAcceptanceTrial(
                            playerName,
                            def,
                            replaySave.legacy,
                            replaySave.character,
                            now,
                        );
                        const replayOffer = await kv.get<SageOffer>(offerKey(playerName));
                        if (replayOffer && replayOffer.status !== 'accepted') {
                            await kv.set(offerKey(playerName), {
                                ...replayOffer,
                                status: 'accepted',
                                acceptedAt: replaySave.receipt.committedAt,
                                acceptedLegacyId: legacyId,
                            }, { ex: OFFER_TTL_SECONDS });
                        }
                        const effectsDelivered = await deliverLegacyAcceptanceEffects(
                            playerName,
                            sealed.actor || playerName,
                            def,
                            replaySave.receipt,
                        );
                        return {
                            status: 200,
                            body: {
                                ok: true,
                                legacy: replaySave.legacy,
                                trial: replayTrial.trial
                                    ? { ...replayTrial.trial, objectives: trialProgress(replayTrial.trial, replayTrial.stats) }
                                    : null,
                                intro: replayTrial.trial ? trialIntroFor(def, replayTrial.trial.kind) : undefined,
                                chronicleCards: replaySave.receipt.chronicleCards,
                                character: replaySave.character,
                                _saveVersion: Number(replaySave.record._saveVersion) || 0,
                                repaired: replaySave.changed || replayTrial.created,
                                effectsPending: !effectsDelivered,
                            },
                        };
                    }
                }
                if (!sealed) {
                    const offer = await kv.get<SageOffer>(offerKey(playerName));
                    if (!offer || offer.status !== 'spawned' || now > offer.expiresAt) {
                        return { status: 200, body: { ok: false, reason: 'no-offer' } };
                    }
                    if (!offer.offers.some((o) => o.legacyId === legacyId)) {
                        return { status: 200, body: { ok: false, reason: 'not-offered' } };
                    }
                    // The one-legacy-forever constraint: an atomic NX marker.
                    // Preserve the acceptance era and actor inside the durable
                    // recovery source before any save write can fail.
                    const marker: LegacyAcceptanceMarker = {
                        legacyId,
                        ts: now,
                        eraBorn: await currentEraNumber(),
                        actor: identity.admin ? 'admin' : playerName,
                    };
                    const claimed = await kv.set(legacyAcceptedKey(playerName), marker, { nx: true });
                    if (claimed !== 'OK') {
                        const raced = await kv.get<LegacyAcceptanceMarker>(legacyAcceptedKey(playerName));
                        if (raced?.legacyId !== legacyId) {
                            return { status: 409, body: { ok: false, reason: 'sealed', legacyId: raced?.legacyId ?? null } };
                        }
                        sealed = raced;
                    } else {
                        sealed = marker;
                    }
                }

                // Stamp the world era this legacy is taken up in — permanent, pins
                // the accomplishment to the timeline ("taken up in the Age of ...").
                const eraBorn = sealed?.eraBorn ?? await currentEraNumber();
                const legacy: CharacterLegacy = { legacyId, stage: 1, acceptedAt: sealed?.ts ?? now, eraBorn, titles: [] };
                const auraReward = AURA_STONES_BY_RARITY[def.rarity] ?? 0;
                const saveOut = await commitLegacyAcceptance(playerName, legacy, auraReward, now);
                if (saveOut.status === 'missing') return { status: 404, body: { error: 'Save not found.' } };
                if (saveOut.status === 'conflict') {
                    return { status: 409, body: { ok: false, reason: 'legacy-save-conflict' } };
                }
                const trialOut = await ensureAcceptanceTrial(playerName, def, saveOut.legacy, saveOut.character, now);
                const trial = trialOut.trial;
                const stats = trialOut.stats;
                // Mark the offer consumed if it still exists (a crash-repair
                // accept may arrive after the offer record expired — fine).
                const offerNow = await kv.get<SageOffer>(offerKey(playerName));
                if (offerNow) {
                    await kv.set(offerKey(playerName), { ...offerNow, status: 'accepted', acceptedAt: now, acceptedLegacyId: legacyId }, { ex: OFFER_TTL_SECONDS });
                }
                if (!replayingSealedAcceptance) await bumpSageMetric('accepts');
                const effectsDelivered = await deliverLegacyAcceptanceEffects(
                    playerName,
                    sealed.actor || playerName,
                    def,
                    saveOut.receipt,
                );
                // Mythic acceptance is world history: announcement + Hall entry.
                // The Hall entry runs on EVERY path (its NX key makes it exactly-
                // once, so a crash-repair accept still mints the permanent entry
                // — previously the !sealed guard skipped it forever after a
                // mid-accept crash; verification finding).
                // The auto-started first trial ships with the Sage's charge so
                // the client can open the trial ceremony immediately —
                // objectives DECORATED ({progress, done}) like every other
                // trial payload (E2E smoke finding: raw pairs violate the
                // TrialView contract clients render).
                return {
                    status: 200,
                    body: {
                        ok: true,
                        legacy: saveOut.legacy,
                        trial: trial ? { ...trial, objectives: trialProgress(trial, stats) } : null,
                        intro: trial ? trialIntroFor(def, trial.kind) : undefined,
                        chronicleCards: saveOut.receipt.chronicleCards,
                        character: saveOut.character,
                        _saveVersion: Number(saveOut.record._saveVersion) || 0,
                        repaired: replayingSealedAcceptance && (saveOut.changed || trialOut.created),
                        effectsPending: !effectsDelivered,
                    },
                };
            }, { failClosed: true });

            return res.status(out.status).json(out.body);
        }

        return res.status(400).json({ error: 'Unknown action.' });
    } catch (err) {
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'The Sage is occupied — please retry.' });
        }
        console.error('[legacy/sage]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
