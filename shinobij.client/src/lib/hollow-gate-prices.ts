/** One module lifetime for the configurable client price display. Server endpoints still validate charges. */

export let HOLLOW_GATE_KEY_DUNGEON_KEY_COST = 5;

export let HOLLOW_GATE_KEY_FATE_SHARD_COST = 10;

export function setHollowGateKeyDungeonKeyCost(v: number) { HOLLOW_GATE_KEY_DUNGEON_KEY_COST = v; }

export function setHollowGateKeyFateShardCost(v: number) { HOLLOW_GATE_KEY_FATE_SHARD_COST = v; }

export let HOLLOW_GATE_UNLOCK_COST = 10_000;

export function setHollowGateUnlockCost(v: number) { HOLLOW_GATE_UNLOCK_COST = v; }
