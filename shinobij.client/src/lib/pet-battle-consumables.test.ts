import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Pet } from "../types/pet";
import { clearPetBattleConsumables } from "./pet-battle-consumables";

const arenaSource = readFileSync(new URL("../screens/PetArena.tsx", import.meta.url), "utf8");

function pet(id: string, overrides: Partial<Pet> & Record<string, unknown> = {}): Pet {
  return {
    id,
    name: id,
    rarity: "standard",
    level: 1,
    xp: 0,
    maxLevel: 10,
    hp: 10,
    attack: 10,
    defense: 10,
    speed: 10,
    jutsus: [],
    unlockedForPve: true,
    ...overrides,
  } as Pet;
}

test("clearing a spent consumable preserves authoritative settlement pet fields", () => {
  const settled = pet("witness", {
    chronicleArenaWins: 10,
    updatedAt: 1234,
    happiness: 88,
    loadout: { collar: "gold-collar", pvp: "guard-plate", consumable: "battle-tonic" },
  });
  const reserve = pet("reserve", {
    chronicleArenaWins: 4,
    loadout: { consumable: "reserve-tonic" },
  });

  const result = clearPetBattleConsumables([settled, reserve], [settled.id]);

  assert.equal((result[0] as Pet & { chronicleArenaWins: number }).chronicleArenaWins, 10);
  assert.equal(result[0].updatedAt, 1234);
  assert.equal(result[0].happiness, 88);
  assert.deepEqual(result[0].loadout, { collar: "gold-collar", pvp: "guard-plate", consumable: undefined });
  assert.strictEqual(result[1], reserve, "pets outside the duel must remain untouched");
  assert.equal(result[1].loadout?.consumable, "reserve-tonic");
});

test("clearing against a fresh base is idempotent when the item is already gone", () => {
  const settled = pet("witness", { chronicleArenaWins: 11, loadout: { collar: "gold-collar" } });
  const [result] = clearPetBattleConsumables([settled], [settled.id]);

  assert.strictEqual(result, settled);
  assert.equal((result as Pet & { chronicleArenaWins: number }).chronicleArenaWins, 11);
});

test("Pet Arena rejects stale versioned settlement snapshots but still clears the spent item", () => {
  assert.match(arenaSource, /onServerVersion\?: \(version: number \| undefined, originatingPlayerName: string\)/);
  assert.match(arenaSource, /authoritativeCharacter && onVersionedCharacter[\s\S]*onVersionedCharacter\(authoritativeCharacter, data\._saveVersion, scope\.playerName\)[\s\S]*onServerVersion\?\.\(data\._saveVersion, scope\.playerName\)/);
  assert.match(arenaSource, /if \(decision === "foreign"\) return false;/);
  assert.match(arenaSource, /if \(decision === "stale"\) \{/);
  assert.match(arenaSource, /clearSpentConsumables\(petIds, scope\)/);
  assert.match(arenaSource, /pets: clearPetBattleConsumables\(data\.character\.pets, petIds\)/);
});
