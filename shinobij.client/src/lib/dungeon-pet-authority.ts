import type { Character } from "../types/character";
import type { Pet } from "../types/pet";

const DUNGEON_RARE_BEAST_ID = "dungeon-rare-beast";

export type DungeonPetBattleConfig = {
    mode: "1v1";
    seed: number;
    damageMult: number;
    hpMult: number;
    revive: boolean;
    applyItems: boolean;
    accuracy: boolean;
    terrain: string | null;
};

export type DungeonPetBattleSeal = {
    token: string;
    reportKey: string;
    seed: number;
    playerPet: Pet;
    opponentPet: Pet;
    battleConfig: DungeonPetBattleConfig;
};

export type DungeonPetSettlement = {
    outcome: "win" | "loss" | "draw";
    character: Character;
    saveVersion: number;
    replayed: boolean;
};

function objectRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function parseSealedPet(value: unknown, expectedId: string): Pet | null {
    const pet = objectRecord(value);
    if (!pet || pet.id !== expectedId || typeof pet.name !== "string"
        || !Number.isFinite(Number(pet.hp)) || Number(pet.hp) <= 0
        || !Number.isFinite(Number(pet.attack)) || Number(pet.attack) <= 0
        || !Number.isFinite(Number(pet.defense)) || Number(pet.defense) < 0
        || !Number.isFinite(Number(pet.speed)) || Number(pet.speed) <= 0
        || !Array.isArray(pet.jutsus) || "image" in pet || "bodyImage" in pet) return null;
    return pet as unknown as Pet;
}

function parseBattleConfig(value: unknown, seed: number): DungeonPetBattleConfig | null {
    const config = objectRecord(value);
    if (!config || config.mode !== "1v1" || config.seed !== seed
        || !Number.isFinite(Number(config.damageMult)) || Number(config.damageMult) <= 0 || Number(config.damageMult) > 10
        || !Number.isFinite(Number(config.hpMult)) || Number(config.hpMult) <= 0 || Number(config.hpMult) > 10
        || typeof config.revive !== "boolean" || typeof config.applyItems !== "boolean"
        || typeof config.accuracy !== "boolean"
        || (config.terrain !== null && typeof config.terrain !== "string")) return null;
    return config as DungeonPetBattleConfig;
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
    const body = objectRecord(await response.json().catch(() => null));
    if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Dungeon pet authority is unavailable.");
    if (!body) throw new Error("Dungeon pet authority returned an invalid response.");
    return body;
}

export async function startDungeonPetBattle(input: {
    playerName: string;
    playerPetId: string;
    dungeonRunToken: string;
}): Promise<DungeonPetBattleSeal> {
    const response = await fetch("/api/pet/battle-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            playerName: input.playerName,
            mode: "1v1",
            playerPetIds: [input.playerPetId],
            dungeon: { token: input.dungeonRunToken },
        }),
    });
    const body = await responseBody(response);
    const seed = Number(body.seed);
    const token = typeof body.token === "string" ? body.token : "";
    const reportKey = typeof body.reportKey === "string" ? body.reportKey : "";
    const players = Array.isArray(body.playerPets) ? body.playerPets : [];
    const opponents = Array.isArray(body.opponentPets) ? body.opponentPets : [];
    const playerPet = players.length === 1 ? parseSealedPet(players[0], input.playerPetId) : null;
    const opponentPet = opponents.length === 1 ? parseSealedPet(opponents[0], DUNGEON_RARE_BEAST_ID) : null;
    const battleConfig = Number.isSafeInteger(seed) ? parseBattleConfig(body.battleConfig, seed) : null;
    if (body.dungeon !== true || !/^[A-Za-z0-9]+$/.test(token) || !reportKey
        || !Number.isSafeInteger(seed) || !playerPet || !opponentPet || !battleConfig) {
        throw new Error("Dungeon pet authority did not return a complete sealed encounter.");
    }
    return { token, reportKey, seed, playerPet, opponentPet, battleConfig };
}

export async function settleDungeonPetBattle(input: {
    playerName: string;
    seal: DungeonPetBattleSeal;
    reportedOutcome: "win" | "loss" | "draw";
    inputLog?: unknown;
}): Promise<DungeonPetSettlement> {
    const response = await fetch("/api/pet/battle-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            playerName: input.playerName,
            battleToken: input.seal.token,
            reportKey: input.seal.reportKey,
            outcome: input.reportedOutcome,
            inputLog: input.inputLog,
        }),
    });
    const body = await responseBody(response);
    const outcome = body.outcome;
    const character = objectRecord(body.character);
    const saveVersion = Number(body._saveVersion);
    if (body.dungeon !== true || (outcome !== "win" && outcome !== "loss" && outcome !== "draw")
        || !character || !Number.isSafeInteger(saveVersion) || saveVersion < 1) {
        throw new Error("Dungeon pet authority did not return a verifiable terminal result.");
    }
    return {
        outcome,
        character: character as unknown as Character,
        saveVersion,
        replayed: body.replayed === true,
    };
}
