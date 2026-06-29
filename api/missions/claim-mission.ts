import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { gainXp } from '../_xp-engine.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { utcDateKey, reportNewbieEvent } from './_progress.js';
import { recordEconomyTxn } from '../_economy.js';
import {
    combatMissionByKey,
    fieldMissionById,
    huntMissionById,
    ACADEMY_TRIAL,
    ACADEMY_CHECKLIST,
    missionRewardBonusPct,
    boostAmount,
    hasDailyMissionSlot,
    hasDailyHuntSlot,
    markMissionCompletedFields,
    markHuntCompletedFields,
    applyCurrencyRewardFields,
    grantTerritoryScrollsToInventory,
    grantItemsToInventory,
    FIELD_MISSION_SCROLLS,
    HUNT_MISSION_SCROLLS,
    type CurrencyKey,
} from './_mission-catalog.js';

// Server-authoritative mission claim. Replaces the old client-side reward math
// for built-in COMBAT, FIELD and HUNT missions and the onboarding ACADEMY-TRIAL:
// the client posts only { missionType, missionId } — never amounts — and the
// server resolves the reward from the trusted catalog, recomputes XP with the
// same engine as the client (api/_xp-engine.gainXp), enforces eligibility,
// persists under the save lock, and returns the server-computed amounts for the
// client to mirror onto its local character (reconcile pattern as report-pet-event).
//
// Eligibility enforced server-side (against the SAVED character, not the body):
//   • combat       — missionId must be in pendingCombatMissionClaims (queued by
//                    the Arena win); consumed on claim. Counts toward daily cap.
//   • field        — level requirement + daily cap. (Explore/raid progress stays
//                    client-tracked — same trust model as raids/expeditions.)
//   • hunt         — Hunter Guild contract: level req + the INDEPENDENT daily
//                    hunt cap; grants material drops (itemRewards) server-side so
//                    they can't be minted client-side (audit M-1). Hunt progress
//                    (explore count) stays client-tracked like field missions.
//   • academy-trial— one-time (character.academyTrialClaimed). OFF the daily cap.
//
// Unknown / creator-authored mission ids are not in the catalog → the response
// signals clientFallback so the (unchanged) client path can still pay those.

const monthKeyOf = (): string => new Date().toISOString().slice(0, 7);

type SaveChar = Record<string, unknown>;

