import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { reportMissionEvent, awardProfessionXp, type CompletedMissionInfo } from './_progress.js';
import { masteryHasCapstone } from '../_profession-mastery.js';
import { bumpLegacyStats } from '../_legacy-track.js';
import { settleServerPetExpedition } from '../pet/_progress.js';
import { PET_EXPEDITION_TYPES, petExpeditionSealForToken, type PetExpeditionSeal, type PetExpeditionType } from './_pet-expedition-lease.js';
import { recordPetBreedingProgress } from '../pet/_breeding-requirements.js';

// Server-side Tamer XP for completed expeditions. Matches the client-side
// formula (5 XP/min base, +50% for >=1h, +100% for >=4h, x2 daily First
// Expedition, x1.2 if petEscortBonusReady is consumed).
const MIN_EXPEDITION_MINUTES = 10;
// Longest legitimate expedition is 4 hours. Anything claimed beyond that is
// either a bot or a buggy client — clip at 240 min so XP / Ryo formulas
// can't be inflated by a forged body.
const MAX_EXPEDITION_MINUTES = 240;
// Hard daily ceiling on claims, even with PET_CAP = 5 pets each running
// back-to-back short expeditions. Stops a 30s-spam attack from accumulating
// thousands of claims/day.
const MAX_EXPEDITIONS_PER_DAY = 12;
function utcDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}
function tamerXpForExpedition(durationMinutes: number, opts: { isFirstToday: boolean; escortReady: boolean }): number {
    if (durationMinutes < MIN_EXPEDITION_MINUTES) return 0;
    const base = Math.floor(durationMinutes * 5);
    let mult = 1;
    if (durationMinutes >= 240) mult = 2;          // +100% for ≥4h
    else if (durationMinutes >= 60) mult = 1.5;    // +50% for ≥1h
    if (opts.isFirstToday) mult *= 2;
    if (opts.escortReady) mult *= 1.2;
    return Math.floor(base * mult);
}

// Pet Tamer mission progress reporter. Pet expedition/training state is
// currently client-side, so this endpoint trusts the client's event claim
// but is rate-limited so it can't be spammed to inflate mission progress.
// Profession XP impact is small (~150 XP per
// mission completion); abuse risk is bounded by daily mission count + the
// per-save professionXp cap.
//
// When a server-side pet system exists, this endpoint should be replaced
// with direct hooks in the expedition/training-claim endpoints.

const VALID_EVENTS = ['expedition', 'long-expedition', 'pet-train'] as const;
type PetEvent = typeof VALID_EVENTS[number];

const EVENT_TO_KIND: Record<PetEvent, 'pet-tamer-expeditions' | 'pet-tamer-long-expeditions' | 'pet-tamer-pet-train'> = {
    'expedition': 'pet-tamer-expeditions',
    'long-expedition': 'pet-tamer-long-expeditions',
    'pet-train': 'pet-tamer-pet-train',
};

const VALID_EXPEDITION_TYPES = PET_EXPEDITION_TYPES;
type ExpType = PetExpeditionType;

// Per-type Ryo/drop tables (mirrors client formula in PetYard.collectExpedition).
const RYO_MULT: Record<ExpType, number> = { scout: 1.35, forage: 1.0, ruins: 1.1 };
const BONE_RATE: Record<ExpType, number> = { scout: 0.25, forage: 0.30, ruins: 0.40 };
const AURA_RATE: Record<ExpType, number> = { scout: 0.00, forage: 0.01, ruins: 0.01 };
const FATE_RATE: Record<ExpType, number> = { scout: 0.05, forage: 0.05, ruins: 0.10 };

/** Boonbringer doubles expedition Ryo and pet XP. Keep this server-owned so a
 * modified client cannot claim the bonus for a pet that does not have it. */
export function petExpeditionTraitMultiplier(pet: Record<string, unknown> | undefined): number {
    return pet?.trait === 'Boonbringer' ? 2 : 1;
}

function petTamerExpeditionMultFromRank(rank: number, profession: unknown): number {
    if (profession !== 'petTamer') return 1;
    const r = Math.max(0, Math.min(10, rank));
    return 1 + (10 + r * 1.5) / 100;
}

