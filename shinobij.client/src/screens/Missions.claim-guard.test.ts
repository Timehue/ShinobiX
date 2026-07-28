import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

/*
 * Claim buttons must not be double-fireable.
 *
 * The three claim buttons on the Mission Hall had no in-flight guard, and the
 * eligibility checks inside each handler read state that only updates AFTER the
 * await — so a double-tap fired two requests. Rewards are server-authoritative so
 * nothing was ever paid twice, but the player experience was worse than a dupe: the
 * first reply alerted "mission complete, +240 XP" and the second alerted the
 * already-claimed rejection. Alerts are queued blocking modals, so the two read in
 * sequence as "the game took my reward back" — on the core week-one loop.
 */

const missionsSource = readFileSync(new URL("./Missions.tsx", import.meta.url), "utf8");
const towerLobbySource = readFileSync(new URL("./EndlessTowerLobby.tsx", import.meta.url), "utf8");

describe("Mission Hall claim guard", () => {
    it("guards with a ref, not only React state", () => {
        // State updates are asynchronous: two taps in the same tick would both read the
        // stale value and both proceed. Only a ref flips synchronously.
        assert.match(missionsSource, /const claimInFlightRef = useRef\(false\);/);
        assert.match(missionsSource, /if \(claimInFlightRef\.current\) return;\s*claimInFlightRef\.current = true;/);
    });

    it("always releases the guard, including when a claim throws", () => {
        // A stuck flag would disable every claim button for the rest of the session.
        assert.match(
            missionsSource,
            /finally \{[^}]*claimInFlightRef\.current = false;[^}]*setClaimingKey\(null\);[^}]*\}/s,
            "runClaim must clear the in-flight ref in a finally block",
        );
    });

    it("routes all three claim buttons through the guard", () => {
        for (const call of [
            /runClaim\(`combat:\$\{mission\.key\}`, \(\) => claimCombatMission\(mission\)\)/,
            /runClaim\(`field:\$\{mission\.id\}`, \(\) => claimFetchMission\(mission\)\)/,
            /runClaim\("academy-trial", claimAcademyTrial\)/,
        ]) {
            assert.match(missionsSource, call, `claim button must go through runClaim: ${call}`);
        }

        // No claim button may still call a handler directly.
        for (const bare of [
            /onClick=\{\(\) => \{ void claimCombatMission\(mission\); \}\}/,
            /onClick=\{\(\) => \{ void claimFetchMission\(mission\); \}\}/,
            /onClick=\{\(\) => \{ void claimAcademyTrial\(\); \}\}/,
        ]) {
            assert.doesNotMatch(missionsSource, bare, `claim button must not bypass runClaim: ${bare}`);
        }
    });

    it("disables every claim button while any claim is in flight", () => {
        // Global rather than per-mission on purpose: each claim mutates the same
        // character and the same daily-mission counter, so two concurrent claims can
        // both pass hasDailyMissionSlot.
        const disabled = missionsSource.match(/disabled=\{claimingKey !== null\}/g) ?? [];
        assert.equal(disabled.length, 3, "all three claim buttons must disable during a claim");
    });
});

describe("Endless Tower lobby action guard", () => {
    it("locks entering and banking against a double-tap", () => {
        // Entering charges a ryo entry fee; banking commits the run's rewards.
        assert.match(towerLobbySource, /const lockedRef = useRef\(false\);/);
        assert.match(towerLobbySource, /onClick=\{\(\) => runOnce\(onEnter\)\}/);
        assert.match(towerLobbySource, /onClick=\{\(\) => runOnce\(onBank\)\}/);
        assert.doesNotMatch(towerLobbySource, /onClick=\{onEnter\}/, "enter must not bypass the lock");
        assert.doesNotMatch(towerLobbySource, /onClick=\{onBank\}/, "bank must not bypass the lock");
    });

    it("releases the lock instead of latching, so a failed navigation is recoverable", () => {
        // These handlers normally navigate away and unmount the screen. If one does not,
        // a latched lock would strand the player in the lobby unable to start a run.
        assert.match(towerLobbySource, /const ACTION_LOCK_MS = \d+;/);
        assert.match(towerLobbySource, /setTimeout\(\(\) => \{\s*lockedRef\.current = false;/);
        // And the timer must be cleared on unmount so it cannot fire into a dead component.
        assert.match(towerLobbySource, /useEffect\(\(\) => \(\) => \{ if \(timerRef\.current\) clearTimeout\(timerRef\.current\); \}, \[\]\);/);
    });
});
