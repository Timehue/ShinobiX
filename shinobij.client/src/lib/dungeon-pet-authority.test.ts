import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { settleDungeonPetBattle, startDungeonPetBattle } from "./dungeon-pet-authority";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const pet = (id: string) => ({
    id,
    name: id === "dungeon-rare-beast" ? "Sealed Rare Beast" : "Kumo",
    hp: 900,
    attack: 110,
    defense: 100,
    speed: 90,
    jutsus: [],
});

const config = {
    mode: "1v1",
    seed: 7319,
    damageMult: 1,
    hpMult: 1,
    revive: false,
    applyItems: true,
    accuracy: true,
    terrain: null,
};

describe("Dungeon pet client authority adapter", () => {
    it("sends only the player pet and nested run binding, then accepts sealed combat snapshots", async () => {
        let requestBody: Record<string, unknown> | null = null;
        globalThis.fetch = (async (_input, init) => {
            requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
            return new Response(JSON.stringify({
                ok: true,
                dungeon: true,
                token: "0123456789abcdef0123456789abcdef",
                reportKey: "7319:casual",
                seed: 7319,
                playerPets: [pet("pet-one")],
                opponentPets: [pet("dungeon-rare-beast")],
                battleConfig: config,
            }), { status: 200, headers: { "Content-Type": "application/json" } });
        }) as typeof fetch;

        const seal = await startDungeonPetBattle({
            playerName: "Kaya",
            playerPetId: "pet-one",
            dungeonRunToken: "dungeon_run_123",
        });
        assert.deepEqual(requestBody, {
            playerName: "Kaya",
            mode: "1v1",
            playerPetIds: ["pet-one"],
            dungeon: { token: "dungeon_run_123" },
        });
        assert.equal(seal.opponentPet.id, "dungeon-rare-beast");
        assert.deepEqual(seal.battleConfig, config);
    });

    it("wires the rewarding Dungeon surface only to server-sealed Card and Pet proofs", () => {
        const dungeon = readFileSync(new URL("../screens/Dungeon.tsx", import.meta.url), "utf8");
        const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
        const start = dungeon.indexOf("export function DungeonRareBeastBattle");
        const end = dungeon.indexOf("export function DungeonPetBattle", start);
        const authoritativePet = dungeon.slice(start, end);
        assert.ok(start > 0 && end > start);
        assert.match(dungeon, /CardClashDuel[\s\S]{0,300}dungeonRunToken=\{dungeonRunToken\}[\s\S]{0,300}onVersionedCharacter/);
        assert.match(dungeon, /DungeonRareBeastBattle[\s\S]{0,300}dungeonRunToken=\{dungeonRunToken\}/);
        assert.match(authoritativePet, /startDungeonPetBattle/);
        assert.match(authoritativePet, /settleDungeonPetBattle/);
        assert.match(authoritativePet, /routeTerminal\(settled\.outcome\)/);
        assert.match(authoritativePet, /disabled=\{startBusy\} onClick=\{onLeave\}>Leave Dungeon/);
        assert.doesNotMatch(authoritativePet, /Math\.random|Date\.now|genericPetArenaOpponents|petTamerPveMultiplier|petPveHpMult|petAlphaBond/);
        assert.doesNotMatch(app, /dungeonStage|setDungeonStage/);
        assert.match(app, /onVersionedCharacter=\{commitVersionedCharacter\}/);
        assert.match(app, /onClaimReward=\{completeDungeon\}/);
        assert.match(app, /restoreScreenForSave\(persisted, inHollowGateRun, normalized\.hospitalized, inDungeonRun\)/);
        assert.match(app, /setActiveDungeonRunToken\(normalized\.activeDungeonRun\.token\)/);
        assert.match(app, /!character\.activeDungeonRun\?\.token && !ownsItem\(character, DUNGEON_KEY_ID\)/);
    });

    it("uses the server replay outcome and proof-bearing save instead of the reported result", async () => {
        let requestBody: Record<string, unknown> | null = null;
        globalThis.fetch = (async (_input, init) => {
            requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
            return new Response(JSON.stringify({
                ok: true,
                dungeon: true,
                outcome: "loss",
                replayed: true,
                character: { name: "Kaya", activeDungeonRun: { token: "dungeon_run_123" } },
                _saveVersion: 9,
            }), { status: 200, headers: { "Content-Type": "application/json" } });
        }) as typeof fetch;
        const seal = {
            token: "0123456789abcdef0123456789abcdef",
            reportKey: "7319:casual",
            seed: 7319,
            playerPet: pet("pet-one") as never,
            opponentPet: pet("dungeon-rare-beast") as never,
            battleConfig: config,
        };
        const settled = await settleDungeonPetBattle({
            playerName: "Kaya",
            seal,
            reportedOutcome: "win",
            inputLog: [{ t: 1, command: "guard" }],
        });
        assert.equal(requestBody?.outcome, "win", "reported outcome remains compatibility-only input");
        assert.equal(settled.outcome, "loss", "only the server replay verdict is consumed");
        assert.equal(settled.saveVersion, 9);
        assert.equal(settled.replayed, true);
    });

    it("fails closed when the start response omits its fixed server-owned opponent", async () => {
        globalThis.fetch = (async () => new Response(JSON.stringify({
            ok: true,
            dungeon: true,
            token: "0123456789abcdef0123456789abcdef",
            reportKey: "7319:casual",
            seed: 7319,
            playerPets: [pet("pet-one")],
            opponentPets: [],
            battleConfig: config,
        }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
        await assert.rejects(
            startDungeonPetBattle({ playerName: "Kaya", playerPetId: "pet-one", dungeonRunToken: "dungeon_run_123" }),
            /complete sealed encounter/i,
        );
    });
});
