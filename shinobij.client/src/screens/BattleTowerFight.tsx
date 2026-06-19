import { useEffect, useMemo, useRef, useState } from "react";
import type { Character } from "../types/character";
import {
    submitTowerAction, settleTowerRun, fetchTowerState,
    type TowerSession, type TowerActor, type TowerSettleResponse, type TowerFeature,
} from "../lib/towers-api";
import {
    towerHexPixel, towerLayerSize, towerHexDistance, towerNeighbors, towerTilesInRange, HEX_W, HEX_H,
} from "../lib/tower-grid";
import { useBoardScale } from "../lib/use-board-scale";
import banditSprite from "../assets/towers/enemies/bandit.webp";
import archerSprite from "../assets/towers/enemies/archer.webp";
import blockerSprite from "../assets/towers/enemies/blocker.webp";
import bruteSprite from "../assets/towers/enemies/brute.webp";
import acolyteSprite from "../assets/towers/enemies/acolyte.webp";
import wardenSprite from "../assets/towers/enemies/warden.webp";
import ravagerSprite from "../assets/towers/enemies/ravager.webp";
import geninSprite from "../assets/towers/enemies/genin.webp";

// ─── Battle Tower Fight (fullscreen pop-out combat shell) ─────────────────────
// Renders the server-authoritative tower:<runId> session as a top-down hex
// battlefield — the SAME tessellating clip-path hexes + avatar orbs + biome floor
// the live PvP screen uses (PvpBattleScreen), generalised to N actors. The human
// controls their own actor; allies + enemies are AI, advanced server-side. Boss
// units render larger; pylon/ward/hazard tiles are drawn so the tactical layer is
// usable. On a squad clear it auto-settles rewards. See docs/battle-towers-plan.md §11.

type Mode = "idle" | "move" | "attack" | "jutsu";
type JutsuLike = { id?: string; name?: string; type?: string; ap?: number; range?: number; effectPower?: number };

const ORB = 50;          // squad/enemy orb diameter (scales with the board)
const BOSS_ORB = 78;     // bosses render larger

// Enemy sprite-key → painted portrait (keyed by character.visual), with an emoji
// fallback for anything unmapped. Players/allies use their actual avatarImage.
const ENEMY_SPRITE: Record<string, string> = {
    bandit: banditSprite, archer: archerSprite, blocker: blockerSprite, brute: bruteSprite,
    acolyte: acolyteSprite, warden: wardenSprite, ravager: ravagerSprite, genin: geninSprite,
};
const ENEMY_EMOJI: Record<string, string> = {
    bandit: "🥷", archer: "🏹", blocker: "🛡️", brute: "👹", acolyte: "🔮",
    warden: "🐲", ravager: "😈", genin: "🧑",
};
const ELEMENT_ICON: Record<string, string> = { Fire: "🔥", Water: "🌊", Earth: "🪨", Wind: "🌪️", Lightning: "⚡" };

