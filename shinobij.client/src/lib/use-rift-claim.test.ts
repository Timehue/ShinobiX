import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Character } from "../types/character";
import { hollowRifts } from "../data/hollow-rifts";
import { createCharacter } from "./create-character";
import { riftIntroEvent, riftRewardLine } from "./hollow-rifts";
import { createPlayerSaveCoordinator } from "./player-save-coordinator";
import { completeRiftRun, riftClaimShouldRetry, runRiftClaim } from "./rift-server";
import { claimableRiftId } from "./use-rift-claim";

const receipt = { riftId: "rift-legacy-echo", runToken: "run-token-1", combatRunId: "combat:1", acceptedAt: 1, clearedAt: 2 };
const char = (over: Partial<Character>) => ({ name: "Aki", ...over }) as Character;
const closedSave = char({ riftQuestBossReceipt: null, activeRiftQuest: null });

test("a rift is claimable from its boss receipt only once the run has ended", () => {
    assert.equal(claimableRiftId(char({ riftQuestBossReceipt: receipt })), "rift-legacy-echo");
    assert.equal(claimableRiftId(char({ riftQuestBossReceipt: receipt, hollowGateRun: { runToken: "run-token-1" } as Character["hollowGateRun"] })), null);
    assert.equal(claimableRiftId(char({ riftQuestBossReceipt: null })), null);
    assert.equal(claimableRiftId(null), null);
});

test("only an answer that says nothing about the quest is retried", () => {
    for (const reason of ["offline", "run-open", undefined]) assert.equal(riftClaimShouldRetry({ ok: false, reason }), true, String(reason));
    for (const reason of ["none", "incomplete", "wrong-rift", "daily-cap", "proof-missing-retry"]) assert.equal(riftClaimShouldRetry({ ok: false, reason }), false, reason);
    assert.equal(riftClaimShouldRetry({ ok: true }), false);
});

test("the app claims through the hook, the single path for shinobi and pet wins", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    assert.match(app, /useRiftClaim\(character, setCharacter, commitVersionedCharacter\)/);
    assert.doesNotMatch(app, /completeRiftRun/);
});

test("a claim adopts the server's Veil and clears the receipt that drives the retry", async () => {
    const originalFetch = globalThis.fetch;
    const itemStacks = [{ itemId: "veil-of-the-hollow", count: 1 }];
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, ryo: 280, totalRyo: 780, fateShards: 1, boneCharms: 4, veils: 1, itemStacks, cooldownUntil: 9 }));
    try {
        let current: Character | null = char({ ryo: 500, fateShards: 0, boneCharms: 0, itemStacks: [], riftQuestBossReceipt: receipt });
        const lines: string[] = [];
        await completeRiftRun("Aki", receipt.riftId, (update) => { current = update(current); }, (line) => lines.push(line));
        const claimed = current as Character | null;
        assert.deepEqual(claimed?.itemStacks, itemStacks);
        assert.equal(claimed?.riftQuestBossReceipt, null);
        assert.deepEqual(lines, ["Rift sealed. Quest reward: 280 ryo, 1 fate shard, 4 bone charms, 1 Veil of the Hollow."]);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("a claim adopts the committed save and version instead of adding the reward a second time", async () => {
    const originalFetch = globalThis.fetch;
    const committed = char({ ryo: 780, fateShards: 1, boneCharms: 4, riftQuestBossReceipt: null });
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, ryo: 280, totalRyo: 780, fateShards: 1, boneCharms: 4, veils: 1, character: committed, _saveVersion: 12 }));
    try {
        const start = char({ ryo: 500, fateShards: 0, boneCharms: 0, riftQuestBossReceipt: receipt });
        let current: Character | null = start;
        const commits: unknown[] = [];
        const accept = (next: Character, version: unknown) => { commits.push(version); current = next; return true; };
        await completeRiftRun("Aki", receipt.riftId, (update) => { current = update(current); }, () => {}, accept);
        assert.deepEqual(commits, [12]);
        assert.equal((current as Character | null)?.fateShards, 1, "the local mirror did not stack on the adopted save");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

function staleReplyFixture(reply: Record<string, unknown>) {
    const initial = { ...createCharacter("Aki", "Stormveil Village", "Ninjutsu", "Ashen Eyes"), ryo: 500, fateShards: 0, boneCharms: 0, riftQuestBossReceipt: receipt };
    const characterRef = { current: initial as Character | null };
    const owner = createPlayerSaveCoordinator({
        characterRef, currentAccountNameRef: { current: initial.name }, saveSessionEpochRef: { current: 0 },
        pvpCreateScopeAbortRef: { current: new AbortController() },
        setCharacter: (update) => { characterRef.current = typeof update === "function" ? update(characterRef.current) : update; },
        setSaveConflictDraft: () => {}, setSaveBlocked: () => {}, applyServerSnapshot: () => true,
        storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } as unknown as Storage,
    });
    owner.saveAuthority.scopeToAccount(initial.name);
    owner.latestSaveVersionRef.current = 5;
    const readBacks: string[] = [];
    owner.savePersistenceRef.current = {
        invalidateAuthority: () => {},
        refetchAfterConflict: async (name: string) => { readBacks.push(name); return false; },
    } as unknown as NonNullable<typeof owner.savePersistenceRef.current>;
    globalThis.fetch = async () => new Response(JSON.stringify(reply));
    // A later write landed first: its save already holds the payout, and more ryo on top.
    const newer = { ...initial, ryo: 1_200, fateShards: 1, boneCharms: 4, activeRiftQuest: null, riftQuestBossReceipt: null };
    assert.equal(owner.commitVersionedCharacter(newer, 7), true);
    const held = characterRef.current;
    const claim = (lines: string[]) => completeRiftRun(initial.name, receipt.riftId,
        (update) => { characterRef.current = update(characterRef.current); }, (line) => lines.push(line), owner.commitVersionedCharacter);
    return { owner, characterRef, held, readBacks, claim };
}

