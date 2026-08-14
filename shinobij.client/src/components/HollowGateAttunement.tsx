/**
 * Hollow Gate — Shrine Attunement panel (Phase 3B). A between-runs modal for
 * spending banked Hollow Shards on permanent shrine upgrades. Buy logic is the
 * pure lib/hollow-gate-attunement; this is the UI. Hosted by WorldMap.
 */
import { useCallback, useRef, useState } from "react";
import type { Character, VersionedCharacterCommit } from "../types/character";
import { ATTUNEMENT_NODES, attunementRank, attunementNextCost, keyForgeUnlocked, KEY_FORGE_COST } from "../lib/hollow-gate-attunement";
import { forgeHollowGateKeyServer as forgeHollowGateKey } from "../lib/hollow-gate-forge-api";
import { buyHollowGateAttunementServer } from "../lib/hollow-gate-attunement-api";
import { requireServerSettlement } from "../lib/server-settlement-gate";
import { gameConfirm } from "./GameAlert";
import { Modal } from "./ui/Modal";

type Props = { character: Character; onClose: () => void; onVersionedCharacter: VersionedCharacterCommit };

export function HollowGateAttunement({ character, onClose, onVersionedCharacter }: Props) {
    const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
    const [forgeBusy, setForgeBusy] = useState(false);
    const [attuneBusy, setAttuneBusy] = useState(false);
    const forgeBusyRef = useRef(false);
    const shards = character.hollowShards ?? 0;

    async function buy(id: string) {
        if (!requireServerSettlement("hollowGateAttunement")) return;
        if (attuneBusy) return;
        setAttuneBusy(true);
        setStatus(null);
        try {
            const result = await buyHollowGateAttunementServer(character.name, id);
            if (!result.character) {
                setStatus({ text: result.error || "The attunement did not return an updated save.", ok: false });
                return;
            }
            if (!onVersionedCharacter(result.character, result._saveVersion)) return;
            setStatus({ text: "Attunement purchased.", ok: true });
        } finally {
            setAttuneBusy(false);
        }
    }

    async function forge() {
        if (!requireServerSettlement("hollowGateKeyForge")) return;
        if (forgeBusyRef.current) return;
        if (shards < KEY_FORGE_COST) {
            setStatus({ text: `You need ${KEY_FORGE_COST} Hollow Shards to forge a key.`, ok: false });
            return;
        }
        forgeBusyRef.current = true;
        setForgeBusy(true);
        const confirmed = await gameConfirm(
            `Forge 1 Hollow Gate Key for ${KEY_FORGE_COST} Hollow Shards? The shards are spent immediately and cannot be refunded.`,
            { title: "Forge Hollow Gate Key", confirmLabel: "Forge Key" },
        );
        if (!confirmed) {
            forgeBusyRef.current = false;
            setForgeBusy(false);
            return;
        }
        setStatus(null);
        try {
            const r = await forgeHollowGateKey(character.name, "hollowShards");
            if (!r.character) {
                setStatus({ text: r.error || "The key forge did not return an updated save. Refresh before retrying.", ok: false });
                return;
            }
            if (!onVersionedCharacter(r.character, r._saveVersion)) return;
            setStatus({ text: "Forged 1 Hollow Gate Key.", ok: true });
        } catch {
            setStatus({ text: "The key forge response was lost. Refresh your save before retrying so you can confirm whether the key was forged.", ok: false });
        } finally {
            forgeBusyRef.current = false;
            setForgeBusy(false);
        }
    }

    const close = useCallback(() => { if (!forgeBusyRef.current) onClose(); }, [onClose]);

    return (
        <Modal open onClose={close} title="⛩ Shrine Attunement" size="md" disableBackdropClose={forgeBusy || attuneBusy}>
            <div style={{ color: "#e9d5ff" }}>
                <p style={{ margin: "0 0 6px", color: "#c4b5fd", fontSize: 14 }}>💎 Hollow Shards: <strong style={{ color: "#e9d5ff" }}>{shards}</strong> · spend on permanent shrine boons</p>
                {status && <p role="status" aria-live="polite" style={{ color: status.ok ? "#86efac" : "#fca5a5", fontSize: 13, margin: "0 0 6px" }}>{status.text}</p>}
                {ATTUNEMENT_NODES.map((n) => {
                    const rank = attunementRank(character, n.id);
                    const cost = attunementNextCost(character, n.id);
                    const maxed = rank >= n.maxRank;
                    const canBuy = !n.comingSoon && cost != null && shards >= cost;
                    const actionLabel = n.comingSoon
                        ? "Coming soon"
                        : maxed
                            ? "Maxed"
                            : cost != null && shards < cost
                                ? `Need ${cost}💎`
                                : `Attune · ${cost}💎`;
                    return (
                        <div key={n.id} style={{ border: "1px solid #332b4e", borderRadius: 8, padding: "8px 10px", marginBottom: 8, opacity: n.comingSoon ? 0.55 : 1, background: "rgba(46,16,84,0.25)" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                <strong style={{ color: "#e9d5ff", fontSize: 14 }}>
                                    {n.label} <span style={{ fontSize: 12, color: "#a78bfa" }}>{rank}/{n.maxRank}</span>
                                </strong>
                                <button
                                    type="button"
                                    disabled={!canBuy || attuneBusy}
                                    onClick={() => { void buy(n.id); }}
                                    style={{
                                        padding: "4px 10px", borderRadius: 6, fontSize: 12, whiteSpace: "nowrap", cursor: canBuy ? "pointer" : "default",
                                        background: canBuy ? "linear-gradient(#3b2d6b,#241a45)" : "#181527",
                                        border: `1px solid ${canBuy ? "#7c3aed" : "#3a3450"}`,
                                        color: canBuy ? "#e9d5ff" : "#6b6486",
                                    }}
                                >
                                    {actionLabel}
                                </button>
                            </div>
                            <div style={{ fontSize: 12, color: "#c4b5fd", marginTop: 3 }}>{n.desc}</div>
                        </div>
                    );
                })}
                {keyForgeUnlocked(character) && (
                    <button
                        type="button"
                        onClick={() => { void forge(); }}
                        disabled={forgeBusy || shards < KEY_FORGE_COST}
                        style={{
                            marginTop: 4, width: "100%", padding: 9, borderRadius: 8, fontWeight: 600,
                            cursor: shards >= KEY_FORGE_COST ? "pointer" : "default",
                            background: shards >= KEY_FORGE_COST ? "linear-gradient(#7c5a1a,#4a3510)" : "#181527",
                            border: `1px solid ${shards >= KEY_FORGE_COST ? "#f59e0b" : "#3a3450"}`,
                            color: shards >= KEY_FORGE_COST ? "#fde68a" : "#6b6486",
                        }}
                    >
                        {forgeBusy ? "Forging key…" : `🗝 Forge 1 Hollow Gate Key · ${KEY_FORGE_COST}💎`}
                    </button>
                )}
            </div>
        </Modal>
    );
}