/** Free a pet whose expedition lease can't be settled — a legacy lease whose seal
 *  can't be reconstructed (no `serverSeal`, non-Tamer, non-maxed) or a tokenless
 *  pre-feature lease. Such an expedition can never legitimately pay out, so we clear
 *  it at ZERO reward (nothing about the unverifiable run is trusted) rather than let
 *  the pet stay wedged "busy" forever — a stuck lease blocks BOTH new expeditions
 *  and training. `expedition: undefined` (not `delete`) so the JSON autosave +
 *  mergePreservingImages don't resurrect it, matching settleServerPetExpedition.
 *  Matches by the exact lease token, else by petId; returns whether anything changed. */
export function clearStuckExpeditionLease(
    char: Record<string, unknown>,
    match: { token?: string; petId?: string },
): { pets: Array<Record<string, unknown>>; cleared: boolean } {
    const pets = Array.isArray(char.pets) ? char.pets as Array<Record<string, unknown>> : [];
    let cleared = false;
    const next = pets.map((pet) => {
        const exp = pet && typeof pet.expedition === 'object' && pet.expedition ? pet.expedition as Record<string, unknown> : null;
        if (!exp) return pet;
        const byToken = !!match.token && exp.token === match.token;
        const byId = !!match.petId && String(pet.id ?? '') === match.petId;
        if (!byToken && !byId) return pet;
        cleared = true;
        return { ...pet, expedition: undefined };
    });
    return { pets: next, cleared };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // A small burst is valid when collecting queued pet actions. Rate limit
    // BEFORE auth check so spam
    // attempts at unknown names also get throttled.
    const bodyPeek = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    const peekName: string | undefined = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!enforceRateLimit(req, res, 'report-pet-event', 6, 60_000, peekName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        // event/duration/expType/petLevel are re-derived from the sealed
        // expedition token below for expedition events (audit M1), so they're
        // `let`. They stay client-supplied only for the non-currency pet-train.
        let event = String(body.event ?? '') as PetEvent;
        let durationMinutes = Math.max(0, Math.min(MAX_EXPEDITION_MINUTES, Math.floor(Number(body.durationMinutes ?? 0))));
        let expType = (body.expType && VALID_EXPEDITION_TYPES.includes(body.expType) ? body.expType : null) as ExpType | null;
        let petLevel = Math.max(1, Math.min(100, Math.floor(Number(body.petLevel ?? 1))));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!VALID_EVENTS.includes(event)) return res.status(400).json({ error: 'Invalid event.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only report your own events.' });
        }
        if (event === 'pet-train') {
            return res.status(410).json({ error: 'Pet training progress is recorded only when a sealed training session completes.' });
        }

        // Cheap pre-lock peek; the authoritative read happens under the lock below.
        const saveKey = `save:${playerName}`;
        const bodyPetId = String(body.petId ?? '').slice(0, 64);
        // Free an unsettleable expedition lease (legacy null-seal / tokenless) at zero
        // reward so the pet isn't wedged busy forever. Returns the (possibly updated)
        // character + version for the client to mirror. No-op write when nothing matches
        // (e.g. a normal double-claim after the lease was already cleared).
        const selfHealStuckExpedition = (match: { token?: string; petId?: string }) =>
            withKvLock<{ character: Record<string, unknown> | null; saveVersion: number }>(saveKey, async () => {
                const record = await kv.get<Record<string, unknown>>(saveKey);
                const char = record?.character as Record<string, unknown> | undefined;
                if (!record || !char) return { character: null, saveVersion: 0 };
                const { pets, cleared } = clearStuckExpeditionLease(char, match);
                if (!cleared) return { character: char, saveVersion: Number(record._saveVersion ?? 0) };
                const updated = bumpSaveVersion<Record<string, unknown>>({ ...record, character: { ...char, pets } });
                await kv.set(saveKey, mergePreservingImages(updated, record));
                return { character: updated.character as Record<string, unknown>, saveVersion: Number(updated._saveVersion ?? 0) };
            }, { failClosed: true });
        const preCheck = await kv.get<Record<string, unknown>>(saveKey);
        const preChar = preCheck?.character as Record<string, unknown> | undefined;
        const isTamer = preChar?.profession === 'petTamer';
        const isExpeditionEvent = event === 'expedition' || event === 'long-expedition';
        // Pet Tamers get the full flow (currency + XP + missions). Non-Tamers are
        // allowed ONLY for expedition events, and ONLY with a valid token — which
        // the server mints solely for a maxed pet — earning half-rate currency,
        // no Tamer XP and no mission progress. pet-train (and any tokenless path)
        // from a non-Tamer earns nothing.
        if (!isTamer && !isExpeditionEvent) {
            return res.status(200).json({ ok: true, petTamer: false });
        }

        // ── Expedition token: REQUIRED, single-use, time-gated (audit M1) ──
        // Expedition rewards (Ryo + premium drops + Tamer XP) are gated on a
        // token minted by /api/missions/expedition-start at launch. The token
        // seals expType/duration/petLevel so they can't be tampered with at
        // redeem, and an endsAt the redeem must be past so rewards require the
        // expedition to have actually run for its full duration. No fallback: an
        // expedition event without a valid, matured token earns nothing (returns
        // 200 + a reason so the client mirrors the zero-reward result cleanly).
        const NO_REWARD = { expeditionXp: 0, ryoEarned: 0, foundBone: 0, foundAura: 0, foundFate: 0, missionsCompleted: [] as never[] };
        // Pet Tamer mastery (Expeditioner path) reward multipliers, sealed into the
        // token at launch (PvE currency only). Default 1 = no bonus.
        let expRewardMult = 1;
        let expMaterialMult = 1;
        // Reward scale + Tamer flag sealed at mint. Defaults (1 / true) keep tokens
        // minted before the non-Tamer half-rate path redeeming at full Tamer rate.
        let rewardScale = 1;
        let tamerToken = true;
        let expeditionPetId = '';
        let expeditionTokenKey: string | null = null;
        let expeditionReceipt = '';
        if (event === 'expedition' || event === 'long-expedition') {
            const tokRaw: string | undefined = typeof body.expeditionToken === 'string' && body.expeditionToken.trim() ? body.expeditionToken.trim() : undefined;
            const tok = tokRaw && /^[A-Za-z0-9]+$/.test(tokRaw) ? tokRaw : undefined;
            if (!tok) {
                const healed = await selfHealStuckExpedition({ petId: bodyPetId });
                return res.status(200).json({ ok: true, petTamer: true, reason: 'missing-expedition-token', ...NO_REWARD, character: healed.character, _saveVersion: healed.saveVersion });
            }
            const tokenKey = `pet-exp-token:${playerName}:${tok}`;
            let tokenData = await kv.get<PetExpeditionSeal>(tokenKey);
            if (!tokenData) {
                // KV is an expiring acceleration cache. The exact server-owned
                // pet lease remains durable claim authority after that cache ages
                // out, including a conservative migration path for older leases.
                const current = await kv.get<Record<string, unknown>>(saveKey);
                tokenData = petExpeditionSealForToken(current?.character, tok, playerName);
            }
            if (!tokenData || tokenData.playerName.toLowerCase() !== playerName.toLowerCase()) {
                const healed = await selfHealStuckExpedition({ token: tok, petId: bodyPetId });
                return res.status(200).json({ ok: true, petTamer: true, reason: 'invalid-or-spent-expedition-token', ...NO_REWARD, character: healed.character, _saveVersion: healed.saveVersion });
            }
            // Must have actually elapsed (60s grace for clock/latency skew).
            if (Date.now() < Number(tokenData.endsAt ?? 0) - 60_000) {
                return res.status(200).json({ ok: true, petTamer: true, reason: 'expedition-not-complete', ...NO_REWARD });
            }
            // Remember the token key; it is consumed under the save lock below.
            expeditionTokenKey = tokenKey;
            expeditionReceipt = tok;
            // Drive all reward math from the SEALED token values, not the client
            // body — including the expedition/long-expedition split (long fires
            // extra mission progress) which is re-derived from the sealed duration.
            if (tokenData.expType && VALID_EXPEDITION_TYPES.includes(tokenData.expType)) expType = tokenData.expType;
            durationMinutes = Math.max(0, Math.min(MAX_EXPEDITION_MINUTES, Math.floor(Number(tokenData.durationMinutes ?? durationMinutes))));
            petLevel = Math.max(1, Math.min(100, Math.floor(Number(tokenData.petLevel ?? petLevel))));
            event = durationMinutes >= 240 ? 'long-expedition' : 'expedition';
            // Capture the sealed mastery multipliers (clamped for safety).
            expRewardMult = Math.max(1, Math.min(2, Number(tokenData.expRewardMult ?? 1)));
            expMaterialMult = Math.max(1, Math.min(2, Number(tokenData.expMaterialMult ?? 1)));
            // Sealed reward scale (clamped 0..1) + Tamer flag. A non-Tamer token
            // carries rewardScale 0.5 and tamer=false → half currency, no XP/missions.
            rewardScale = Math.max(0, Math.min(1, Number(tokenData.rewardScale ?? 1)));
            tamerToken = tokenData.tamer !== false;
            expeditionPetId = String(tokenData.petId ?? '');
        }

        // For expedition events, server computes Tamer XP AND the Ryo + drop
        // currencies (previously client-trusted). Pet stat/XP gains stay
        // client-side since they're per-pet state not global currency.
        //
        // Wrap the whole daily-counter check + currency credit in
        // withKvLock(save:<player>) so a concurrent /api/save auto-save can't
        // clobber the credit (previously an unlocked RMW — concurrent saves
        // could lose ryo / bone / aura / fate, or double-consume the escort
        // bonus). awardProfessionXp + reportMissionEvent run OUTSIDE the
        // lock because they take their own save lock.
        let expeditionXp = 0;
        let ryoEarned = 0;
        let foundBone = 0;
        let foundAura = 0;
        let foundFate = 0;
        let dailyCapHit = false;
        let tokenAlreadySpent = false;
        const isExpedition = event === 'expedition' || event === 'long-expedition';
        if (isExpedition && durationMinutes > 0) {
            // ── withKvLock: the daily-cap check + write must be atomic ────
            // Two concurrent expedition claims (multi-tab race) used to both
            // read the same `expeditionsClaimedToday`, both pass the cap
            // check, and both grant ryo/drops/Tamer XP. The lock serializes
            // them so the second sees the updated counter and short-circuits.
            await withKvLock(saveKey, async () => {
                const record = await kv.get<Record<string, unknown>>(saveKey);
                const char = record?.character as Record<string, unknown> | undefined;
                if (!char) return; // race: save deleted mid-call
                if (expeditionTokenKey) {
                    const receipts = Array.isArray(char.redeemedPetExpeditionTokens)
                        ? (char.redeemedPetExpeditionTokens as unknown[]).filter((entry): entry is string => typeof entry === 'string').slice(-63)
                        : [];
                    if (receipts.includes(expeditionReceipt)) {
                        await kv.del(expeditionTokenKey).catch(() => undefined);
                        tokenAlreadySpent = true;
                        return;
                    }
                    // The claim must still own this exact saved lease. A delayed
                    // response from an older expedition can never settle or clear
                    // a newer expedition for the same pet.
                    const pets = Array.isArray(char.pets) ? char.pets as Array<Record<string, unknown>> : [];
                    const leasePet = pets.find((pet) => String(pet?.id ?? '') === expeditionPetId);
                    const lease = leasePet?.expedition && typeof leasePet.expedition === 'object'
                        ? leasePet.expedition as Record<string, unknown>
                        : null;
                    if (!lease || lease.token !== expeditionReceipt) {
                        await kv.del(expeditionTokenKey).catch(() => undefined);
                        tokenAlreadySpent = true;
                        return;
                    }
                    char.redeemedPetExpeditionTokens = [...receipts, expeditionReceipt];
                }

                const today = utcDateKey();
                const sameDay = char.lastExpeditionClaimDate === today;
                const claimedToday = sameDay ? Number(char.expeditionsClaimedToday ?? 0) : 0;
                // Caravan Master mastery capstone: +2 to the daily expedition cap.
                const dailyCap = MAX_EXPEDITIONS_PER_DAY + (masteryHasCapstone('petTamer', char.masterySpec, 'caravan-master') ? 2 : 0);
                if (claimedToday >= dailyCap) {
                    dailyCapHit = true;
                    const pets = Array.isArray(char.pets) ? char.pets as Array<Record<string, unknown>> : [];
                    const nextPets = pets.map((pet) => String(pet?.id ?? '') === expeditionPetId
                        ? settleServerPetExpedition(pet, expType ?? 'scout', durationMinutes, 1).pet
                        : pet);
                    const cappedUpdated = bumpSaveVersion({ ...record, character: { ...char, pets: nextPets } });
                    await kv.set(saveKey, mergePreservingImages(cappedUpdated, record));
                    if (expeditionTokenKey) await kv.del(expeditionTokenKey).catch(() => undefined);
                    return;
                }
                const isFirstToday = claimedToday === 0;
                const escortReady = !!char.petEscortBonusReady;
                const rank = Number(char.professionRank ?? 1);
                const rewardPet = (Array.isArray(char.pets) ? char.pets as Array<Record<string, unknown>> : [])
                    .find((pet) => String(pet?.id ?? '') === expeditionPetId);
                const boonMult = petExpeditionTraitMultiplier(rewardPet);

                // Tamer XP only on the full Tamer path; a non-Tamer (half-rate
                // maxed-pet) token earns currency only.
                expeditionXp = tamerToken ? tamerXpForExpedition(durationMinutes, { isFirstToday, escortReady }) : 0;

                // Ryo + drop calculation (mirrors client formula). Requires expType.
                if (expType) {
                    const durationHours = Math.max(1, durationMinutes / 60);
                    // Non-Tamer tokens get NO rank mult, NO First-Expedition 2x and
                    // NO mastery — just the base formula scaled by rewardScale (0.5):
                    // exactly half a Tamer's base ryo and half the base drop chances.
                    const tamerMult = tamerToken ? petTamerExpeditionMultFromRank(rank, char.profession) : 1;
                    const firstBonus = tamerToken && isFirstToday ? 2 : 1;
                    const dropBonus = tamerToken ? (tamerMult - 1) + (isFirstToday ? 0.5 : 0) : 0;

                    ryoEarned = Math.round((90 * durationHours * RYO_MULT[expType] + petLevel * 6) * tamerMult * firstBonus * expRewardMult * rewardScale * boonMult);
                    foundBone = Math.random() < (BONE_RATE[expType] + dropBonus) * expMaterialMult * rewardScale ? 1 : 0;
                    foundAura = Math.random() < (AURA_RATE[expType] + dropBonus * 0.1) * expMaterialMult * rewardScale ? 1 : 0;
                    foundFate = Math.random() < (FATE_RATE[expType] + dropBonus * 0.1) * expMaterialMult * rewardScale ? 1 : 0;
                }

                // Stamp daily tracking + consume escort bonus + apply currencies.
                const pets = Array.isArray(char.pets) ? char.pets as Array<Record<string, unknown>> : [];
                const petXpMult = (tamerToken ? petTamerExpeditionMultFromRank(rank, char.profession) * (isFirstToday ? 2 : 1) : 1) * boonMult;
                const nextPets = pets.map((pet) => String(pet?.id ?? '') === expeditionPetId
                    ? settleServerPetExpedition(pet, expType ?? 'scout', durationMinutes, petXpMult).pet
                    : pet);
                const expeditionPet = pets.find((pet) => String(pet?.id ?? '') === expeditionPetId);
                const progressedCharacter = recordPetBreedingProgress({
                    ...char,
                    pets: nextPets,
                    lastExpeditionClaimDate: today,
                    expeditionsClaimedToday: claimedToday + 1,
                    ryo: Number(char.ryo ?? 0) + ryoEarned,
                    boneCharms: Number(char.boneCharms ?? 0) + foundBone,
                    auraStones: Number(char.auraStones ?? 0) + foundAura,
                    fateShards: Number(char.fateShards ?? 0) + foundFate,
                    ...(escortReady ? { petEscortBonusReady: false } : {}),
                }, {
                    kind: 'expedition-complete',
                    petElement: String(expeditionPet?.element ?? ''),
                    receipt: `expedition:${expeditionReceipt}`,
                }).character;
                const updated = bumpSaveVersion({
                    ...record,
                    character: progressedCharacter,
                });
                await kv.set(saveKey, mergePreservingImages(updated, record));
                if (expeditionTokenKey) await kv.del(expeditionTokenKey).catch(() => undefined);
            }, { failClosed: true });
            if (tokenAlreadySpent) {
                const current = await kv.get<Record<string, unknown>>(saveKey);
                return res.status(200).json({ ok: true, petTamer: isTamer, reason: 'invalid-or-spent-expedition-token', ...NO_REWARD, character: current?.character ?? null, _saveVersion: Number(current?._saveVersion ?? 0) });
            }
            // failClosed: this credits real currency (ryo/bone/aura/fate), so under
            // sustained save-lock contention we abort before consuming the token.
            // A retry can then redeem the same completed expedition cleanly.

            // Daily cap reached — short-circuit cleanly with the same shape
            // the pre-lock cap check used to return.
            if (dailyCapHit) {
                const capRecord = await kv.get<Record<string, unknown>>(saveKey);
                return res.status(200).json({
                    ok: true,
                    petTamer: isTamer,
                    reason: 'daily-expedition-cap',
                    expeditionXp: 0,
                    ryoEarned: 0,
                    foundBone: 0,
                    foundAura: 0,
                    foundFate: 0,
                    missionsCompleted: [],
                    character: capRecord?.character ?? null,
                    _saveVersion: Number(capRecord?._saveVersion ?? 0),
                });
            }

            // Grant Tamer XP (subject to per-save cap and Rank-2 multiplier).
            // awardProfessionXp acquires its own lock — kept outside the
            // expedition-counter lock above so we don't nest lock acquires.
            if (expeditionXp > 0) {
                await awardProfessionXp(playerName, 'petTamer', expeditionXp);
            }
            // Legacy tracking (ENABLE_LEGACY): a token-validated expedition.
            await bumpLegacyStats(playerName, { petExpeditions: 1 });
        }

        // Mission progress + profession XP are Pet Tamer–only. A non-Tamer earns
        // just the half-rate currency credited above (no missions, no XP).
        let missionsCompleted: CompletedMissionInfo[] = [];
        let extraCompleted: CompletedMissionInfo[] = [];
        let missionXpAwarded = 0;
        if (isTamer) {
            const kind = EVENT_TO_KIND[event];
            const result = await reportMissionEvent({
                playerName,
                profession: 'petTamer',
                kind,
            });
            missionsCompleted = result.missionsCompleted;
            missionXpAwarded = result.xpAwarded;

            // For long-expedition events also fire the regular expedition counter
            // (a 4hr+ expedition counts as both a "completed expedition" and a
            // "long expedition" toward the relevant missions).
            if (event === 'long-expedition') {
                const extra = await reportMissionEvent({
                    playerName,
                    profession: 'petTamer',
                    kind: 'pet-tamer-expeditions',
                });
                extraCompleted = extra.missionsCompleted;
            }
        }

        // Re-read for the final post-grant state.
        const finalRecord = await kv.get<Record<string, unknown>>(saveKey);
        const finalChar = finalRecord?.character as Record<string, unknown> | undefined;

        return res.status(200).json({
            ok: true,
            petTamer: isTamer,
            expeditionXp,
            ryoEarned,
            foundBone,
            foundAura,
            foundFate,
            balances: {
                ryo: Number(finalChar?.ryo ?? 0),
                boneCharms: Number(finalChar?.boneCharms ?? 0),
                auraStones: Number(finalChar?.auraStones ?? 0),
                fateShards: Number(finalChar?.fateShards ?? 0),
            },
            missionXpAwarded,
            missionsCompleted: [...missionsCompleted, ...extraCompleted],
            ...(isTamer ? {
                professionXp: Number(finalChar?.professionXp ?? 0),
                professionRank: Number(finalChar?.professionRank ?? 1),
            } : {}),
            _saveVersion: Number(finalRecord?._saveVersion ?? 0),
            character: finalChar,
        });
    } catch (err) {
        console.error('[missions/report-pet-event]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