test("a paid reply overtaken by a newer save changes nothing and reads the stored save back", async () => {
    const originalFetch = globalThis.fetch;
    const paid = { ok: true, ryo: 280, totalRyo: 780, fateShards: 1, boneCharms: 4, veils: 1, cooldownUntil: 9, _saveVersion: 6 };
    const f = staleReplyFixture({ ...paid, character: { ...closedSave, ryo: 780, fateShards: 1, boneCharms: 4 } });
    try {
        const lines: string[] = [];
        const response = await f.claim(lines);
        assert.equal(f.characterRef.current, f.held, "no currency or item from the stale reply reached the newer save");
        assert.equal(f.characterRef.current?.ryo, 1_200);
        assert.equal(f.characterRef.current?.fateShards, 1, "the shard is not paid a second time");
        assert.equal(f.owner.latestSaveVersionRef.current, 7);
        assert.deepEqual(f.readBacks, ["Aki"], "the refusal hands over to the stored-save read-back");
        assert.equal(riftClaimShouldRetry(response), false, "the claim was paid, so it is not retried");
        assert.deepEqual(lines, ["Rift sealed. Quest reward: 280 ryo, 1 fate shard, 4 bone charms, 1 Veil of the Hollow."]);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("an already-closed reply overtaken by a newer save leaves that save alone", async () => {
    const originalFetch = globalThis.fetch;
    const f = staleReplyFixture({ ok: false, reason: "none", character: { ...closedSave, ryo: 780 }, _saveVersion: 6 });
    try {
        await f.claim([]);
        assert.equal(f.characterRef.current, f.held);
        assert.deepEqual(f.readBacks, ["Aki"]);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("a retry after a lost reply adopts what the first call paid", async () => {
    const originalFetch = globalThis.fetch;
    const committed = char({ ryo: 780, riftQuestBossReceipt: null });
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, reason: "none", character: committed, _saveVersion: 12 }));
    try {
        let adopted: Character | null = null;
        const lines: string[] = [];
        await completeRiftRun("Aki", receipt.riftId, () => assert.fail("no local mirror"), (line) => lines.push(line), (next) => { adopted = next; return true; });
        assert.equal((adopted as Character | null)?.ryo, 780);
        assert.deepEqual(lines, ["This rift report is already closed. A new rift can appear."]);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("a claim retries a silent failure, stops on an answer, and yields when it stops being current", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const originalFetch = globalThis.fetch;
    let calls = 0;
    let settled = false;
    globalThis.fetch = async () => {
        calls += 1;
        if (calls === 1) throw new Error("offline");
        return new Response(JSON.stringify({ ok: false, reason: "incomplete" }));
    };
    try {
        const claim = runRiftClaim("Aki", receipt.riftId, () => {}, () => false, () => true).then(() => { settled = true; });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(calls, 1);
        t.mock.timers.tick(30_000);
        await claim;
        assert.equal(settled, true);
        assert.equal(calls, 2, "the server's answer ends the claim");
        await runRiftClaim("Aki", receipt.riftId, () => {}, () => false, () => false);
        assert.equal(calls, 2, "a stale claim sends nothing");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("every rift states its pay at the player's level before the accept choice", () => {
    for (const rift of hollowRifts) {
        for (const firstClears of [{}, { [rift.id]: { at: 1 } }]) {
            const pages = riftIntroEvent(rift, 20, "shadow", firstClears, 60).vnPages ?? [];
            const last = pages[pages.length - 1];
            assert.ok(last.choices?.length, rift.id);
            assert.equal(last.dialogue.at(-1), riftRewardLine(rift, 60), rift.id);
        }
    }
    assert.match(riftRewardLine(hollowRifts[0], 12), /^Close this report and you are paid 280 ryo, 1 Fate Shard, 4 Bone Charms, and one Veil of the Hollow\./);
});
