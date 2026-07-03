import { beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { Character } from "../types/character";
import {
    ARENA_SAVE_TTL_MS,
    STORY_BOSS_SAVE_TTL_MS,
    arenaStoryCtxKey,
    battleResumeStateExists,
    endlessCtxKey,
    storyBossSaveKey,
    type ClientBattleLock,
} from "./battle-save";

class MemoryStorage implements Storage {
    private readonly items = new Map<string, string>();

    get length(): number {
        return this.items.size;
    }

    clear(): void {
        this.items.clear();
    }

    getItem(key: string): string | null {
        return this.items.get(key) ?? null;
    }

    key(index: number): string | null {
        return Array.from(this.items.keys())[index] ?? null;
    }

    removeItem(key: string): void {
        this.items.delete(key);
    }

    setItem(key: string, value: string): void {
        this.items.set(key, value);
    }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

function lock(kind: string): ClientBattleLock {
    return { battleId: `${kind}-lock`, kind, screen: kind, startedAt: Date.now() };
}

function character(overrides: Partial<Character> = {}): Character {
    return {
        name: "ResumeRisk",
        storyProgress: 2,
        hollowGateRun: null,
        ...overrides,
    } as Character;
}

function writeArenaSnapshot(name = "ResumeRisk", ageMs = 0): void {
    localStorage.setItem(`arena.battle.v3.${name}`, JSON.stringify({
        battleStarted: true,
        savedAt: Date.now() - ageMs,
    }));
}

describe("battle resume state checks", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("resumes arena locks only when the arena combat snapshot is live", () => {
        assert.equal(battleResumeStateExists(lock("arena"), "ResumeRisk", character()), false);

        writeArenaSnapshot();
        assert.equal(battleResumeStateExists(lock("arena"), "ResumeRisk", character()), true);

        writeArenaSnapshot("ResumeRisk", ARENA_SAVE_TTL_MS + 1);
        assert.equal(battleResumeStateExists(lock("arena"), "ResumeRisk", character()), false);
    });

    it("resumes story boss locks only for the matching unfinished story fight", () => {
        localStorage.setItem(storyBossSaveKey("ResumeRisk"), JSON.stringify({
            storyProgress: 2,
            bossHp: 10,
            playerHp: 10,
            savedAt: Date.now(),
        }));
        assert.equal(battleResumeStateExists(lock("storyBoss"), "ResumeRisk", character()), true);

        localStorage.setItem(storyBossSaveKey("ResumeRisk"), JSON.stringify({
            storyProgress: 1,
            bossHp: 10,
            playerHp: 10,
            savedAt: Date.now(),
        }));
        assert.equal(battleResumeStateExists(lock("storyBoss"), "ResumeRisk", character()), false);

        localStorage.setItem(storyBossSaveKey("ResumeRisk"), JSON.stringify({
            storyProgress: 2,
            bossHp: 0,
            playerHp: 10,
            savedAt: Date.now(),
        }));
        assert.equal(battleResumeStateExists(lock("storyBoss"), "ResumeRisk", character()), false);

        localStorage.setItem(storyBossSaveKey("ResumeRisk"), JSON.stringify({
            storyProgress: 2,
            bossHp: 10,
            playerHp: 10,
            savedAt: Date.now() - STORY_BOSS_SAVE_TTL_MS - 1,
        }));
        assert.equal(battleResumeStateExists(lock("storyBoss"), "ResumeRisk", character()), false);
    });

    it("requires both app context and combat snapshot for endless and arena-story locks", () => {
        const fakeAi = { id: "scaled-ai", name: "Scaled AI" };

        localStorage.setItem(endlessCtxKey("ResumeRisk"), JSON.stringify({
            wave: 4,
            aiId: "scaled-ai",
            ai: fakeAi,
            savedAt: Date.now(),
        }));
        assert.equal(battleResumeStateExists(lock("endless"), "ResumeRisk", character()), false);
        writeArenaSnapshot();
        assert.equal(battleResumeStateExists(lock("endless"), "ResumeRisk", character()), true);

        localStorage.clear();
        writeArenaSnapshot();
        localStorage.setItem(arenaStoryCtxKey("ResumeRisk"), JSON.stringify({
            battle: { kind: "weeklyBoss" },
            aiId: "scaled-ai",
            ai: fakeAi,
            savedAt: Date.now(),
        }));
        assert.equal(battleResumeStateExists(lock("arenaStory"), "ResumeRisk", character()), true);

        localStorage.removeItem(arenaStoryCtxKey("ResumeRisk"));
        assert.equal(battleResumeStateExists(lock("arenaStory"), "ResumeRisk", character()), false);
    });

    it("resumes hollow-gate tile locks only while a run is active", () => {
        assert.equal(battleResumeStateExists(lock("hollowGateTiles"), "ResumeRisk", character()), false);
        assert.equal(battleResumeStateExists(lock("hollowGateTiles"), "ResumeRisk", character({
            hollowGateRun: { completed: true },
        })), false);
        assert.equal(battleResumeStateExists(lock("hollowGateTiles"), "ResumeRisk", character({
            hollowGateRun: { completed: false },
        })), true);
    });
});