type ClaimOutcome =
    | { applied: false; reason: string; clientFallback?: boolean }
    | {
        applied: true;
        reward: {
            xpBoosted: number;        // base after town-hall boost; client passes to gainXp
            ryo: number;
            stamina: number;
            territoryScrolls: number;
            currency: Partial<Record<CurrencyKey, number>>;
            items: string[];          // literal item ids (hunt material drops)
        };
        combat?: { aiProfileId: string; missionKey: string };
        completion: 'daily' | 'total' | 'none' | 'hunt';
        academyTrialClaimed?: boolean;
        academyChecklistClaimed?: boolean;
    };

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const bodyPeek = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    const peekName: string | undefined = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!enforceRateLimit(req, res, 'claim-mission', 5, 10_000, peekName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const missionType = String(body.missionType ?? '');
        const missionId = String(body.missionId ?? '').slice(0, 80);
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (missionType !== 'combat' && missionType !== 'field' && missionType !== 'hunt' && missionType !== 'academy-trial' && missionType !== 'academy-checklist') {
            return res.status(400).json({ error: 'Invalid mission type.' });
        }

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only claim your own missions.' });
        }

        const saveKey = `save:${playerName}`;
        const todayKey = utcDateKey();
        const monthKey = monthKeyOf();

        // Currency path: persist under the SAME lock the save endpoint uses so a
        // concurrent auto-save can't clobber the credit, and so two rapid claims
        // can't both slip past the one-time / daily-cap / pending checks.
        const outcome = await withKvLock<ClaimOutcome>(saveKey, async () => {
            const record = await kv.get<Record<string, unknown>>(saveKey);
            const char = record?.character as SaveChar | undefined;
            if (!record || !char) return { applied: false, reason: 'no-save' };

            const bonusPct = missionRewardBonusPct(char);

            // ── Resolve mission + per-type eligibility ──────────────────────
            let baseXp = 0, baseRyo = 0, baseStamina = 0;
            let scrolls = 0;
            let items: string[] = [];
            let currencyBase: Partial<Record<CurrencyKey, number>> | undefined;
            let combat: { aiProfileId: string; missionKey: string } | undefined;
            let completion: 'daily' | 'total' | 'none' | 'hunt' = 'daily';
            let academyTrialClaimed = false;
            let academyChecklistClaimed = false;

            if (missionType === 'combat') {
                const def = combatMissionByKey(missionId);
                if (!def) return { applied: false, reason: 'unknown-mission', clientFallback: true };
                if (Number(char.level ?? 1) < def.min) return { applied: false, reason: 'level' };
                const pending = Array.isArray(char.pendingCombatMissionClaims) ? char.pendingCombatMissionClaims as string[] : [];
                if (!pending.includes(def.key)) return { applied: false, reason: 'not-queued' };
                if (!hasDailyMissionSlot(char, todayKey)) return { applied: false, reason: 'daily-cap' };
                baseXp = def.xp; baseRyo = def.ryo; scrolls = def.territoryScrolls;
                combat = { aiProfileId: def.aiProfileId, missionKey: def.key };
                completion = 'daily';
            } else if (missionType === 'field') {
                const def = fieldMissionById(missionId);
                if (!def) return { applied: false, reason: 'unknown-mission', clientFallback: true };
                if (Number(char.level ?? 1) < def.levelReq) return { applied: false, reason: 'level' };
                if (!hasDailyMissionSlot(char, todayKey)) return { applied: false, reason: 'daily-cap' };
                baseXp = def.xpReward; baseRyo = def.ryoReward; baseStamina = def.staminaReward;
                scrolls = FIELD_MISSION_SCROLLS; currencyBase = def.currencyRewards;
                completion = 'daily';
            } else if (missionType === 'hunt') {
                // Hunter Guild contract — own daily pool, grants material drops.
                // Creator-authored hunts aren't in the catalog → clientFallback.
                const def = huntMissionById(missionId);
                if (!def) return { applied: false, reason: 'unknown-mission', clientFallback: true };
                if (Number(char.level ?? 1) < def.levelReq) return { applied: false, reason: 'level' };
                if (!hasDailyHuntSlot(char, todayKey)) return { applied: false, reason: 'daily-cap' };
                baseXp = def.xpReward; baseRyo = def.ryoReward; baseStamina = def.staminaReward;
                scrolls = HUNT_MISSION_SCROLLS; currencyBase = def.currencyRewards;
                items = def.itemRewards ?? [];
                completion = 'hunt';
            } else if (missionType === 'academy-trial') {
                // academy-trial — one-time, off the daily cap.
                if (char.academyTrialClaimed) return { applied: false, reason: 'already-claimed' };
                baseXp = ACADEMY_TRIAL.xp; baseRyo = ACADEMY_TRIAL.ryo; baseStamina = ACADEMY_TRIAL.stamina;
                completion = 'total';
                academyTrialClaimed = true;
            } else {
                // academy-checklist — the one-time graduation capstone. Off the
                // daily cap, doesn't count toward mission totals (completion 'none'),
                // grants a small premium (Fate Shards) bonus from the sealed catalog.
                if (char.academyChecklistClaimed) return { applied: false, reason: 'already-claimed' };
                baseXp = ACADEMY_CHECKLIST.xp; baseRyo = ACADEMY_CHECKLIST.ryo; baseStamina = ACADEMY_CHECKLIST.stamina;
                currencyBase = { fateShards: ACADEMY_CHECKLIST.fateShards };
                completion = 'none';
                academyChecklistClaimed = true;
            }

            // Per-mission idempotency for field/hunt claims: each built-in
            // field/hunt mission is claimable at most once per UTC day (matches
            // the UI's one-card-per-mission model). The daily cap alone doesn't
            // stop a client re-POSTing the single highest-value mission id up to
            // the cap, and the explore/raid prerequisite is only client-tracked,
            // so without this the best mission is re-claimable N times/day (audit
            // #2). The NX reserve lives inside the save lock so it settles
            // atomically with the payout, and fails OPEN (a KV hiccup never denies
            // a legit claim). Combat (pendingCombatMissionClaims, consumed on
            // claim) and academy-trial (academyTrialClaimed latch) are already
            // single-use, so only field/hunt need this.
            if (missionType === 'field' || missionType === 'hunt') {
                const claimKey = `missions:field-claimed:${playerName}:${missionId}:${todayKey}`;
                const placed = await kv.set(claimKey, '1', { nx: true, ex: 26 * 60 * 60 }).catch(() => 'OK' as const);
                if (placed === null) return { applied: false, reason: 'already-claimed-today' };
            }

            // ── Compute server-authoritative amounts ────────────────────────
            const xpBoosted = boostAmount(baseXp, bonusPct);
            const ryoBoosted = boostAmount(baseRyo, bonusPct);
            const staminaBoosted = baseStamina > 0 ? boostAmount(baseStamina, bonusPct) : 0;

            // ── Apply onto the saved character ──────────────────────────────
            let next = gainXp(char, xpBoosted) as SaveChar;
            next = { ...next, ryo: Number(next.ryo ?? 0) + ryoBoosted };
            if (staminaBoosted > 0) {
                const maxStamina = Number(next.maxStamina ?? 0);
                next = { ...next, stamina: Math.min(maxStamina, Number(next.stamina ?? 0) + staminaBoosted) };
            }
            if (scrolls > 0) {
                next = { ...next, inventory: grantTerritoryScrollsToInventory(next, scrolls) };
            }
            if (items.length > 0) {
                next = { ...next, inventory: grantItemsToInventory(next, items) };
            }
            const currencyFields = applyCurrencyRewardFields(next, currencyBase);
            next = { ...next, ...currencyFields };

            if (combat) {
                const aiId = combat.aiProfileId;
                const missionKey = combat.missionKey;
                const defeated = Array.isArray(next.defeatedAiIds) ? next.defeatedAiIds as string[] : [];
                const aiKills = (next.aiKills && typeof next.aiKills === 'object') ? next.aiKills as Record<string, number> : {};
                const pending = Array.isArray(next.pendingCombatMissionClaims) ? next.pendingCombatMissionClaims as string[] : [];
                next = {
                    ...next,
                    totalAiKills: Number(next.totalAiKills ?? 0) + 1,
                    dailyAiKills: Number(next.dailyAiKills ?? 0) + 1,
                    defeatedAiIds: defeated.includes(aiId) ? defeated : [...defeated, aiId],
                    aiKills: { ...aiKills, [aiId]: Number(aiKills[aiId] ?? 0) + 1 },
                    pendingCombatMissionClaims: pending.filter((k) => k !== missionKey),
                };
            }

            if (completion === 'daily') {
                next = { ...next, ...markMissionCompletedFields(next, todayKey, monthKey) };
            } else if (completion === 'hunt') {
                next = { ...next, ...markHuntCompletedFields(next, todayKey, monthKey) };
            } else if (completion === 'total') {
                next = {
                    ...next,
                    clanMissionContrib: Number(next.clanMissionContrib ?? 0) + 1,
                    totalMissionsCompleted: Number(next.totalMissionsCompleted ?? 0) + 1,
                    clanContribMonth: monthKey,
                };
            }
            if (academyTrialClaimed) next = { ...next, academyTrialClaimed: true };
            if (academyChecklistClaimed) next = { ...next, academyChecklistClaimed: true };

            const updated = { ...record, character: next };
            bumpSaveVersion(updated);
            await kv.set(saveKey, mergePreservingImages(updated, record));

            return {
                applied: true,
                reward: {
                    xpBoosted,
                    ryo: ryoBoosted,
                    stamina: staminaBoosted,
                    territoryScrolls: scrolls,
                    currency: currencyBase ? { ...currencyBase } : {},
                    items: [...items],
                },
                combat,
                completion,
                ...(academyTrialClaimed ? { academyTrialClaimed: true } : {}),
                ...(academyChecklistClaimed ? { academyChecklistClaimed: true } : {}),
            };
        }, { failClosed: true });

        // New-shinobi dailies: a successful mission claim is the main activity
        // signal for pre-profession players. reportNewbieEvent no-ops for anyone
        // who has a profession and takes its own locks, so it runs AFTER the
        // claim's save lock has released (no nested locking). Best-effort — a
        // failure here must never fail the (already-applied) claim.
        if (outcome.applied) {
            try {
                await reportNewbieEvent({ playerName, kind: 'newbie-missions' });
                if (missionType === 'combat') {
                    await reportNewbieEvent({ playerName, kind: 'newbie-battle-wins' });
                }
            } catch (e) {
                console.error('[claim-mission newbie]', e);
            }
            // Economy telemetry — log the server-computed faucet deltas (ryo +
            // any premium currency) so created-vs-destroyed is measurable.
            const r = outcome.reward;
            if (r.ryo) await recordEconomyTxn({ txnId: `mission:${missionType}:${missionId}:${todayKey}`, player: playerName, currency: 'ryo', delta: r.ryo, source: 'mission.claim' });
            for (const [cur, amt] of Object.entries(r.currency ?? {})) {
                if (amt) await recordEconomyTxn({ txnId: `mission:${missionType}:${missionId}:${cur}:${todayKey}`, player: playerName, currency: cur, delta: Number(amt), source: 'mission.claim' });
            }
        }

        return res.status(200).json({ ok: true, ...outcome });
    } catch (err) {
        console.error('[missions/claim-mission]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
