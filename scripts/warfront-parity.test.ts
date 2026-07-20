import { test } from "node:test";
import assert from "node:assert/strict";
import { runWarfrontMatch as serverRun } from "../api/_pet-sim/pet-warfront-sim";
import { runWarfrontMatch as clientRun, startWarfrontMatch } from "../shinobij.client/src/lib/pet-warfront-sim";
import type { WfBuyPolicy, WfStance } from "../shinobij.client/src/lib/pet-warfront-sim";
import type { Pet } from "../shinobij.client/src/types/pet";
import type { ArenaRole, ArenaSlot } from "../shinobij.client/src/lib/pet-arena-sim";

/*
 * Hollow Warfront server-parity. api/_pet-sim/pet-warfront-sim.ts is a GENERATED
 * server copy of the client engine (scripts/gen-pet-sim.mjs). The vs-AI reward is
 * SERVER-AUTHORITATIVE — the reward endpoint re-runs this sim to verify a
 * browser's reported outcome — so the server copy MUST resolve the identical
 * match the client showed. If it drifts, a player would win on-screen and be
 * denied the reward (or vice-versa). This asserts byte-identical results across
 * seeds, team strengths, and stances; re-run `node scripts/gen-pet-sim.mjs` if it
 * fails. (Both engines run under Node here — this catches GEN drift; the sim's
 * cross-engine determinism, no sin/cos/atan2/hypot, is what makes a real
 * Firefox↔Node match hold, and is guarded by the sim header contract.)
 */
const mk = (id: string, el: string, o: Partial<Pet> = {}): Pet =>
    ({ id, name: id, element: el, hp: 700, attack: 90, defense: 45, speed: 60, ...o } as Pet);
const squad = (p: string, boost = 0): ArenaSlot[] =>
    (["defender", "tracker", "assassin", "sage"] as ArenaRole[]).map((role, i) =>
        ({ pet: mk(`${p}-${i}`, ["Earth", "Water", "Fire", "Wind"][i], { attack: 90 + boost, hp: 700 + boost * 4 }), role }));

// Compare the authoritative surface: winner + ticks + the full event stream
// (which determines the match) + final economy/structure state. Cheaper than a
// deepEqual over ~18k snapshots but just as strict on the outcome.
function digest(r: ReturnType<typeof serverRun>) {
    const last = r.snapshots[r.snapshots.length - 1];
    return JSON.stringify({ winner: r.winner, ticks: r.ticks, events: r.events, coins: last.coins, structures: last.structures });
}

test("server Warfront sim is byte-identical to the client (mirror + boosted, several seeds)", () => {
    for (const seed of [1, 7, 42, 12345, 98765]) {
        assert.equal(digest(serverRun(squad("A"), squad("B"), seed)), digest(clientRun(squad("A"), squad("B"), seed)), `mirror parity drift @ seed ${seed}`);
        assert.equal(digest(serverRun(squad("A", 400), squad("B"), seed)), digest(clientRun(squad("A", 400), squad("B"), seed)), `boosted parity drift @ seed ${seed}`);
    }
});

test("server Warfront parity holds across buy policies and forced stances", () => {
    const policies = ["balanced", "offense", "defense"] as const;
    for (const bp of policies) {
        assert.equal(
            digest(serverRun(squad("A"), squad("B"), 77, bp, "balanced")),
            digest(clientRun(squad("A"), squad("B"), 77, bp, "balanced")),
            `policy parity drift @ ${bp}`,
        );
    }
    for (const stance of ["siege", "jungle", "headhunt", "turtle"] as const) {
        assert.equal(
            digest(serverRun(squad("A"), squad("B"), 55, "balanced", "balanced", undefined, { blue: stance, red: "balanced", adapt: false })),
            digest(clientRun(squad("A"), squad("B"), 55, "balanced", "balanced", undefined, { blue: stance, red: "balanced", adapt: false })),
            `stance parity drift @ ${stance}`,
        );
    }
});

// THE LINCHPIN for a seamless server-auth reward: the client RENDERS the match
// via the STREAMED advanceRoundPartial (chunked, so the 3D playback never
// freezes), but the reward server runs the FULL-AUTO runWarfrontMatch. If those
// two ever disagreed, a player would watch a win the server scored as a loss.
// This proves they are byte-identical — exactly the render path (autobuy, blue
// stance, adaptive red, default theme) the reward endpoint mirrors.
function streamedRender(blue: ArenaSlot[], red: ArenaSlot[], seed: number, policy: WfBuyPolicy, stance: WfStance) {
    const ctl = startWarfrontMatch(blue, red, seed, { bluePolicy: policy, redPolicy: "balanced", blueStance: stance });
    let guard = 0;
    while (!ctl.done && guard++ < 100000) ctl.advanceRoundPartial(70);   // ~renderer chunk size
    return ctl.result;
}
test("streamed render path === full-auto server path (autobuy, all policies + stances)", () => {
    for (const seed of [3, 29, 404]) {
        for (const policy of ["balanced", "offense", "defense"] as const) {
            for (const stance of ["balanced", "siege", "jungle", "headhunt", "turtle"] as const) {
                assert.equal(
                    digest(streamedRender(squad("A"), squad("B"), seed, policy, stance)),
                    digest(serverRun(squad("A"), squad("B"), seed, policy, "balanced", undefined, { blue: stance })),
                    `stream/full drift @ seed ${seed} ${policy}/${stance} — reward would mismatch the render`,
                );
            }
        }
    }
});
