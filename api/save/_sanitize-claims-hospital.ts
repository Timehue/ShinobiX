import { FORBIDDEN_CREATOR_CHARACTER_FIELDS, DAILY_CLAIM_DATE_FIELDS, MONOTONIC_DATE_CHARACTER_FIELDS } from './_state-ownership.js';
import { DISCHARGE_GRACE_MS, HOSPITAL_DURATION_MS } from './_sanitize-ledger.js';

export function sanitizeClaimsAndHospital(char: Record<string, unknown>, exChar: Record<string, unknown>) {

    // Admin-only "creator" content (jutsus / items / AIs / missions / events /
    // cards / raids) should NEVER live on a player save. The legitimate
    // source of truth is save:admin*. If a tampered client tries to inject
    // these fields into a non-admin save, strip them outright so they can't
    // round-trip into anyone's gameplay state.
    for (const field of FORBIDDEN_CREATOR_CHARACTER_FIELDS) delete char[field];

    // Daily-claim date stamps (claimedVillageAgendaDate / claimedMapControlDate)
    // gate once-per-UTC-day rewards on the client. If the client could write
    // any string here, a player rolling their system clock could "claim,
    // unclaim, claim again" by setting the stamp to a different date. Lock
    // these to the server's actual UTC today: incoming may either be empty
    // (no claim today) or exactly the server's date string. Any other value
    // (a future date, last week, "1970-01-01", etc.) is forced back to
    // whatever was previously stored, so the legitimate-today claim still
    // survives but backdating doesn't.
    const SERVER_UTC_DATE = new Date().toISOString().slice(0, 10);
    // warGroundBountyDate gates the once-per-UTC-day War Ground bounty (+500
    // ryo, +1 Fate Shard — see App.tsx). Same backdating risk as the other
    // daily-claim stamps: setting it to a different date re-opens the bounty.
    // Locked to the server's UTC today by the same rule below. (audit #12)
    // DAILY_CLAIM_DATE_FIELDS derives from the ownership manifest
    // ('daily-claim-date-char').
    for (const field of DAILY_CLAIM_DATE_FIELDS) {
        const incomingDate = char[field];
        if (typeof incomingDate !== 'string' || incomingDate === '') continue;
        if (incomingDate !== SERVER_UTC_DATE) {
            // Either a forged future date or a backdated reset. Revert to
            // the existing server-side value (which itself can only have
            // been set by a legit prior pass through this same check).
            char[field] = exChar[field] ?? '';
        }
    }

    // War-Ground bounty server floor (audit #21). The bounty (+500 ryo, +1 Fate
    // Shard) is gated client-side by warGroundBountyDate. The date-stamp lock
    // above stops BACKDATING the stamp, but a tampered client could keep the
    // stamp at today AND re-add the +500 ryo / +1 fate shard to its wallet on a
    // later autosave — a within-day re-mint. Defense-in-depth: if the SERVER-
    // stored save already shows the bounty claimed today
    // (exChar.warGroundBountyDate === SERVER_UTC_DATE), ryo and fateShards may
    // not GROW from this save (mirrors the dailyHollowGateRuns / dailyMissions-
    // Completed monotonic-floor pattern, but in the can't-grow direction — the
    // bounty already paid out today). Decreases (spending) pass through freely.
    // On a real new day exChar's stamp != today so this is skipped and the
    // fresh bounty claim is untouched. NOTE: legit non-bounty ryo/fateShard
    // gains (mission/fight rewards) that land in the SAME save as a duplicate
    // bounty attempt are also held to the stored value here — but those
    // currencies flow through server-authoritative endpoints under the save lock
    // (claim-mission, pvp/claim-rewards), so by the time an autosave runs the
    // stored value already reflects them and this clamp is a no-op re-assert for
    // honest play.
    if (exChar.warGroundBountyDate === SERVER_UTC_DATE) {
        const exRyoFloor = Math.max(0, Number(exChar.ryo ?? 0));
        char.ryo = Math.min(Math.max(0, Number(char.ryo) || 0), exRyoFloor);
        const exFateFloor = Math.max(0, Number(exChar.fateShards ?? 0));
        char.fateShards = Math.min(Math.max(0, Number(char.fateShards) || 0), exFateFloor);
    }

    // Hollow Gate daily run cap (dailyHollowGateRuns) is gated client-side via
    // lastDailyReset. Defense-in-depth: if the SERVER-stored save was last written
    // today (exChar.lastDailyReset === SERVER_UTC_DATE), the run count can only go
    // UP within the day — so a forged save can't reset it to 0 to farm extra runs.
    // On a real new day exChar.lastDailyReset != today, the floor is 0, and the
    // legit daily reset is untouched. (A determined tamper that ALSO backdates
    // lastDailyReset resets all the player's other daily counters too, so it is
    // self-limiting; a fully server-authoritative cap would need a dedicated
    // server-stamped HG date field.)
    if (exChar.lastDailyReset === SERVER_UTC_DATE) {
        const floorRuns = Math.max(0, Math.floor(Number(exChar.dailyHollowGateRuns ?? 0)));
        const incomingRuns = Math.max(0, Math.floor(Number(char.dailyHollowGateRuns ?? 0)));
        char.dailyHollowGateRuns = Math.max(incomingRuns, floorRuns);
    }

    // Daily-reset stamps (lastDailyReset / lastHuntReset) gate the per-day
    // mission / hunt / AI-kill / fate-spin counters. They only ever ADVANCE — a
    // real day roll moves them forward. A tampered save that BACKDATES one resets
    // every daily counter it gates (re-opening the claim-mission daily cap [audit
    // #1] and, via lastDailyReset, the Hollow Gate run cap [audit #7]). Force them
    // monotonic-forward: an incoming date older than the stored one is reverted to
    // the stored value, so the backdate can't persist. A forward move to a newer
    // date (the legit midnight reset) is untouched, as is the first-ever set.
    //
    // They are also never allowed PAST the server's UTC today. A device clock
    // running ahead (or a forged stamp) would otherwise pre-stamp tomorrow — and
    // because the stamp is monotonic that could never be corrected, so every
    // same-day floor below (`exChar.<stamp> === SERVER_UTC_DATE`) would be
    // skipped for a whole day, re-opening the daily caps. A future stamp is
    // clamped to SERVER_UTC_DATE before the monotonic rule runs. If the STORED
    // stamp is itself in the future (written before this clamp existed) it is
    // allowed to come back down to today rather than pin forever.
    for (const field of MONOTONIC_DATE_CHARACTER_FIELDS) {
        const stored = typeof exChar[field] === 'string' ? (exChar[field] as string) : '';
        let incoming = typeof char[field] === 'string' ? (char[field] as string) : '';
        if (!incoming) continue;
        if (incoming > SERVER_UTC_DATE) incoming = SERVER_UTC_DATE;
        if (stored && stored <= SERVER_UTC_DATE && incoming < stored) incoming = stored;
        char[field] = incoming;
    }

    // Daily mission / hunt completion counters are the ONLY thing bounding the
    // server-authoritative claim-mission payouts (api/missions/claim-mission.ts),
    // which write ryo + premium currency directly under the save lock — bypassing
    // this endpoint's per-save ryo/currency caps. So if the client could zero
    // these mid-day it could re-claim the highest-value missions unbounded (audit
    // #1). Floor them at the server-stored value within the same UTC day
    // (monotonic-up, exactly like dailyHollowGateRuns above); the legit midnight
    // reset is preserved because on a real new day exChar's stamp != today, so
    // the floor is skipped and the counter is free to drop to 0.
    if (exChar.lastDailyReset === SERVER_UTC_DATE) {
        const floorM = Math.max(0, Math.floor(Number(exChar.dailyMissionsCompleted ?? 0)));
        const inM = Math.max(0, Math.floor(Number(char.dailyMissionsCompleted ?? 0)));
        char.dailyMissionsCompleted = Math.max(inM, floorM);
        // dailyPetWins is the same shape of guard for the pet-arena ryo faucet:
        // api/pet/battle-result.ts and api/pet/showdown.ts read this counter
        // straight off the save to decide whether the 100/day cap is spent, so a
        // save carrying a lower value re-opens the cap for another hundred wins.
        // It does not even take a tampered client — a second tab holding a stale
        // count zeroes it on its next autosave.
        const floorP = Math.max(0, Math.floor(Number(exChar.dailyPetWins ?? 0)));
        const inP = Math.max(0, Math.floor(Number(char.dailyPetWins ?? 0)));
        char.dailyPetWins = Math.max(inP, floorP);
    }
    if (exChar.lastHuntReset === SERVER_UTC_DATE) {
        const floorH = Math.max(0, Math.floor(Number(exChar.dailyHuntsCompleted ?? 0)));
        const inH = Math.max(0, Math.floor(Number(char.dailyHuntsCompleted ?? 0)));
        char.dailyHuntsCompleted = Math.max(inH, floorH);
    }

    // academy-trial is a one-time onboarding claim (claim-mission academy-trial
    // path, off the daily cap). Latch it: once the server-stored save has it
    // claimed, a forged save can't flip it back to false to re-claim. (audit #1)
    if (exChar.academyTrialClaimed === true) char.academyTrialClaimed = true;

    // Field Recovery shield (api/pvp/_vitals-settlement.ts PVP_RAID_SHIELD_MS) is
    // SERVER-OWNED, exactly like the hospital stamps below and for the same
    // reason `inBattle` had to become server-owned in 2026-09: a client that can
    // write its own immunity writes it forever. Only PvP settlement and the
    // sleeper KO set it, so the stored value always wins — a save cannot extend
    // its shield, and cannot clear one it is still serving either.
    char.pvpShieldUntil = exChar.pvpShieldUntil ?? null;

    // Hospital timer enforcement.
    //   - If save flips hospitalized false → true, server stamps both
    //     hospitalizedUntil AND hospitalizedAt. The latter is read by
    //     api/player/heal.ts to award the +50% Healer raid-assist XP
    //     bonus when a Healer reaches a freshly-hospitalized friendly.
    //   - If save flips hospitalized true → false before the timer expires, revert
    //     (with HP at zero — exactly the state they were in when admitted).
    //   - Discharge (genuine or rejected) always goes through api/player/heal,
    //     not this validator — see Hospital.tsx::discharge(). This validator
    //     is the fallback that catches client-only attempts to flip the flag.
    const exHosp = !!exChar.hospitalized;
    const inHosp = !!char.hospitalized;
    const exHospUntil = Number(exChar.hospitalizedUntil ?? 0);
    const exHospAt = Number(exChar.hospitalizedAt ?? 0);
    if (!exHosp && inHosp) {
        const now = Date.now();
        // Discharge-race guard: if the server JUST discharged this player
        // (heal / paid skip / free checkout, all via api/player/heal.ts, which
        // stamps lastDischargeAt), an incoming save still flagged hospitalized
        // is a stale pre-discharge replay racing the discharge. Honor the
        // discharge instead of re-admitting them with a fresh timer.
        const lastDischargeAt = Number(exChar.lastDischargeAt ?? 0);
        if (lastDischargeAt > 0 && now - lastDischargeAt < DISCHARGE_GRACE_MS) {
            char.hospitalized = false;
            char.hospitalizedUntil = 0;
            char.hospitalizedAt = 0;
            // Preserve the marker so any further stale saves in the same window
            // are caught too (mergePreservingImages would keep it anyway, but be
            // explicit — char is what the rest of the validator reasons about).
            char.lastDischargeAt = lastDischargeAt;
        } else {
            char.hospitalizedUntil = now + HOSPITAL_DURATION_MS;
            char.hospitalizedAt = now;
        }
    } else if (exHosp && !inHosp) {
        if (exHospUntil && Date.now() < exHospUntil) {
            // Reject early discharge — force the player to wait out the timer
            // or go through /api/player/heal (which charges ryo server-side
            // when paySkip=true, or applies the Healer rank-shortened timer).
            char.hospitalized = true;
            char.hospitalizedUntil = exHospUntil;
            char.hospitalizedAt = exHospAt;
            // Snap HP back to 0 so they can't farm hp during the lockout.
            char.hp = 0;
        } else {
            // Timer expired or unset — allow discharge and clear both stamps.
            char.hospitalizedUntil = 0;
            char.hospitalizedAt = 0;
        }
    } else if (exHosp && inHosp) {
        // Preserve the original stamps and the KO itself. The client has an
        // idle-vitals clock, so a stale or modified client can otherwise send
        // hospitalized:true with regenerated HP and autosave its way off zero
        // while it is still admitted.
        char.hospitalizedUntil = exHospUntil || char.hospitalizedUntil;
        char.hospitalizedAt = exHospAt || char.hospitalizedAt;
        char.hp = 0;
    }
}
