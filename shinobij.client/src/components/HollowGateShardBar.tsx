/**
 * Hollow Gate — in-run Hollow Shard relic bar. Lets the player spend their
 * banked Hollow Shards on the run consumables (Reignite Torch, Skeleton Key,
 * Hollow Ward, Diviner's Eye, Sanctify Loot, Second Wind). The spend/effect
 * logic lives in lib/hollow-gate-shards; this is just the UI + wiring, kept out
 * of App.tsx (which is at its line budget).
 */
import type { Character, HollowGateShrineRun } from "../types/character";
import { HOLLOW_SHARD_CONSUMABLES, applyShardConsumable, shardConsumableAvailable } from "../lib/hollow-gate-shards";

type Props = {
    run: HollowGateShrineRun;
    character: Character;
    setRun: (r: HollowGateShrineRun) => void;
    setCharacter: (c: Character) => void;
    pushLog: (line: string) => void;
};

export function HollowGateShardBar({ run, character, setRun, setCharacter, pushLog }: Props) {
    const shards = character.hollowShards ?? 0;

    function use(id: string) {
        const res = applyShardConsumable(id, run, character);
        if (res.ok === false) { pushLog(res.reason); return; }
        setRun(res.run);
        setCharacter(res.character);
        pushLog(res.log);
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
                            onClick={() => use(c.id)}
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
