import { strict as assert } from "node:assert";
import test, { afterEach } from "node:test";
import { readFileSync } from "node:fs";
import { postWorldHunt } from "./world-hunt-api";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test("hunt state migration response preserves authoritative accepted ids, progress and sector", async () => {
    let sent: Record<string, unknown> | null = null;
    globalThis.fetch = async (_url, init) => {
        sent = JSON.parse(String(init?.body ?? "{}"));
        return {
            ok: true,
            json: async () => ({
                ok: true,
                migrated: true,
                acceptedMissionIds: ["hunt-wolf"],
                missionProgress: { "hunt-wolf": 0 },
                state: { missionId: "hunt-wolf", progress: 0, requiredTracks: 4, quality: 0, ready: false, sector: 12 },
                character: { name: "Rill", serverHuntTrails: {} },
                _saveVersion: 14,
            }),
        } as Response;
    };
    const result = await postWorldHunt({ playerName: "Rill", action: "state", missionId: "hunt-wolf" });
    assert.deepEqual(sent, { playerName: "Rill", action: "state", missionId: "hunt-wolf" });
    assert.equal(result.migrated, true);
    assert.equal(result.state?.sector, 12);
    assert.deepEqual(result.acceptedMissionIds, ["hunt-wolf"]);
    assert.equal(result.missionProgress?.["hunt-wolf"], 0);
    assert.equal(result._saveVersion, 14);
});

test("hunt choose sends identity only and adopts the server decision", async () => {
    let sent: Record<string, unknown> | null = null;
    globalThis.fetch = async (_url, init) => {
        sent = JSON.parse(String(init?.body ?? "{}"));
        return {
            ok: true,
            json: async () => ({
                ok: true,
                decisionId: "hunt_run_0_push",
                progress: 1,
                quality: 1,
                ambush: false,
                nextSector: 18,
                state: { missionId: "hunt-wolf", progress: 1, requiredTracks: 4, quality: 1, ready: false, sector: 18 },
            }),
        } as Response;
    };
    const result = await postWorldHunt({
        playerName: "Rill",
        action: "choose",
        missionId: "hunt-wolf",
        sector: 12,
        choiceId: "push",
    });
    assert.deepEqual(sent, {
        playerName: "Rill",
        action: "choose",
        missionId: "hunt-wolf",
        sector: 12,
        choiceId: "push",
    });
    assert.equal(result.nextSector, 18);
    assert.equal(result.quality, 1);
});

test("Hunter Board never presents a claimed-today cleanup as accepted", () => {
    const board = readFileSync(new URL("../screens/HunterBoard.tsx", import.meta.url), "utf8");
    const reason = board.indexOf('result.reason === "already-claimed-today"');
    const acceptedToast = board.indexOf("accepted. Your first lead", reason);
    assert.ok(reason >= 0 && acceptedToast > reason);
    assert.match(board.slice(reason, acceptedToast), /return alert/);
    assert.match(board.slice(reason, acceptedToast), /delete next\[mission\.id\]/,
        "the stale authoritative trail card must be cleared with the server ledger");
});
