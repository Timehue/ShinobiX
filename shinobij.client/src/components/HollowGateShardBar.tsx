/**
 * Hollow Gate — in-run Hollow Shard relic bar. Lets the player spend their
 * banked Hollow Shards on the run consumables (Reignite Torch, Skeleton Key,
 * Hollow Ward, Diviner's Eye, Sanctify Loot, Second Wind). The spend/effect
 * catalog/availability projection lives in lib/hollow-gate-shards; all spend and
 * gameplay effects are committed by the server-owned run endpoint.
 */
import type { Character, HollowGateShrineRun, VersionedCharacterCommit } from "../types/character";
import { HOLLOW_SHARD_CONSUMABLES, shardConsumableAvailable } from "../lib/hollow-gate-shards";
import { requestHollowGateServerConsumable } from "../lib/hollow-gate-server";

type Props = {
    run: HollowGateShrineRun;
    character: Character;
    setRun: (r: HollowGateShrineRun) => void;
    onVersionedCharacter: VersionedCharacterCommit;
    pushLog: (line: string) => void;
};

export function HollowGateShardBar({ run, character, setRun, onVersionedCharacter, pushLog }: Props) {
    const shards = character.hollowShards ?? 0;

    async function use(id: string) {
        if (!run.runToken) {
            pushLog("This legacy run has no server seal. Leave and begin a verified run before using shrine relics.");
            return;
        }
        const actions = {
            reignite: "reignite",
            "skeleton-key": "skeleton-key",
            "hollow-ward": "hollow-ward",
            "diviner-eye": "diviner-eye",
            sanctify: "sanctify",
            "second-wind": "arm-second-wind",
        } as const;
        const action = actions[id as keyof typeof actions];
        if (!action) return pushLog("Unknown shrine relic.");
        const result = await requestHollowGateServerConsumable(character.name, run.runToken, action);
        if (!result?.ok || !result.character || !result.runState) {
            pushLog(result?.error ?? "The shrine could not seal that relic. Retry in a moment.");
            return;
        }
        const nextRun: HollowGateShrineRun = {
            ...run,
            keys: result.runState.keys,
            torch: result.runState.torch,
            threat: result.runState.threat,
            wardSteps: result.runState.wardSteps,
            diviner: result.runState.divinerUsed || run.diviner,
            secondWindArmed: result.runState.secondWindArmed,
            entryCurrencies: result.entryCurrencies ?? run.entryCurrencies,
            ...(result.runState.divinerUsed ? { tiles: run.tiles.map((tile) => ({ ...tile, revealed: true })) } : {}),
        };
        if (!onVersionedCharacter({ ...result.character, hollowGateRun: nextRun }, result._saveVersion)) return;
        setRun(nextRun);
        const consumable = HOLLOW_SHARD_CONSUMABLES.find((entry) => entry.id === id);
        pushLog(`${consumable?.label ?? "Shrine relic"} answers the server-sealed run.`);
    }

    return (
        <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "rgba(46,16,84,0.35)", border: "1px solid rgba(124,58,237,0.35)" }}>
            <div style={{ fontSize: 12, color: "#c4b5fd", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 14 }}>💎</span>
                <span>Hollow Shards: <strong style={{ color: "#e9d5ff" }}>{shards}</strong></span>
                <span style={{ opacity: 0.6 }}>· spend on shrine relics</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {HOLLOW_SHARD_CONSUMABLES.filter((c) => !c.comingSoon).map((c) => {
                    const avail = shardConsumableAvailable(c, run, character);
                    return (
                        <button
                            key={c.id}
                            onClick={() => { void use(c.id); }}
                            disabled={!avail}
                            title={c.desc}
                            style={{
                                padding: "5px 9px", borderRadius: 6, fontSize: 12, cursor: avail ? "pointer" : "default",
                                background: avail ? "linear-gradient(#3b2d6b,#241a45)" : "#181527",
                                border: `1px solid ${avail ? "#7c3aed" : "#3a3450"}`,
                                color: avail ? "#e9d5ff" : "#6b6486", opacity: avail ? 1 : 0.55,
                            }}
                        >
                            {c.label} · {c.cost}💎
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
