/**
 * Hollow Gate — in-run Hollow Shard relic bar. Lets the player spend their
 * banked Hollow Shards on the run consumables (Reignite Torch, Skeleton Key,
 * Hollow Ward, Diviner's Eye, Sanctify Loot, Second Wind). The spend/effect
 * catalog/availability projection lives in lib/hollow-gate-shards; all spend and
 * gameplay effects are committed by the server-owned run endpoint.
 */
import { useEffect, useRef } from "react";
import type { Character, HollowGateShrineRun, VersionedCharacterCommit } from "../types/character";
import { HOLLOW_SHARD_CONSUMABLES, shardConsumableAvailable } from "../lib/hollow-gate-shards";
import { requestHollowGateServerConsumable } from "../lib/hollow-gate-server";
import { GameArtIcon } from "./GameArtIcon";

type Props = {
    run: HollowGateShrineRun;
    character: Character;
    setRun: (r: HollowGateShrineRun) => void;
    onVersionedCharacter: VersionedCharacterCommit;
    pushLog: (line: string) => void;
};

export function HollowGateShardBar({ run, character, setRun, onVersionedCharacter, pushLog }: Props) {
    const shards = character.hollowShards ?? 0;
    // The run as last rendered. A relic's reply is applied to it, not to the run
    // this click saw, so a step taken while the request was in flight is kept.
    const latestRunRef = useRef(run);
    useEffect(() => { latestRunRef.current = run; });

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
        const latest = latestRunRef.current.runToken === run.runToken ? latestRunRef.current : run;
        const nextRun: HollowGateShrineRun = {
            ...latest,
            keys: result.runState.keys,
            torch: result.runState.torch,
            threat: result.runState.threat,
            wardSteps: result.runState.wardSteps,
            diviner: result.runState.divinerUsed || latest.diviner,
            secondWindArmed: result.runState.secondWindArmed,
            entryCurrencies: result.entryCurrencies ?? latest.entryCurrencies,
            ...(result.runState.divinerUsed ? { tiles: latest.tiles.map((tile) => ({ ...tile, revealed: true })) } : {}),
        };
        // The shards are spent even when a newer save was adopted first and this
        // commit is refused as stale (the coordinator then reads the stored save
        // back). The run lives here, not in that save, so it must still show the
        // relic: otherwise its button stays live and a second press, with a new
        // request id, spends the shards again.
        onVersionedCharacter({ ...result.character, hollowGateRun: nextRun }, result._saveVersion);
        setRun(nextRun);
        const consumable = HOLLOW_SHARD_CONSUMABLES.find((entry) => entry.id === id);
        pushLog(`${consumable?.label ?? "Shrine relic"} answers the server-sealed run.`);
    }

    return (
        <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "rgba(46,16,84,0.35)", border: "1px solid rgba(124,58,237,0.35)" }}>
            <div style={{ fontSize: 12, color: "#c4b5fd", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                <GameArtIcon kind="fateShard" size={18} />
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
                            {c.label} · {c.cost} Shards
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
