import { test } from "node:test";
import assert from "node:assert/strict";
import { runWarfrontMatch as serverRun } from "../api/_pet-sim/pet-warfront-sim";
import { runWarfrontMatch as clientRun, startWarfrontMatch } from "../shinobij.client/src/lib/pet-warfront-sim";
import type { WfBuyPolicy, WfStance } from "../shinobij.client/src/lib/pet-warfront-sim";
import type { Pet } from "../shinobij.client/src/types/pet";
import type { ArenaRole, ArenaSlot } from "../shinobij.client/src/lib/pet-arena-sim";
import { buildWarfrontAiTeam } from "../api/pet/_warfront-ai";
import { genericPetArenaOpponents } from "../shinobij.client/src/data/pet-arena-opponents";
import { derivePetRole } from "../shinobij.client/src/lib/pet-roles";
import { derivePetRole as serverDerivePetRole } from "../api/_pet-sim/pet-roles";

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
// stance, fixed balanced/vanguard red, default theme) the reward endpoint mirrors.
function streamedRender(blue: ArenaSlot[], red: ArenaSlot[], seed: number, policy: WfBuyPolicy, stance: WfStance) {
    const ctl = startWarfrontMatch(blue, red, seed, {
        bluePolicy: policy,
        redPolicy: "balanced",
        blueStance: stance,
        redStance: "balanced",
        redDoctrine: "vanguard",
    });
    let guard = 0;
    while (!ctl.done && guard++ < 100000) ctl.advanceRoundPartial(70);   // ~renderer chunk size
    return ctl.result;
}
// The vs-AI RED team the reward endpoint re-sims must be the SAME team the
// client fought. The client (PetArena "Start vs AI") cycles genericPetArenaOpponents
// to the player's count; the server rebuilds it from SERVER_ARENA_PETS + elements
// (buildWarfrontAiTeam). This proves the two produce byte-identical matches, so
// the reward can never diverge from what the player saw. Roles are assigned the
// client's way (pet.role ?? derivePetRole) on both sides.
function autoRole(pets: Pet[]): ArenaSlot[] {
    return pets.map((pet) => ({ pet, role: (pet.role ?? derivePetRole(pet).role) as ArenaRole }));
}

// THE FULL SEAMLESS PROOF: exactly what api/pet/warfront-start.ts computes (server
// runWarfrontMatch + server buildWarfrontAiTeam + server derivePetRole) must equal
// exactly what the browser renders (streamed startWarfrontMatch + the real client
// AI roster + client derivePetRole). Byte-identical → the reward can never disagree
// with what the player watched, on any engine.
test("reward endpoint's server computation === the browser's streamed render", () => {
    const bluePets = squad("P").map((s) => s.pet);
    const srvRole = (pets: Pet[]): ArenaSlot[] => pets.map((pet) => ({ pet, role: (pet.role ?? serverDerivePetRole(pet).role) as ArenaRole }));
    const clientRed = autoRole(Array.from({ length: 4 }, (_, i) => ({ ...genericPetArenaOpponents.map((o) => o.pet)[i % genericPetArenaOpponents.length] })));
    for (const seed of [1, 42]) {
        for (const stance of ["balanced", "headhunt"] as const) {
            for (const doc of ["vanguard", "warden-pact"] as const) {   // a stat doctrine + the recruit doctrine
                const endpoint = serverRun(srvRole(bluePets), srvRole(buildWarfrontAiTeam(4)), seed, "balanced", "balanced", undefined, { blue: stance, red: "balanced" }, { blue: doc, red: "vanguard" });
                const ctl = startWarfrontMatch(autoRole(bluePets), clientRed, seed, {
                    bluePolicy: "balanced",
                    redPolicy: "balanced",
                    blueStance: stance,
                    redStance: "balanced",
                    blueDoctrine: doc,
                    redDoctrine: "vanguard",
                });
                let g = 0;
                while (!ctl.done && g++ < 100000) ctl.advanceRoundPartial(70);
                assert.equal(digest(endpoint), digest(ctl.result), `endpoint diverges from the render @ seed ${seed} ${stance}/${doc}`);
            }
        }
    }
});
test("server-resolved vs-AI red team reproduces the client roster's match byte-for-byte", () => {
    const blue = squad("P");
    const count = 4;
    const clientRed = autoRole(Array.from({ length: count }, (_, i) => ({ ...genericPetArenaOpponents.map((o) => o.pet)[i % genericPetArenaOpponents.length] })));
    const serverRed = autoRole(buildWarfrontAiTeam(count));
    for (const seed of [1, 7, 42, 999]) {
        assert.equal(
            digest(clientRun(blue, clientRed, seed)),
            digest(clientRun(blue, serverRed, seed)),
            `server AI roster diverges from the client roster @ seed ${seed} — the reward would mismatch the fight`,
        );
    }
});

test("streamed render path === full-auto server path (autobuy, all policies + stances)", () => {
    for (const seed of [3, 29, 404]) {
        for (const policy of ["balanced", "offense", "defense"] as const) {
            for (const stance of ["balanced", "siege", "jungle", "headhunt", "turtle"] as const) {
                assert.equal(
                    digest(streamedRender(squad("A"), squad("B"), seed, policy, stance)),
                    digest(serverRun(squad("A"), squad("B"), seed, policy, "balanced", undefined, { blue: stance, red: "balanced" }, { red: "vanguard" })),
                    `stream/full drift @ seed ${seed} ${policy}/${stance} — reward would mismatch the render`,
                );
            }
        }
    }
});
