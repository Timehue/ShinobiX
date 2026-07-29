import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DuelControlSnap } from "../lib/pet-duel-cinematic";
import { DUEL_COMMAND_FULL } from "../lib/pet-duel-cinematic";
import { BOND_FULL } from "../lib/pet-bond-meter";

export type PetDuelCommandDeckProps = {
    control: DuelControlSnap | null;
    petName: string;
    bond: number;
    accent?: { base: string; glow: string };
    compact?: boolean;
    keyboard?: boolean;
    onTechnique: (idx: number) => void;
    onBreak: () => void;
};

type Technique = DuelControlSnap["abilities"][number] & { idx: number };

function techniqueRole(move: Technique): { label: string; glyph: string; color: string } {
    if (move.support) return { label: "Rally", glyph: "✦", color: "#34d399" };
    if (move.isMove) return { label: "Shift", glyph: "➜", color: "#a78bfa" };
    if (["stun", "freeze", "confuse", "movelock", "slow", "debuff", "taunt"].includes(move.kind)) {
        return { label: "Counter", glyph: "◇", color: "#60a5fa" };
    }
    return { label: "Punish", glyph: "⚔", color: "#fbbf24" };
}

export function PetDuelCommandDeck({
    control,
    petName,
    bond,
    accent,
    compact = false,
    keyboard = false,
    onTechnique,
    onBreak,
}: PetDuelCommandDeckProps) {
    const commandReady = !!control?.commandReady;
    const bondReady = bond >= BOND_FULL;
    const glow = accent?.glow ?? "#e9d5ff";
    const base = accent?.base ?? "#6366f1";
    const commandPct = Math.max(0, Math.min(100, ((control?.commandCharge ?? 0) / DUEL_COMMAND_FULL) * 100));
    const bondPct = Math.max(0, Math.min(100, (bond / BOND_FULL) * 100));
    const techniques = useMemo<Technique[]>(
        () => control?.abilities
            .map((move, idx) => ({ ...move, idx }))
            .filter((move) => !move.signature)
            .slice(0, 3) ?? [],
        [control?.abilities],
    );
    const [justOpened, setJustOpened] = useState(false);
    const [calling, setCalling] = useState(false);
    const wasReady = useRef(false);

    useEffect(() => {
        if (commandReady && !wasReady.current) {
            wasReady.current = true;
            setJustOpened(true);
            const timer = window.setTimeout(() => setJustOpened(false), 900);
            return () => window.clearTimeout(timer);
        }
        if (!commandReady) {
            wasReady.current = false;
            // Defer the UI reset so this effect remains an external synchronization
            // boundary instead of introducing a synchronous cascading render.
            const timer = window.setTimeout(() => setCalling(false), 0);
            return () => window.clearTimeout(timer);
        }
    }, [commandReady]);

    const callTechnique = useCallback((move: Technique) => {
        if (!commandReady || calling) return;
        setCalling(true);
        onTechnique(move.idx);
    }, [calling, commandReady, onTechnique]);

    useEffect(() => {
        if (!keyboard) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
            const slot = ["1", "2", "3"].indexOf(event.key);
            if (slot >= 0 && commandReady && !calling && techniques[slot]) {
                event.preventDefault();
                callTechnique(techniques[slot]);
                return;
            }
            if ((event.key === " " || event.code === "Space") && bondReady && !control?.breakPending) {
                event.preventDefault();
                onBreak();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [keyboard, commandReady, calling, techniques, bondReady, control?.breakPending, callTechnique, onBreak]);

    if (!control) return null;

    return (
        <div
            data-testid="pet-duel-command-deck"
            style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 14,
                display: "flex",
                justifyContent: "center",
                alignItems: "flex-end",
                padding: compact ? "8px" : "12px clamp(12px,3vw,30px) 14px",
                background: "linear-gradient(transparent,rgba(2,5,14,.38) 34%,rgba(2,5,14,.88) 100%)",
                pointerEvents: "none",
            }}
        >
            <style>{`
                @keyframes petCommandOpen {
                    0% { opacity: 0; transform: translateY(24px) scale(.96); }
                    60% { opacity: 1; transform: translateY(-4px) scale(1.015); }
                    100% { opacity: 1; transform: translateY(0) scale(1); }
                }
                @keyframes petCommandPulse {
                    0%,100% { box-shadow: 0 10px 34px rgba(0,0,0,.62), 0 0 18px var(--command-glow); }
                    50% { box-shadow: 0 12px 40px rgba(0,0,0,.68), 0 0 34px var(--command-glow); }
                }
                @keyframes petCommandSheen { from { transform: translateX(-150%); } to { transform: translateX(330%); } }
                .pet-command-shell { pointer-events: auto; }
                .pet-command-shell button { transition: transform 100ms ease, filter 100ms ease, border-color 140ms ease, box-shadow 140ms ease; }
                .pet-command-shell button:active:not(:disabled) { transform: translateY(5px) scale(.94); filter: brightness(1.45) saturate(1.25); }
                .pet-command-shell button:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
                @media (prefers-reduced-motion: reduce) {
                    .pet-command-shell, .pet-command-shell * { animation: none !important; transition: none !important; }
                }
            `}</style>

            <div
                className="pet-command-shell"
                style={{
                    ["--command-glow" as string]: `${glow}66`,
                    width: compact ? "100%" : "min(700px,94vw)",
                    display: "grid",
                    gridTemplateColumns: bondReady || control.abilities.some((move) => move.signature)
                        ? compact ? "1fr 78px" : "1fr 112px"
                        : "1fr",
                    gap: compact ? 7 : 10,
                    alignItems: "stretch",
                } as React.CSSProperties}
            >
                <section
                    aria-label="Command window"
                    style={{
                        position: "relative",
                        overflow: "hidden",
                        minHeight: commandReady ? (compact ? 104 : 116) : 64,
                        padding: compact ? "9px 10px" : "11px 14px",
                        borderRadius: 16,
                        border: `1.5px solid ${commandReady ? glow : "rgba(148,163,184,.32)"}`,
                        background: commandReady
                            ? "linear-gradient(145deg,rgba(10,17,35,.97),rgba(5,8,18,.96))"
                            : "linear-gradient(145deg,rgba(7,12,25,.9),rgba(3,6,14,.88))",
                        boxShadow: commandReady ? `0 10px 34px rgba(0,0,0,.62),0 0 24px ${glow}44` : "0 8px 26px rgba(0,0,0,.5)",
                        animation: justOpened ? "petCommandOpen 420ms cubic-bezier(.16,.84,.24,1) both" : commandReady ? "petCommandPulse 1800ms ease-in-out infinite" : undefined,
                    }}
                >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ color: commandReady ? "#fff" : "#9aa7ba", font: `900 ${compact ? 10 : 11}px/1 var(--font-display),Inter,sans-serif`, letterSpacing: ".14em", textTransform: "uppercase" }}>
                                {commandReady ? "Command Window" : "Instinct"}
                            </div>
                            <div style={{ marginTop: 4, color: commandReady ? "#dbeafe" : "#718096", font: `700 ${compact ? 9 : 10}px/1.2 Inter,sans-serif`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {commandReady ? "Call the next beat—execution is guaranteed" : `${petName} is reading the fight`}
                            </div>
                        </div>
                        <strong style={{ color: commandReady ? glow : "#94a3b8", font: "900 11px/1 Inter,sans-serif" }}>
                            {commandReady ? "READY" : `${Math.round(commandPct)}%`}
                        </strong>
                    </div>

                    <div style={{ height: 5, marginTop: 8, borderRadius: 99, overflow: "hidden", background: "rgba(2,6,23,.85)", border: "1px solid rgba(148,163,184,.18)" }}>
                        <div style={{ width: `${commandPct}%`, height: "100%", background: `linear-gradient(90deg,${base},${glow})`, boxShadow: commandReady ? `0 0 12px ${glow}` : undefined, transition: "width 150ms linear" }} />
                    </div>

                    {commandReady && (
                        <div role="group" aria-label="Available techniques" style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, techniques.length)},1fr)`, gap: compact ? 5 : 8, marginTop: 9 }}>
                            {techniques.map((move, slot) => {
                                const role = techniqueRole(move);
                                return (
                                    <button
                                        key={`${move.name}-${move.idx}`}
                                        type="button"
                                        disabled={calling}
                                        onClick={() => callTechnique(move)}
                                        aria-label={`${role.label}: ${move.name}`}
                                        style={{
                                            position: "relative",
                                            minWidth: 0,
                                            minHeight: compact ? 48 : 54,
                                            padding: compact ? "6px 5px" : "7px 9px",
                                            borderRadius: 11,
                                            border: `1px solid ${role.color}aa`,
                                            background: `linear-gradient(180deg,${role.color}28,rgba(3,7,17,.94))`,
                                            color: "#f8fafc",
                                            boxShadow: `inset 0 -2px 0 ${role.color}88,0 4px 13px rgba(0,0,0,.36)`,
                                            cursor: calling ? "default" : "pointer",
                                            opacity: calling ? .58 : 1,
                                            overflow: "hidden",
                                        }}
                                    >
                                        <span aria-hidden style={{ position: "absolute", inset: 0, width: "34%", background: "linear-gradient(90deg,transparent,rgba(255,255,255,.16),transparent)", animation: "petCommandSheen 1700ms linear infinite", animationDelay: `${slot * 180}ms` }} />
                                        <span style={{ position: "relative", display: "block", color: role.color, font: "900 8px/1 Inter,sans-serif", letterSpacing: ".13em", textTransform: "uppercase" }}>
                                            {role.glyph} {role.label}{keyboard ? ` · ${slot + 1}` : ""}
                                        </span>
                                        <span style={{ position: "relative", display: "block", marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", font: `900 ${compact ? 10 : 12}px/1 var(--font-display),Inter,sans-serif` }}>
                                            {move.name}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </section>

                {control.abilities.some((move) => move.signature) && (
                    <button
                        type="button"
                        data-testid="pet-duel-bond-break"
                        aria-label={`Bond Break, ${Math.round(bondPct)} percent charged`}
                        disabled={!bondReady || control.breakPending}
                        onClick={onBreak}
                        style={{
                            position: "relative",
                            overflow: "hidden",
                            minWidth: 0,
                            borderRadius: 16,
                            border: `2px solid ${bondReady ? "#fbbf24" : "rgba(148,163,184,.32)"}`,
                            background: "rgba(4,8,18,.94)",
                            color: bondReady ? "#fff7e6" : "#718096",
                            boxShadow: bondReady ? `0 0 26px ${glow}66,inset 0 0 18px rgba(245,158,11,.24)` : "0 8px 26px rgba(0,0,0,.5)",
                            cursor: bondReady ? "pointer" : "default",
                            font: `900 ${compact ? 10 : 12}px/1.1 var(--font-display),Inter,sans-serif`,
                            letterSpacing: ".06em",
                            textTransform: "uppercase",
                        }}
                    >
                        <span aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${bondPct}%`, background: bondReady ? "linear-gradient(0deg,#b45309,#f59e0b)" : `linear-gradient(0deg,${base},${glow}66)`, opacity: bondReady ? .9 : .4 }} />
                        <span style={{ position: "relative", display: "block" }}>{control.breakPending ? "Unleashing" : compact ? "Break" : "Bond Break"}</span>
                        <span style={{ position: "relative", display: "block", marginTop: 5, font: "800 9px/1 Inter,sans-serif", opacity: .85 }}>
                            {control.breakPending ? "…" : bondReady ? (keyboard ? "SPACE" : "READY") : `${Math.round(bondPct)}%`}
                        </span>
                    </button>
                )}
            </div>
        </div>
    );
}