export function BattleTowerFight({
    character,
    runId,
    initialSession,
    onExit,
}: {
    character: Character;
    runId: string;
    initialSession: TowerSession;
    onExit: () => void;
}) {
    const [session, setSession] = useState<TowerSession>(initialSession);
    const [mode, setMode] = useState<Mode>("idle");
    const [selJutsu, setSelJutsu] = useState<JutsuLike | null>(null);
    const [busy, setBusy] = useState(false);
    const [reject, setReject] = useState<string | null>(null);
    const [settle, setSettle] = useState<TowerSettleResponse | null>(null);
    const settledRef = useRef(false);

    const me = character.name;
    const w = session.map.width, h = session.map.height;
    const layer = useMemo(() => towerLayerSize(w, h), [w, h]);
    const { battlefieldCallbackRef, boardContainerSize, userScaleOffset, setUserScaleOffset, effectiveScale } = useBoardScale(layer.width, layer.height);

    const activeId = session.turnQueue[session.activeIndex];
    const activeActor = session.actors.find(a => a.id === activeId);
    const myTurn = session.status === "active" && !!activeActor && activeActor.ai === false && activeActor.ownerSlug === me && activeActor.hp > 0;
    const myActor = activeActor && activeActor.ownerSlug === me ? activeActor : null;
    const bossId = session.phaseState?.bossId;

    // Reconnect: if mounted without a fresh session (or to recover), pull the latest once.
    useEffect(() => {
        if (initialSession.status === "active") return;
        fetchTowerState(runId, me).then(setSession).catch(() => {});
    }, [runId, me, initialSession.status]);

    // Auto-settle once on a squad clear.
    useEffect(() => {
        if (session.status === "done" && session.winner === "squad" && !settledRef.current) {
            settledRef.current = true;
            settleTowerRun(runId, me).then(setSettle).catch(() => {});
        }
    }, [session.status, session.winner, runId, me]);

    // Valid target/move sets for the current mode.
    const myPos = myActor?.pos ?? -1;
    const enemiesInRange = useMemo(() => {
        if (!myActor) return new Set<string>();
        const out = new Set<string>();
        const range = mode === "jutsu" ? Math.max(1, Number(selJutsu?.range ?? 1)) : 1;
        for (const a of session.actors) {
            if (a.hp <= 0 || a.side !== "enemy") continue;
            if (towerHexDistance(myPos, a.pos, w) <= range) out.add(a.id);
        }
        return out;
    }, [myActor, mode, selJutsu, session.actors, myPos, w]);

    const moveTiles = useMemo(() => {
        if (mode !== "move" || !myActor) return new Set<number>();
        const occupied = new Set(session.actors.filter(a => a.hp > 0).map(a => a.pos));
        const blocked = new Set(session.map.blockedTiles);
        return new Set(towerNeighbors(myPos, w, h).filter(t => !occupied.has(t) && !blocked.has(t)));
    }, [mode, myActor, session.actors, session.map.blockedTiles, myPos, w, h]);

    const jutsuRangeTiles = useMemo(() => {
        if (mode !== "jutsu" || !myActor) return new Set<number>();
        return towerTilesInRange(myPos, Math.max(1, Number(selJutsu?.range ?? 1)), w, h);
    }, [mode, myActor, selJutsu, myPos, w, h]);

    // First feature occupying each tile (for tinting + markers).
    const featureByTile = useMemo(() => {
        const m = new Map<number, TowerFeature>();
        for (const f of session.map.features ?? []) for (const t of f.tiles) if (!m.has(t)) m.set(t, f);
        return m;
    }, [session.map.features]);

    async function send(action: Parameters<typeof submitTowerAction>[2]) {
        if (busy) return;
        setBusy(true); setReject(null);
        try {
            const res = await submitTowerAction(runId, me, action);
            setSession(res.session);
            if (!res.applied) setReject(res.reason ?? "Invalid action");
        } catch (e) {
            setReject(String((e as Error)?.message ?? e));
        } finally {
            setBusy(false);
            setMode("idle"); setSelJutsu(null);
        }
    }

    function onTileClick(tile: number) {
        if (!myTurn || busy) return;
        if (mode === "move" && moveTiles.has(tile)) { void send({ type: "move", tile }); return; }
        const occ = session.actors.find(a => a.hp > 0 && a.pos === tile);
        if (occ && occ.side === "enemy" && enemiesInRange.has(occ.id)) {
            if (mode === "attack") void send({ type: "attack", targetId: occ.id });
            else if (mode === "jutsu" && selJutsu?.id) void send({ type: "jutsu", jutsuId: selJutsu.id, targetId: occ.id });
        }
    }

    function avatarFor(a: TowerActor): string | null {
        // Player's own actor → the live avatar prop; allies → their sealed avatar if present;
        // enemies/npc → their painted portrait by sprite key.
        if (a.ownerSlug === me && character.avatarImage) return character.avatarImage;
        const sealed = a.character?.avatarImage;
        if (typeof sealed === "string" && sealed) return sealed;
        const visual = String(a.character?.visual ?? "");
        return ENEMY_SPRITE[visual] ?? null;
    }
    function emojiFor(a: TowerActor): string {
        if (a.side === "squad") return "🥷";
        const visual = String(a.character?.visual ?? "");
        return ENEMY_EMOJI[visual] ?? (a.side === "npc" ? "🧑" : "✦");
    }

    const myJutsu: JutsuLike[] = Array.isArray(myActor?.character?.jutsu) ? (myActor!.character.jutsu as JutsuLike[]) : [];
    const objective = session.objectiveState.kind;
    const squad = session.actors.filter(a => a.side === "squad");
    const enemies = session.actors.filter(a => a.side === "enemy");
    const biome = ["forest", "snow", "volcano", "shadow", "central"].includes(String(session.map.biome)) ? String(session.map.biome) : "central";
    const biomeFloor = `/arena-${biome}-floor.webp`;

    return (
        <div className="arena-fullscreen screen-battleTowerFight" style={{ position: "relative", minHeight: "100dvh", color: "#e2e8f0", background: "linear-gradient(160deg,#070b16,#0b1326)" }}>
            <div style={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: "168px minmax(0,1fr) 196px", gap: 10, padding: 10, minHeight: "100dvh" }}>

                {/* Squad rail */}
                <aside style={{ minWidth: 0 }}>
                    <h3 style={{ margin: "0 0 8px" }}>🛡 Squad</h3>
                    {squad.map(a => <ActorCard key={a.id} actor={a} highlight={a.id === activeId} avatar={avatarFor(a)} emoji={emojiFor(a)} />)}
                </aside>

                {/* Board */}
                <main style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
                        <strong>Floor {session.floor} · {objective.replace(/-/g, " ")}</strong>
                        <span style={{ color: "#94a3b8", flex: 1, textAlign: "right" }}>Round {session.round}{myTurn ? " · your turn" : ""}</span>
                        <input type="range" min={-0.4} max={1} step={0.05} value={userScaleOffset} title="Zoom"
                            onChange={e => setUserScaleOffset(Number(e.target.value))} style={{ width: 90 }} />
                        {session.status === "active" && (
                            // Free, penalty-free abandon — floors have unlimited retries.
                            <button
                                style={{ padding: "4px 10px", fontSize: "0.8rem", borderColor: "#475569", color: "#cbd5e1" }}
                                onClick={() => { if (window.confirm("Leave this floor? Your run won't be saved — floors have unlimited retries.")) onExit(); }}
                            >Leave</button>
                        )}
                    </div>

                    <div ref={battlefieldCallbackRef}
                        style={{ flex: 1, minHeight: 420, position: "relative", overflow: "hidden", borderRadius: 10, border: "2px solid #334155", background: `linear-gradient(rgba(5,9,20,0.35),rgba(5,9,20,0.55)), url(${biomeFloor}) center/cover no-repeat` }}>
                        <div style={{
                            position: "absolute",
                            left: `${Math.max(0, (boardContainerSize.w - layer.width * effectiveScale) / 2)}px`,
                            top: `${Math.max(0, (boardContainerSize.h - layer.height * effectiveScale) / 2)}px`,
                            width: `${layer.width * effectiveScale}px`, height: `${layer.height * effectiveScale}px`,
                        }}>
                            <div className="hex-grid-layer" style={{ position: "absolute", left: 0, top: 0, width: layer.width, height: layer.height, transform: `scale(${effectiveScale})`, transformOrigin: "top left" }}>
                                {/* hex tiles */}
                                {Array.from({ length: w * h }, (_, pos) => {
                                    const { left, top } = towerHexPixel(pos, w);
                                    const isMove = moveTiles.has(pos);
                                    const inJ = mode === "jutsu" && jutsuRangeTiles.has(pos);
                                    const isGoal = session.map.objectiveTiles.includes(pos);
                                    const isBlocked = session.map.blockedTiles.includes(pos);
                                    const feat = featureByTile.get(pos);
                                    return (
                                        <button key={pos} onClick={() => onTileClick(pos)} title={feat ? featureLabel(feat) : undefined}
                                            className="tower-hex-tile"
                                            style={{
                                                left, top, width: HEX_W, height: HEX_H,
                                                cursor: (isMove || (mode !== "idle")) && myTurn ? "pointer" : "default",
                                                ...tileFill(feat, { isMove, inJ, isGoal, isBlocked }),
                                            }} />
                                    );
                                })}

                                {/* feature markers */}
                                {[...featureByTile.entries()].map(([pos, feat]) => {
                                    const { left, top } = towerHexPixel(pos, w);
                                    return (
                                        <div key={`f-${pos}`} title={featureLabel(feat)} aria-hidden
                                            style={{ position: "absolute", left: left + HEX_W / 2 - 11, top: top + HEX_H / 2 - 13, fontSize: 18, lineHeight: 1, zIndex: 4, pointerEvents: "none", textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}>
                                            {featureIcon(feat)}
                                        </div>
                                    );
                                })}

                                {/* actor orbs */}
                                {session.actors.filter(a => a.hp > 0).map(a => {
                                    const { left, top } = towerHexPixel(a.pos, w);
                                    const isBoss = a.id === bossId;
                                    const size = isBoss ? BOSS_ORB : ORB;
                                    const ox = left + HEX_W / 2 - size / 2;
                                    const oy = top + HEX_H * 0.85 - size;
                                    const row = Math.floor(a.pos / w);
                                    const targetable = enemiesInRange.has(a.id) && (mode === "attack" || (mode === "jutsu" && !!selJutsu));
                                    const isActive = a.id === activeId;
                                    const img = avatarFor(a);
                                    const ringColor = a.side === "squad" ? "#67e8f9" : a.side === "npc" ? "#facc15" : "#fb7185";
                                    const pct = Math.max(0, Math.min(100, (a.hp / Math.max(1, a.maxHp)) * 100));
                                    return (
                                        <div key={a.id} onClick={() => onTileClick(a.pos)} title={`${a.name} ${a.hp}/${a.maxHp}`}
                                            style={{ position: "absolute", left: ox, top: oy, width: size, zIndex: 10 + row, cursor: targetable ? "pointer" : "default" }}>
                                            <div className={`avatar-orb${a.side === "enemy" ? " enemy-orb" : ""}`}
                                                style={{
                                                    width: size, height: size,
                                                    outline: isActive ? "3px solid #fde047" : targetable ? "3px solid #fca5a5" : "none",
                                                    outlineOffset: 2,
                                                    boxShadow: targetable ? "0 0 16px 4px rgba(248,113,113,0.9)" : undefined,
                                                }}>
                                                {img
                                                    ? <img className="tiny-map-avatar" src={img} alt={a.name} />
                                                    : <span style={{ fontSize: size * 0.52, lineHeight: 1 }} role="img" aria-label={a.name}>{emojiFor(a)}</span>}
                                                {isBoss && <span style={{ position: "absolute", top: -2, right: -2, fontSize: 16, filter: "drop-shadow(0 1px 2px #000)" }}>👑</span>}
                                            </div>
                                            {/* name + hp bar */}
                                            <div style={{ marginTop: 3, textAlign: "center", pointerEvents: "none" }}>
                                                <div style={{ height: 4, width: size, borderRadius: 2, background: "rgba(2,6,18,0.85)", border: "1px solid rgba(0,0,0,0.5)" }}>
                                                    <div style={{ width: `${pct}%`, height: "100%", borderRadius: 2, background: ringColor }} />
                                                </div>
                                                <div style={{ fontSize: 9, fontWeight: 700, color: "#e2e8f0", textShadow: "0 1px 3px #000", whiteSpace: "nowrap", marginTop: 1 }}>
                                                    {a.name}{isBoss ? "" : ""}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Action bar */}
                    <div style={{ marginTop: 8, minHeight: 56 }}>
                        {myTurn ? (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                                <span style={{ color: "#facc15", fontWeight: 700 }}>{session.activeAp} AP</span>
                                <span style={{ color: "#94a3b8", fontSize: "0.8rem" }}>{session.actionsThisTurn}/5</span>
                                <ActBtn label="Move (30)" on={mode === "move"} onClick={() => setMode(m => m === "move" ? "idle" : "move")} disabled={busy} />
                                <ActBtn label="Attack (40)" on={mode === "attack"} onClick={() => setMode(m => m === "attack" ? "idle" : "attack")} disabled={busy} />
                                {myJutsu.length > 0 && (
                                    <select value={selJutsu?.id ?? ""} disabled={busy}
                                        onChange={e => { const j = myJutsu.find(x => x.id === e.target.value) ?? null; setSelJutsu(j); setMode(j ? "jutsu" : "idle"); }}
                                        style={{ padding: "0.35rem", borderRadius: 6, background: "#0b1220", color: "#e2e8f0", border: "1px solid #334155" }}>
                                        <option value="">Jutsu…</option>
                                        {myJutsu.map(j => <option key={j.id} value={j.id}>{j.name ?? j.id} ({j.ap ?? 40} AP)</option>)}
                                    </select>
                                )}
                                <ActBtn label="End turn" on={false} onClick={() => void send({ type: "wait" })} disabled={busy} />
                                {reject && <span style={{ color: "#f87171", fontSize: "0.8rem" }}>⚠ {reject}</span>}
                            </div>
                        ) : (
                            <p className="hint" style={{ margin: 0 }}>{session.status === "active" ? "Allies & enemies are acting…" : ""}</p>
                        )}
                    </div>
                </main>

                {/* Enemy + log rail */}
                <aside style={{ minWidth: 0 }}>
                    <h3 style={{ margin: "0 0 8px" }}>👹 Enemies</h3>
                    {enemies.map(a => <ActorCard key={a.id} actor={a} highlight={a.id === activeId} avatar={avatarFor(a)} emoji={emojiFor(a)} boss={a.id === bossId} />)}
                    <h4 style={{ margin: "12px 0 4px" }}>Log</h4>
                    <div style={{ maxHeight: 200, overflow: "auto", fontSize: "0.74rem", color: "#cbd5e1", background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: 6 }}>
                        {session.log.slice(-30).map((line, i) => <div key={i}>{line}</div>)}
                    </div>
                </aside>
            </div>

            {/* Result overlay */}
            {session.status === "done" && (
                <div style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(2,6,14,0.82)" }}>
                    <div className="card" style={{ textAlign: "center", padding: "1.6rem", maxWidth: 420 }}>
                        <h1 style={{ marginTop: 0, color: session.winner === "squad" ? "#4ade80" : "#f87171" }}>
                            {session.winner === "squad" ? "🏆 Floor Cleared!" : "💀 Floor Failed"}
                        </h1>
                        {session.winner === "squad" && (
                            settle ? <p>Rewards settled. {settle.results[me]?.score ? `Score +${settle.results[me]!.score}` : ""}</p> : <p className="hint">Settling rewards…</p>
                        )}
                        <button style={{ marginTop: 12, padding: "0.7rem 1.4rem" }} onClick={onExit}>Return to the Tower</button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Tile fill (feature tint + state highlight) ───────────────────────────────
function tileFill(
    feat: TowerFeature | undefined,
    s: { isMove: boolean; inJ: boolean; isGoal: boolean; isBlocked: boolean },
): { background: string; borderColor: string; boxShadow?: string } {
    if (s.isMove) return { background: "rgba(74,222,128,0.30)", borderColor: "#4ade80", boxShadow: "inset 0 0 10px rgba(74,222,128,0.5)" };
    if (s.inJ) return { background: "rgba(96,165,250,0.22)", borderColor: "#60a5fa" };
    if (s.isBlocked) return { background: "rgba(100,116,139,0.55)", borderColor: "rgba(148,163,184,0.5)" };
    if (feat) {
        if (feat.kind === "pylon") {
            const fire = feat.element === "Fire" || feat.element === "Lightning";
            return fire
                ? { background: "rgba(248,113,113,0.22)", borderColor: "rgba(251,146,60,0.85)" }
                : { background: "rgba(56,189,248,0.22)", borderColor: "rgba(56,189,248,0.9)" };
        }
        if (feat.kind === "ward") return { background: "rgba(203,213,225,0.24)", borderColor: "rgba(226,232,240,0.8)" };
        if (feat.kind === "hazard") return { background: "rgba(220,38,38,0.28)", borderColor: "rgba(248,113,113,0.85)" };
    }
    if (s.isGoal) return { background: "rgba(250,204,21,0.30)", borderColor: "#facc15" };
    // Default tile: a clearly-visible translucent blue (the FILL is what reads as a
    // hexagon — a CSS border on a clip-path traces the rect, not the hex shape — so
    // the honeycomb comes from the fill + the gaps between cells, matching PvP). Still
    // translucent enough to let the biome floor show through.
    return { background: "linear-gradient(135deg, rgba(37,99,235,0.5), rgba(23,49,128,0.42))", borderColor: "rgba(125,211,252,0.5)" };
}
function featureIcon(feat: TowerFeature): string {
    if (feat.kind === "pylon") return ELEMENT_ICON[feat.element] ?? "🔆";
    if (feat.kind === "ward") return "🛡️";
    return "⚠️";
}
function featureLabel(feat: TowerFeature): string {
    if (feat.kind === "pylon") return `${feat.label ?? "Pylon"}: +${feat.percent}% ${feat.element} / −${feat.percent}% ${feat.weakenElement} (attacking from here)`;
    if (feat.kind === "ward") return `${feat.label ?? "Ward"}: −${feat.percent}% damage taken while standing here`;
    return `${feat.label ?? "Hazard"}: ${feat.percent}% max HP if you end the round here`;
}

function ActorCard({ actor, highlight, avatar, emoji, boss }: { actor: TowerActor; highlight: boolean; avatar: string | null; emoji: string; boss?: boolean }) {
    const pct = Math.max(0, Math.min(100, (actor.hp / Math.max(1, actor.maxHp)) * 100));
    const dead = actor.hp <= 0;
    const accent = actor.side === "squad" ? "#4ade80" : actor.side === "npc" ? "#facc15" : "#f87171";
    return (
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 7px", marginBottom: 5, borderRadius: 6, background: highlight ? "#15233b" : "rgba(11,18,32,0.7)", border: `1px solid ${highlight ? "#60a5fa" : "#1e293b"}`, opacity: dead ? 0.4 : 1 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, overflow: "hidden", border: `2px solid ${accent}`, display: "flex", alignItems: "center", justifyContent: "center", background: "#0b1220" }}>
                {avatar ? <img src={avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 15 }}>{emoji}</span>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", gap: 4 }}>
                    <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{boss ? "👑 " : ""}{actor.name}</strong>
                    <span style={{ color: "#94a3b8", flexShrink: 0 }}>{Math.max(0, actor.hp)}/{actor.maxHp}</span>
                </div>
                <div style={{ height: 5, background: "#0b1220", borderRadius: 3, marginTop: 3 }}>
                    <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: dead ? "#475569" : accent }} />
                </div>
            </div>
        </div>
    );
}

function ActBtn({ label, on, onClick, disabled }: { label: string; on: boolean; onClick: () => void; disabled: boolean }) {
    return (
        <button onClick={onClick} disabled={disabled}
            style={{ padding: "0.4rem 0.7rem", borderRadius: 6, fontWeight: 600, cursor: "pointer", border: `1px solid ${on ? "#60a5fa" : "#334155"}`, background: on ? "#15233b" : "#0b1220", color: "#e2e8f0" }}>
            {label}
        </button>
    );
}
