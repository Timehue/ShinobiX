/*
 * HollowGateShrineView — the dungeon screen, Spirit-Tracks-style pass.
 *
 * The floor renders as a seamless top-down dungeon (not a grid of bordered
 * cells): fixed 48px tiles inside a camera viewport that follows the player,
 * neighbour-aware walls (flat tops vs south-facing wall FACES so chambers
 * read with depth), doors framed in their walls, torch sconces flickering on
 * lit wall faces, and a three-state fog — lit (current room / torchlight),
 * remembered (explored, drawn dim like a map memory) and dark.
 *
 * Movement is sector-style: tap any known tile and the avatar (a gliding
 * grounded pin — HollowGateAvatar) walks there step by step via the walk hook
 * in App; WASD/arrows still step one tile. A minimap in the side panel keeps
 * the whole floor legible while the camera stays close.
 *
 * Admin-generated atlas art still wins everywhere it is assigned: terrain
 * textures (shrine:tile-*), per-theme tiles (shrine:icon-theme-*), content
 * icon variants (shrine:icon-*) and decorations all overlay the CSS look.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { HollowGateAvatar } from "./HollowGateAvatar";
import { HollowGateBossCinematic } from "./HollowGateBossCinematic";
import { HollowGateShardBar } from "../../components/HollowGateShardBar";
import { HOLLOW_GATE_ICON_KEY, HOLLOW_GATE_ICON_ROLES } from "../../data/hollow-gate-atlas";
import { hollowGateIntroPages, hollowGateTileIconForKind } from "../../data/hollow-gate-flavor";
import { computeHollowGateVisible } from "../../lib/hollow-gate-visibility";
import { hollowGateBossDisplayName, hollowGateRunMaxFloor } from "../../lib/hollow-gate-variant";
import { hollowGateClawBackPreview } from "../../lib/hollow-gate-run";
import {
    HOLLOW_GATE_ALPHA_CINEMATIC,
    hollowGateAlphaCinematicImage,
    hollowGateFloorProfile,
} from "../../lib/hollow-gate-presentation";
import type { HollowGateEventModal } from "../../lib/hollow-gate-tile";
import { WING_GLYPH, WING_TINT, wingThemeAt } from "../../lib/hollow-gate-wings";
import { isPetOnExpedition } from "../../lib/pet";
import {
    playGameSfx,
    primeGameAudio,
    startGameAmbience,
    stopGameAmbience,
} from "../../lib/game-audio";
import type { Character, HollowGateShrineRun, HollowGateTerrain, HollowGateTileKind, VersionedCharacterCommit } from "../../types/character";

type HiddenChamberState = { searched: boolean; relicTaken: boolean } | null;

const BOSS_INTRO_SESSION_PREFIX = "shinobix:hollow-gate-alpha-intro:";
const bossIntroSeenKeys = new Set<string>();

function bossIntroWasSeen(key: string): boolean {
    if (bossIntroSeenKeys.has(key)) return true;
    try {
        const seen = sessionStorage.getItem(`${BOSS_INTRO_SESSION_PREFIX}${key}`) === "1";
        if (seen) bossIntroSeenKeys.add(key);
        return seen;
    } catch {
        return false;
    }
}

function rememberBossIntro(key: string): void {
    bossIntroSeenKeys.add(key);
    try {
        sessionStorage.setItem(`${BOSS_INTRO_SESSION_PREFIX}${key}`, "1");
    } catch {
        // The cinematic remains dismissible when storage is unavailable.
    }
}

type HollowGateShrineViewProps = {
    character: Character;
    hollowGateRun: HollowGateShrineRun;
    hollowGateLog: string[];
    sharedImages: Record<string, string>;
    hollowGateIntroPage: number | null;
    setHollowGateIntroPage: (page: number | null) => void;
    hollowGateEvent: HollowGateEventModal;
    hollowGateHiddenChamber: HiddenChamberState;
    moveHollowGatePlayer: (dx: number, dy: number) => void;
    onTileClick: (idx: number) => void;
    walkTarget: number | null;
    setHollowGateRun: (run: HollowGateShrineRun) => void;
    onVersionedCharacter: VersionedCharacterCommit;
    pushHollowGateLog: (line: string) => void;
    petEligible: boolean;
    exitPending: boolean;
    onEmergencyForfeit: () => void;
    onSearchHiddenChamber: () => void;
    onTakeHiddenChamberRelic: () => void;
    onCloseHiddenChamber: () => void;
};

export function HollowGateShrineView({
    character,
    hollowGateRun,
    hollowGateLog,
    sharedImages,
    hollowGateIntroPage,
    setHollowGateIntroPage,
    hollowGateEvent,
    hollowGateHiddenChamber,
    moveHollowGatePlayer,
    onTileClick,
    walkTarget,
    setHollowGateRun,
    onVersionedCharacter,
    pushHollowGateLog,
    petEligible,
    exitPending,
    onEmergencyForfeit,
    onSearchHiddenChamber,
    onTakeHiddenChamberRelic,
    onCloseHiddenChamber,
}: HollowGateShrineViewProps) {
    const run = hollowGateRun;
    const hiddenChamberOpen = hollowGateHiddenChamber !== null;
    useEffect(() => {
        primeGameAudio(["ambience-hollow", "omen", "paper", "reveal", "mythic"]);
        startGameAmbience("ambience-hollow", { gain: 0.026, fadeMs: 1400 });
        return () => stopGameAmbience(700);
    }, []);
    useEffect(() => {
        const kind = hollowGateEvent?.kind;
        if (kind === "chest") playGameSfx("reveal", { gain: 0.56 });
        else if (kind === "locked") playGameSfx("omen", { gain: 0.52 });
        else if (kind === "story") playGameSfx("paper", { gain: 0.62 });
    }, [hollowGateEvent?.kind]);
    useEffect(() => {
        if (hiddenChamberOpen) playGameSfx("reveal", { gain: 0.68 });
    }, [hiddenChamberOpen]);
    const pet = character.pets.find(p => p.id === character.activePetId);
    const shrineBg = sharedImages["shrine:hollow-gate-background"];
    const cardBackground = shrineBg
        ? `linear-gradient(180deg, rgba(15,9,28,0.78), rgba(8,4,18,0.88)), url(${shrineBg}) center/cover no-repeat`
        : "linear-gradient(180deg, rgba(15,9,28,0.92), rgba(8,4,18,0.95))";
    const maxFloor = hollowGateRunMaxFloor(run);
    const floorProfile = hollowGateFloorProfile(run.floor);
    const bossName = hollowGateBossDisplayName(run);
    const isFinalFloor = run.floor >= maxFloor;
    const isHoundBoss = bossName.toLowerCase().includes("hound");
    const bossIntroKey = `${run.runToken || run.serverSeed || character.name || "local"}:${run.floor}`;
    const [dismissedBossIntroKey, setDismissedBossIntroKey] = useState<string | null>(null);
    const showBossIntro = hollowGateIntroPage === null
        && !hollowGateEvent
        && !hollowGateHiddenChamber
        && isFinalFloor
        && isHoundBoss
        && !run.completed
        && dismissedBossIntroKey !== bossIntroKey
        && !bossIntroWasSeen(bossIntroKey);
    const floorStyle = {
        "--hg-floor-accent": floorProfile.accent,
        "--hg-floor-accent-soft": floorProfile.accentSoft,
        "--hg-floor-fog": floorProfile.fog,
        background: cardBackground,
        color: "#e9d5ff",
        padding: 16,
        borderRadius: 12,
    } as CSSProperties;

    const dismissBossIntro = () => {
        rememberBossIntro(bossIntroKey);
        setDismissedBossIntroKey(bossIntroKey);
    };

    // ── Camera: the viewport is measured; the board translates so the player
    //    stays centred (clamped to the board edges). Small boards just centre.
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const [vp, setVp] = useState({ w: 0, h: 0 });
    useLayoutEffect(() => {
        const el = viewportRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => {
            const r = el.getBoundingClientRect();
            setVp(prev => (prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height }));
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Derived from the measured viewport rather than window.innerWidth at module
    // load, so rotation, split-screen, and browser zoom update the camera.
    const tilePx = vp.w > 0 && vp.w <= 480 ? 40 : 48;
    const boardW = run.width * tilePx;
    const boardH = run.height * tilePx;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const camX = vp.w >= boardW ? (vp.w - boardW) / 2 : clamp(vp.w / 2 - (run.playerX + 0.5) * tilePx, vp.w - boardW, 0);
    const camY = vp.h >= boardH ? (vp.h - boardH) / 2 : clamp(vp.h / 2 - (run.playerY + 0.5) * tilePx, vp.h - boardH, 0);

    return (
                        <div className="card hollow-gate-shrine" data-hg-floor={floorProfile.floor} style={floorStyle}>
                            {showBossIntro && (
                                <HollowGateBossCinematic
                                    mode="entrance"
                                    eyebrow="FINAL FLOOR · ALPHA SANCTUM"
                                    title={bossName}
                                    body={`${floorProfile.atmosphere} ${floorProfile.lore}`}
                                    image={hollowGateAlphaCinematicImage(sharedImages)}
                                    actionLabel="Enter the Alpha Sanctum"
                                    onContinue={dismissBossIntro}
                                    onEmergencyForfeit={onEmergencyForfeit}
                                    exitPending={exitPending}
                                />
                            )}
                            {/* First-entry Intro VN overlay — blocks interaction until dismissed. */}
                            {hollowGateIntroPage !== null && (() => {
                                const page = hollowGateIntroPages[hollowGateIntroPage] ?? hollowGateIntroPages[0];
                                const introImage = sharedImages[page.imageKey];
                                const isLast = hollowGateIntroPage >= hollowGateIntroPages.length - 1;
                                return (
                                    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.86)", overflowY: "auto", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1100, padding: "16px 12px max(16px, env(safe-area-inset-bottom, 16px))" }}>
                                        <div role="dialog" aria-modal="true" aria-labelledby="hg-intro-title" style={{ background: "linear-gradient(180deg, rgba(15,9,28,0.97), rgba(8,4,18,0.99))", border: "2px solid rgba(168,85,247,0.6)", borderRadius: 12, padding: 24, maxWidth: 640, width: "92%", color: "#e9d5ff", boxShadow: "0 0 70px rgba(168,85,247,0.4)" }}>
                                            <p className="act-label" style={{ color: "#a855f7", letterSpacing: 2 }}>HOLLOW GATE — INTRODUCTION</p>
                                            <h2 id="hg-intro-title" style={{ margin: "0 0 12px", color: "#faf5ff" }}>{page.title}</h2>
                                            {introImage && (
                                                <img src={introImage} alt={page.title} style={{ width: "100%", maxHeight: 240, objectFit: "cover", borderRadius: 8, marginBottom: 12 }} />
                                            )}
                                            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                                                {page.lines.map((line, i) => (
                                                    <p key={i} style={{ margin: 0, lineHeight: 1.55 }}>{line}</p>
                                                ))}
                                            </div>
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                                <small style={{ color: "#a78bfa" }}>Page {hollowGateIntroPage + 1} / {hollowGateIntroPages.length}</small>
                                                <div style={{ display: "flex", gap: 8 }}>
                                                    {hollowGateIntroPage > 0 && (
                                                        <button onClick={() => setHollowGateIntroPage(hollowGateIntroPage - 1)}>Back</button>
                                                    )}
                                                    <button
                                                        autoFocus
                                                        onClick={() => {
                                                            if (isLast) setHollowGateIntroPage(null);
                                                            else setHollowGateIntroPage(hollowGateIntroPage + 1);
                                                        }}
                                                        style={{ background: "linear-gradient(135deg,#7c3aed,#a855f7)", borderColor: "#c4b5fd" }}
                                                    >
                                                        {isLast ? "Enter the Shrine" : "Next"}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                                <div>
                                    <p className="act-label" style={{ color: "#a855f7", letterSpacing: 2 }}>
                                        ⛩ {run.variant?.label ? run.variant.label.toUpperCase() : "HOLLOW GATE SHRINE"}
                                        {run.variant && <span style={{ marginLeft: 8, fontSize: 10, color: "#fbbf24", border: "1px solid #b45309", borderRadius: 999, padding: "1px 8px", letterSpacing: 1 }}>EVENT</span>}
                                    </p>
                                    <h2 style={{ margin: 0, color: "#faf5ff" }}>Floor {run.floor} / {maxFloor} · {run.completed ? `${bossName} Defeated` : floorProfile.name}</h2>
                                </div>
                                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                                    <div style={{ minWidth: 200 }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, alignItems: "center" }}>
                                            <span>Threat{run.threat >= 80 && (
                                                <span style={{
                                                    marginLeft: 6,
                                                    fontSize: 11,
                                                    color: "#fda4af",
                                                    fontWeight: 700,
                                                    animation: "hgPulse 1s ease-in-out infinite",
                                                }}>⚠ AMBUSH IMMINENT</span>
                                            )}</span>
                                            <span style={{ color: run.threat >= 80 ? "#fda4af" : "#c4b5fd" }}>{run.threat}%</span>
                                        </div>
                                        <div
                                            role="progressbar"
                                            aria-label="Hollow Gate threat"
                                            aria-valuemin={0}
                                            aria-valuemax={100}
                                            aria-valuenow={run.threat}
                                            style={{
                                            height: 8,
                                            background: "rgba(168,85,247,0.18)",
                                            borderRadius: 4,
                                            overflow: "hidden",
                                            border: run.threat >= 80 ? "1px solid #fda4af" : undefined,
                                            boxShadow: run.threat >= 80 ? "0 0 8px rgba(248,113,113,0.55)" : undefined,
                                        }}>
                                            <div style={{ width: `${run.threat}%`, height: "100%", background: run.threat >= 80 ? "linear-gradient(90deg,#a855f7,#fda4af)" : "linear-gradient(90deg,#7c3aed,#a855f7)" }} />
                                        </div>
                                        <style>{`@keyframes hgPulse { 0%,100%{opacity:1} 50%{opacity:0.35} }`}</style>
                                    </div>
                                    <div style={{ fontSize: 13 }}>
                                        <span title="Shrine Keys">🔑 {run.keys}</span>
                                        <span style={{ marginLeft: 12 }} title="Torch of Reiki">🔥 {run.torch}/10</span>
                                        <span style={{ marginLeft: 12 }} title="Banked Hollow Shards">💎 {character.hollowShards ?? 0}</span>
                                        {(() => { const ar = hollowGateClawBackPreview(character, run); const rr = ar.ryo ?? 0; const rs = ar.hollowShards ?? 0; return (rr || rs) ? <span style={{ marginLeft: 12, color: "#fda4af" }} title="Lost if you die now — Sanctify Loot to protect it">⚠ {[rr ? `${rr} ryo` : "", rs ? `${rs}💎` : ""].filter(Boolean).join(" · ")} at risk</span> : null; })()}
                                    </div>
                                </div>
                            </div>

                            <section className="hg-floor-identity" aria-label={`Floor ${run.floor}: ${floorProfile.name}`}>
                                <div className="hg-floor-identity__seal" aria-hidden="true">{run.floor}</div>
                                <div className="hg-floor-identity__story">
                                    <strong>{floorProfile.epithet}</strong>
                                    <span>{floorProfile.atmosphere}</span>
                                    <small>{floorProfile.lore}</small>
                                </div>
                                <div className="hg-floor-identity__hound">
                                    <span>HOUND SIGNATURE</span>
                                    <strong>{floorProfile.signature}</strong>
                                    <small>{floorProfile.houndEpithet}</small>
                                </div>
                            </section>

                            <div className="hg-layout">
                                {/* Dungeon board: seamless tiles inside the camera viewport.
                                    Room-flood visibility lights the room you're in; explored
                                    tiles stay as a dim map memory; surprise tiles stay
                                    disguised until stepped on. */}
                                {(() => {
                                    // Room-flood visibility (whole floor when Diviner's Eye is active).
                                    const visibleSet = run.diviner
                                        ? new Set(run.tiles.map((_, i) => i))   // Diviner's Eye — whole floor lit
                                        : computeHollowGateVisible(run);
                                    // Known = currently visible ∪ previously explored (stepped
                                    // OR ever seen) — the click-to-walk surface and the "map
                                    // memory" fog tier.
                                    const knownSet = new Set(visibleSet);
                                    run.tiles.forEach((t, i) => { if (t.revealed || t.seen) knownSet.add(i); });
                                    // Pull all admin-generated terrain textures once per render. Each is
                                    // optional — the renderer falls through to the CSS dungeon look if missing.
                                    const doorTexture = sharedImages["shrine:tile-door"];
                                    // Variant texture banks: per-terrain arrays. The atlas slicer fills
                                    // `shrine:tile-X-0..N` entries; this fallback gathers them. If only
                                    // the base (no -0 suffix) exists, we use that single tile everywhere.
                                    function gatherVariants(prefix: string, limit = 4): string[] {
                                        const variants: string[] = [];
                                        for (let i = 0; i < limit; i += 1) {
                                            const v = sharedImages[`${prefix}-${i}`];
                                            if (v) variants.push(v);
                                        }
                                        if (variants.length === 0) {
                                            const base = sharedImages[prefix];
                                            if (base) variants.push(base);
                                        }
                                        return variants;
                                    }
                                    const wallVariants = gatherVariants("shrine:tile-wall", 4);
                                    // South-facing wall FACES get purpose-drawn masonry art
                                    // (shrine:tile-wall-face) distinct from the flat wall TOPS;
                                    // when it exists the CSS brick-course pass steps aside
                                    // (.hg-tex) and only the cap + contact shading draw over it.
                                    const wallFaceVariants = gatherVariants("shrine:tile-wall-face", 4);
                                    const roomFloorVariants = gatherVariants("shrine:tile-room-floor", 4);
                                    const corridorFloorVariants = gatherVariants("shrine:tile-corridor-floor", 4);
                                    // Decoration sprites — sprinkled on top of room floors by the generator.
                                    // Legacy 4 atlas decos (shrine:deco-0..3) — kept for back-compat with old
                                    // saved runs that stored a 0-3 decoration index on tiles. New runs use
                                    // the combined pool below.
                                    const legacyDecorations = [
                                        sharedImages["shrine:deco-0"],
                                        sharedImages["shrine:deco-1"],
                                        sharedImages["shrine:deco-2"],
                                        sharedImages["shrine:deco-3"],
                                    ];
                                    // User-picker decorations (shrine:icon-deco-1..8) — always available.
                                    const userDecorations: string[] = [];
                                    for (let i = 1; i <= 8; i += 1) {
                                        const v = sharedImages[HOLLOW_GATE_ICON_KEY(`deco-${i}`)];
                                        if (v) userDecorations.push(v);
                                    }
                                    // Per-theme decorations — preferred when the tile sits in a themed room.
                                    function themedDecorations(theme: string | undefined): string[] {
                                        if (!theme) return [];
                                        const out: string[] = [];
                                        for (const role of ["deco-1", "deco-2"]) {
                                            const v = sharedImages[`shrine:icon-theme-${theme}-${role}`];
                                            if (v) out.push(v);
                                        }
                                        return out;
                                    }
                                    // Build the decoration pool for a given cell: themed first (so themed
                                    // rooms feel cohesive), then user picks, then atlas defaults. Returns
                                    // the chosen image url or undefined if no decoration art exists at all.
                                    function pickDecorationFor(idx: number, theme: string | undefined, hintIndex: number): string | undefined {
                                        const pool = [
                                            ...themedDecorations(theme),
                                            ...userDecorations,
                                            ...legacyDecorations.filter((x): x is string => Boolean(x)),
                                        ];
                                        if (pool.length === 0) return undefined;
                                        // Mix the tile index with the legacy hint so old runs (which stamped
                                        // a 0-3 index per tile) still get stable picks; new runs just pass 0.
                                        const seed = ((idx * 2654435761) ^ (hintIndex * 16777619)) >>> 0;
                                        return pool[seed % pool.length];
                                    }
                                    // Deterministic cell-index hash so a given cell always picks the same
                                    // variant (no flicker between renders). Standard 32-bit mixing constant.
                                    function variantPick(idx: number, count: number): number {
                                        if (count <= 1) return 0;
                                        return ((idx * 2654435761) >>> 0) % count;
                                    }
                                    // Room theme tile lookup. Each room has a theme stamped on it; for a
                                    // given (theme, role) try shrine:icon-theme-<theme>-<role>. If absent
                                    // we fall back to the base atlas tile. Themes only apply to tiles that
                                    // belong to a room (room_floor + doors); corridors stay default.
                                    function themedTileFor(role: "wall" | "wall-face" | "floor" | "corridor" | "door", theme: string | undefined): string | undefined {
                                        if (!theme) return undefined;
                                        return sharedImages[`shrine:icon-theme-${theme}-${role}`];
                                    }
                                    // Optional texture layer for a terrain (admin atlas art). Returns the
                                    // image url or undefined — the CSS dungeon look is the fallback.
                                    // Wall FACES prefer the dedicated face art and fall back to the
                                    // wall-top texture (the CSS course pass keeps depth either way).
                                    function textureFor(terrainKind: HollowGateTerrain, idx: number, theme?: string, face = false): string | undefined {
                                        if (terrainKind === "wall") {
                                            if (face) {
                                                return themedTileFor("wall-face", theme)
                                                    ?? wallFaceVariants[variantPick(idx, wallFaceVariants.length)]
                                                    ?? themedTileFor("wall", theme)
                                                    ?? wallVariants[variantPick(idx, wallVariants.length)];
                                            }
                                            return themedTileFor("wall", theme) ?? wallVariants[variantPick(idx, wallVariants.length)];
                                        }
                                        if (terrainKind === "corridor_floor") return themedTileFor("corridor", theme) ?? corridorFloorVariants[variantPick(idx, corridorFloorVariants.length)];
                                        if (terrainKind === "door") return themedTileFor("door", theme) ?? doorTexture;
                                        return themedTileFor("floor", theme) ?? roomFloorVariants[variantPick(idx, roomFloorVariants.length)];
                                    }
                                    // True when a dedicated face texture exists for this theme —
                                    // used to swap the CSS painted-brick pass for a lighter one.
                                    function hasFaceArt(theme: string | undefined): boolean {
                                        return Boolean(themedTileFor("wall-face", theme) ?? wallFaceVariants[0]);
                                    }
                                    // Per-cell theme resolver — null roomId (wall / corridor outside a room)
                                    // gets the room theme of the nearest 4-neighbour room cell, so walls
                                    // bordering a themed room pick up that theme. Falls back to "" if no
                                    // neighbour has a theme.
                                    function tileTheme(idx: number): string | undefined {
                                        const tile = run.tiles[idx];
                                        if (!tile) return undefined;
                                        if (tile.roomId != null && run.roomThemes) return run.roomThemes[tile.roomId];
                                        if (!run.roomThemes) return undefined;
                                        // Look at 4-cardinal neighbours; first room neighbour wins.
                                        const cx = idx % run.width;
                                        const cy = Math.floor(idx / run.width);
                                        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                                            const nx = cx + dx, ny = cy + dy;
                                            if (nx < 0 || ny < 0 || nx >= run.width || ny >= run.height) continue;
                                            const nTile = run.tiles[ny * run.width + nx];
                                            if (nTile?.roomId != null && run.roomThemes[nTile.roomId]) {
                                                return run.roomThemes[nTile.roomId];
                                            }
                                        }
                                        return undefined;
                                    }
                                    // Variant-aware icon lookup for a content role (chest, battle, etc.).
                                    // Tries shrine:icon-<role>-1..N in deterministic hash order, falls back
                                    // to shrine:icon-<role> (legacy single-icon assignments).
                                    function pickRoleIconImage(role: string, idx: number): string | undefined {
                                        const cfg = HOLLOW_GATE_ICON_ROLES[role];
                                        if (!cfg) return undefined;
                                        if (cfg.count === 1) return sharedImages[HOLLOW_GATE_ICON_KEY(role)];
                                        const assigned: string[] = [];
                                        for (let i = 1; i <= cfg.count; i += 1) {
                                            const v = sharedImages[HOLLOW_GATE_ICON_KEY(`${role}-${i}`)];
                                            if (v) assigned.push(v);
                                        }
                                        if (assigned.length === 0) return sharedImages[HOLLOW_GATE_ICON_KEY(role)];
                                        return assigned[variantPick(idx, assigned.length)];
                                    }
                                    const w = run.width, h = run.height;
                                    const isWallAt = (x: number, y: number) => {
                                        if (x < 0 || y < 0 || x >= w || y >= h) return true;   // outside = solid
                                        const t = run.tiles[y * w + x];
                                        return t.terrain === "wall" || (t.terrain == null && t.kind === "wall");
                                    };
                                    return (
                                 <div className="hg-viewport" ref={viewportRef} style={{ ["--hg-bh" as string]: `${boardH}px` }} aria-label={`Hollow Gate floor ${run.floor} map`}>
                                     <div
                                         className="hg-board"
                                         role="grid"
                                         aria-label={`Floor ${run.floor} dungeon grid`}
                                         aria-rowcount={h}
                                         aria-colcount={w}
                                         style={{
                                             width: boardW,
                                             height: boardH,
                                             gridTemplateColumns: `repeat(${w}, ${tilePx}px)`,
                                             gridAutoRows: `${tilePx}px`,
                                             transform: `translate3d(${Math.round(camX)}px, ${Math.round(camY)}px, 0)`,
                                             ["--hg-tile" as string]: `${tilePx}px`,
                                        }}
                                    >
                                    {run.tiles.map((tile, i) => {
                                        const x = i % w;
                                        const y = Math.floor(i / w);
                                        const isPlayer = x === run.playerX && y === run.playerY;
                                        const revealed = tile.revealed;
                                        const visible = visibleSet.has(i);
                                        const known = knownSet.has(i);
                                        const wall = isWallAt(x, y);
                                        const terrainKind: HollowGateTerrain =
                                            tile.terrain ?? (tile.kind === "wall" ? "wall" : "room_floor");

                                        // ── Cell classes: terrain shape + fog state ────────────
                                        // Walls read with depth: a wall whose SOUTH neighbour is
                                        // walkable shows its FACE (brick courses); other walls are
                                        // flat tops. Floors are seamless (no per-cell borders).
                                        const wallFace = wall && !isWallAt(x, y + 1);
                                        const fogCls = visible ? "hg-lit" : known ? "hg-dim" : "hg-dark";
                                        const shapeCls = wall
                                            ? (wallFace ? "hg-wall-face" : "hg-wall-top")
                                            : terrainKind === "door" ? "hg-door"
                                            : terrainKind === "corridor_floor" ? "hg-floor-corridor"
                                            : "hg-floor-room";
                                        const checkCls = !wall && terrainKind !== "door" && (x + y) % 2 === 0 ? " hg-check" : "";

                                        // ── Optional admin texture + content tint (lit only) ───
                                        // The player's cell renders like any other floor — the
                                        // avatar is an overlay, not a tile style.
                                        const cellTheme = (visible || known) ? tileTheme(i) : undefined;
                                        const texture = (visible || known) ? textureFor(terrainKind, i, cellTheme, wallFace) : undefined;
                                        const texturedFace = wallFace && Boolean(texture) && hasFaceArt(cellTheme);
                                        const layers: string[] = [];
                                        // Surprise tiles (trap/battle/elite/pet) stay disguised as
                                        // floor until actually stepped on (revealed).
                                        const isSurpriseKind = tile.kind === "trap"
                                            || tile.kind === "battle"
                                            || tile.kind === "elite"
                                            || tile.kind === "pet_event"
                                            || tile.kind === "pet_battle";
                                        const hideContent = isSurpriseKind && !revealed;
                                        if (visible && !hideContent) {
                                            const contentTint =
                                                tile.kind === "boss" ? "rgba(185,28,28,0.42)"
                                                : tile.kind === "trap" ? "rgba(239,68,68,0.20)"
                                                : tile.kind === "chest" ? "rgba(234,179,8,0.16)"
                                                : tile.kind === "shrine" ? "rgba(168,85,247,0.22)"
                                                : tile.kind === "exit" ? "rgba(34,197,94,0.20)"
                                                : tile.kind === "locked" ? "rgba(148,163,184,0.20)"
                                                : tile.kind === "npc" ? "rgba(56,189,248,0.16)"
                                                : tile.kind === "descend" ? "rgba(192,132,252,0.24)"
                                                : tile.kind === "elite" ? "rgba(220,38,38,0.20)"
                                                : tile.kind === "shard_vein" ? "rgba(167,139,250,0.20)"
                                                : null;
                                            if (contentTint) layers.push(`linear-gradient(${contentTint}, ${contentTint})`);
                                        }
                                        if (visible && !wall) {
                                            // Wing color-coding: tint floors/doors by their wing.
                                            const wTheme = wingThemeAt(run, i);
                                            if (wTheme && WING_TINT[wTheme]) layers.push(`linear-gradient(${WING_TINT[wTheme]}, ${WING_TINT[wTheme]})`);
                                        }
                                        if ((visible || known) && tile.decoration != null && !wall) {
                                            const decoImg = pickDecorationFor(i, cellTheme, tile.decoration);
                                            if (decoImg) layers.push(`url(${decoImg}) center/72% no-repeat`);
                                        }
                                        if (texture) {
                                            // Supertile sampling: floors/corridors draw the texture
                                            // across a 2×2 block of cells (world-anchored quadrant per
                                            // cell), so the floor reads as ONE continuous surface with
                                            // half the repetition — not 400 identical stamps. Wall
                                            // faces alternate left/right halves so masonry courses run
                                            // on down the wall line. Wall tops/doors stay per-cell.
                                            if (terrainKind === "room_floor" || terrainKind === "corridor_floor") {
                                                layers.push(`url(${texture}) ${-(x % 2) * tilePx}px ${-(y % 2) * tilePx}px / ${tilePx * 2}px ${tilePx * 2}px no-repeat`);
                                            } else if (wallFace) {
                                                layers.push(`url(${texture}) ${-(x % 2) * tilePx}px ${-(tilePx >> 1)}px / ${tilePx * 2}px ${tilePx * 2}px no-repeat`);
                                            } else {
                                                layers.push(`url(${texture}) center/cover no-repeat`);
                                            }
                                        }
                                        const styleBg = layers.length > 0 ? layers.join(", ") : undefined;

                                        // ── Icon: atlas image (shrine:icon-<slot>) or emoji ────
                                        function iconSlotIdFor(k: HollowGateTileKind): string | null {
                                            if (k === "pet_event") return "pet";
                                            if (k === "pet_battle") return "petbattle";
                                            if (k === "tile_game") return "tilegame";
                                            if (k === "shard_vein") return "shardvein";
                                            if (k === "empty" || k === "wall") return null;
                                            return k;
                                        }
                                        const showIcon = !wall && (visible || known) && !(isSurpriseKind && !revealed) && tile.kind !== "empty";
                                        const iconSlotId = showIcon ? iconSlotIdFor(tile.kind) : null;
                                        const iconImage = iconSlotId ? pickRoleIconImage(iconSlotId, i) : undefined;
                                        let icon = "";
                                        if (showIcon) {
                                            icon = hollowGateTileIconForKind(tile.kind);
                                            // Label wing doors with their destination (🏆/🐺/⚔) for an informed choice.
                                            if (tile.terrain === "door") { const dt = wingThemeAt(run, i); if (dt && WING_GLYPH[dt]) icon = WING_GLYPH[dt]; }
                                        }

                                        const clickable = known && !wall && !isPlayer;
                                        const isDest = walkTarget === i;
                                        const tileLabel = isPlayer
                                            ? `${character.name}, current location, row ${y + 1}, column ${x + 1}`
                                            : !known
                                                ? `Unknown tile, row ${y + 1}, column ${x + 1}`
                                                : wall
                                                    ? `Wall, row ${y + 1}, column ${x + 1}`
                                                    : `${showIcon ? tile.kind.replaceAll("_", " ") : "explored floor"}, row ${y + 1}, column ${x + 1}${clickable ? ", press Enter to walk here" : ""}`;

                                        // Torch sconces: a wall face beside an OPENING in its wall
                                        // line (where a corridor/door pierces through) always carries
                                        // a flame — deliberate Zelda-style doorway framing — plus a
                                        // sparse deterministic scatter along long unbroken walls.
                                        const besideOpening = wallFace && (!isWallAt(x - 1, y) || !isWallAt(x + 1, y));
                                        const sconce = wallFace && visible && (besideOpening || ((i * 2654435761) >>> 0) % 5 === 0);

                                        return (
                                            <div
                                                 key={i}
                                                 title={wall ? undefined : visible ? tile.kind : known ? "Explored" : undefined}
                                                 role="gridcell"
                                                 aria-label={tileLabel}
                                                 aria-rowindex={y + 1}
                                                 aria-colindex={x + 1}
                                                 aria-current={isPlayer ? "location" : undefined}
                                                 tabIndex={clickable ? 0 : -1}
                                                 className={`hg-cell ${shapeCls} ${fogCls}${texture ? "" : checkCls}${texturedFace ? " hg-tex" : ""}${clickable ? " hg-clickable" : ""}${isDest ? " hg-dest" : ""}`}
                                                 style={styleBg ? { background: styleBg } : undefined}
                                                 onClick={clickable ? () => onTileClick(i) : undefined}
                                                 onKeyDown={clickable ? (event) => {
                                                     if (event.key !== "Enter" && event.key !== " ") return;
                                                     event.preventDefault();
                                                     onTileClick(i);
                                                 } : undefined}
                                             >
                                                 {sconce && <span className="hg-flame" aria-hidden="true" />}
                                                 {iconImage ? (
                                                     <img
                                                         src={iconImage}
                                                         alt=""
                                                         aria-hidden="true"
                                                         className="hg-icon-img"
                                                     />
                                                 ) : icon ? <span className="hg-icon" aria-hidden="true">{icon}</span> : null}
                                            </div>
                                        );
                                    })}
                                    <HollowGateAvatar
                                        tileX={run.playerX}
                                        tileY={run.playerY}
                                        tilePx={tilePx}
                                        avatarImage={character.avatarImage || sharedImages[`avatar:${character.name.toLowerCase()}`] || pickRoleIconImage("you", 0)}
                                        name={character.name}
                                    />
                                    </div>
                                </div>
                                    );
                                })()}

                                {/* Side panel */}
                                <div className="hg-sidepanel" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                    {/* Minimap — the explored floor at a glance (the camera stays
                                        close, the minimap keeps the run orientable). */}
                                    {(() => {
                                        const visibleSet = run.diviner
                                            ? new Set(run.tiles.map((_, i) => i))
                                            : computeHollowGateVisible(run);
                                        const px = Math.max(3, Math.min(7, Math.floor(200 / run.width)));
                                        return (
                                            <div style={{ background: "rgba(15,9,28,0.7)", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 8, padding: 10 }}>
                                                <h4 style={{ margin: "0 0 6px", color: "#c4b5fd", fontSize: 12 }}>Floor Map</h4>
                                                <div className="hg-minimap" style={{ gridTemplateColumns: `repeat(${run.width}, ${px}px)`, gridAutoRows: `${px}px` }}>
                                                    {run.tiles.map((t, i) => {
                                                        const x = i % run.width, y = Math.floor(i / run.width);
                                                        const isYou = x === run.playerX && y === run.playerY;
                                                        const seen = visibleSet.has(i) || t.revealed || t.seen;
                                                        const isWall = t.terrain === "wall" || (t.terrain == null && t.kind === "wall");
                                                        const cls = isYou ? "hg-mm-you"
                                                            : !seen ? "hg-mm-dark"
                                                            : isWall ? "hg-mm-wall"
                                                            : t.kind === "descend" || t.kind === "boss" ? "hg-mm-goal"
                                                            : t.kind === "exit" ? "hg-mm-exit"
                                                            : visibleSet.has(i) ? "hg-mm-lit"
                                                            : "hg-mm-floor";
                                                        return <span key={i} className={cls} />;
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                    {/* Objectives panel — updates as the run progresses. */}
                                    {(() => {
                                        const maxFloor = hollowGateRunMaxFloor(run);
                                        const reachedFinalFloor = run.floor >= maxFloor;
                                        const alphaDefeated = Boolean(run.completed) || run.tiles.some(t => t.kind === "boss" && t.resolved);
                                        const hiddenChamberFound = run.tiles.some(t => t.kind === "shrine" && t.resolved);
                                        const objectives = [
                                            ...(maxFloor > 1 ? [{ label: `Reach Floor ${maxFloor}`, done: reachedFinalFloor }] : []),
                                            { label: `Defeat ${hollowGateBossDisplayName(run)}`, done: alphaDefeated },
                                            { label: "Find a Hidden Chamber (optional)", done: hiddenChamberFound },
                                        ];
                                        return (
                                            <div style={{ background: "rgba(15,9,28,0.7)", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 8, padding: 10, fontSize: 12 }}>
                                                <h4 style={{ margin: "0 0 6px", color: "#c4b5fd" }}>Objectives</h4>
                                                {objectives.map((obj, i) => (
                                                    <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                                                        <span style={{ color: obj.done ? "#86efac" : "#fda4af" }}>{obj.done ? "✓" : "○"}</span>
                                                        <span style={{ textDecoration: obj.done ? "line-through" : undefined, color: obj.done ? "#86efac" : "#e9d5ff" }}>{obj.label}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })()}
                                    <div style={{ background: "rgba(15,9,28,0.7)", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 8, padding: 10, fontSize: 12 }}>
                                        <h4 style={{ margin: "0 0 6px", color: "#c4b5fd" }}>Map Legend</h4>
                                        {/* Legend uses the same atlas icon as the dungeon when the admin
                                            assigned one via the Atlas Tile Picker. Falls back to the
                                            emoji glyph from hollowGateTileIconForKind otherwise. The
                                            "wall" slot uses the room-floor/wall atlas tile instead since
                                            walls render as terrain, not an icon. */}
                                        {(() => {
                                            // Map slot id → emoji fallback. Keeps the legend self-contained.
                                            const fallbackEmoji: Record<string, string> = {
                                                you: "🥷", battle: "⚔", elite: "☠", boss: "👹", trap: "▲",
                                                chest: "▣", shrine: "⛩", story: "📜", pet: "🐾", petbattle: "🐺",
                                                tilegame: "🀄", npc: "👤",
                                                descend: "▼", exit: "⇩", locked: "🔒", wall: "▦",
                                            };
                                            // Walls use the atlas wall tile (terrain), not an icon slot.
                                            const wallTileImg = sharedImages["shrine:tile-wall"] ?? sharedImages["shrine:tile-wall-0"];
                                            // Legend picks any-variant: shrine:icon-<role>-1 first, then
                                            // shrine:icon-<role>-2..N, then the legacy un-suffixed key.
                                            // This way the legend reflects "an assignment exists" without
                                            // caring which specific variant the admin filled.
                                            const anyAssignedVariant = (role: string): string | undefined => {
                                                const cfg = HOLLOW_GATE_ICON_ROLES[role];
                                                if (cfg && cfg.count > 1) {
                                                    for (let i = 1; i <= cfg.count; i += 1) {
                                                        const v = sharedImages[HOLLOW_GATE_ICON_KEY(`${role}-${i}`)];
                                                        if (v) return v;
                                                    }
                                                }
                                                return sharedImages[HOLLOW_GATE_ICON_KEY(role)];
                                            };
                                            const legendCell = (slotId: string, label: string) => {
                                                const img = slotId === "wall" ? wallTileImg : anyAssignedVariant(slotId);
                                                return (
                                                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                        {img ? (
                                                            <img src={img} alt="" style={{ width: 18, height: 18, objectFit: "contain", imageRendering: "pixelated" }} />
                                                        ) : (
                                                            <span style={{ width: 18, textAlign: "center" }}>{fallbackEmoji[slotId]}</span>
                                                        )}
                                                        <span>{label}</span>
                                                    </span>
                                                );
                                            };
                                            return (
                                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                                                    {legendCell("you",     "You")}      {legendCell("battle",  "Hollow Hound")}
                                                    {legendCell("elite",   "Elite Hound")}{legendCell("boss",  "Alpha Hound")}
                                                    {legendCell("trap",    "Trap")}     {legendCell("chest",   "Chest")}
                                                    {legendCell("shrine",  "Shrine")}   {legendCell("story",   "Story")}
                                                    {legendCell("npc",     "Keeper")}   {legendCell("descend", "Descend")}
                                                    {legendCell("exit",    "Leave")}    {legendCell("locked",   "Locked Door")}
                                                    {legendCell("wall",    "Wall")}
                                                </div>
                                            );
                                        })()}
                                        <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(168,85,247,0.2)", fontSize: 11, color: "#a78bfa" }}>
                                            Every room has a purpose: guarded stairs, a sealed treasury, a keeper's alcove. Fights hold the doorways.
                                        </div>
                                    </div>
                                    <div style={{ background: "rgba(15,9,28,0.7)", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 8, padding: 10, fontSize: 12 }}>
                                        <h4 style={{ margin: "0 0 6px", color: "#c4b5fd" }}>Active Pet</h4>
                                        {pet ? (
                                            <>
                                                <div><strong>{pet.name}</strong> · Lv. {pet.level}</div>
                                                <div style={{ color: petEligible ? "#86efac" : "#fda4af" }}>
                                                    {petEligible ? "Available for Hollow Hound duels" : isPetOnExpedition(pet) ? "On expedition" : "Not PvE-ready (needs Lv. 50)"}
                                                </div>
                                            </>
                                        ) : <div className="hint">No active pet selected.</div>}
                                    </div>
                                </div>
                            </div>

                            {/* Movement and always-available recovery controls. */}
                            <div className="hg-controls" style={{ marginTop: 12, display: "flex", justifyContent: "center", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                                <div style={{ fontSize: 12, color: "#c4b5fd" }}>Tap a tile to walk there · WASD / arrows step · or:</div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 44px)", gap: 4 }}>
                                    <div />
                                    <button aria-label="Move up" onClick={() => moveHollowGatePlayer(0, -1)} disabled={!!hollowGateEvent || !!hollowGateHiddenChamber}>▲</button>
                                    <div />
                                    <button aria-label="Move left" onClick={() => moveHollowGatePlayer(-1, 0)} disabled={!!hollowGateEvent || !!hollowGateHiddenChamber}>◀</button>
                                    <div />
                                    <button aria-label="Move right" onClick={() => moveHollowGatePlayer(1, 0)} disabled={!!hollowGateEvent || !!hollowGateHiddenChamber}>▶</button>
                                    <div />
                                    <button aria-label="Move down" onClick={() => moveHollowGatePlayer(0, 1)} disabled={!!hollowGateEvent || !!hollowGateHiddenChamber}>▼</button>
                                    <div />
                                </div>
                                {/* Never disabled: this must stay clickable even while an
                                    ordinary leave is settling, or a stalled request traps the run. */}
                                <button
                                    className="danger-button"
                                    type="button"
                                    onClick={onEmergencyForfeit}
                                    title="Ends the run as a defeat. Use this if the run or an encounter is stuck."
                                >
                                    {exitPending ? "Settling Run..." : "Emergency Forfeit"}
                                </button>
                            </div>

                            <HollowGateShardBar run={run} character={character} setRun={setHollowGateRun} onVersionedCharacter={onVersionedCharacter} pushLog={pushHollowGateLog} />

                            {/* Event log */}
                            <div role="log" aria-live="polite" aria-relevant="additions" style={{ marginTop: 12, background: "rgba(0,0,0,0.45)", border: "1px solid rgba(168,85,247,0.25)", borderRadius: 8, padding: 10, maxHeight: 140, overflowY: "auto", fontSize: 13 }}>
                                <h4 style={{ margin: "0 0 6px", color: "#c4b5fd" }}>Event Log</h4>
                                {hollowGateLog.length === 0 ? <p className="hint">The shrine watches in silence.</p> : hollowGateLog.map((line, i) => (
                                    <p key={i} style={{ margin: "2px 0" }}>• {line}</p>
                                ))}
                            </div>

                            {/* Event modal overlay — shows a generated tile image header
                                when the relevant 'shrine:tile-*' key has art. */}
                            {hollowGateEvent && (() => {
                                const tileImageKey =
                                    hollowGateEvent.kind === "trap" ? "shrine:tile-trap"
                                    : hollowGateEvent.kind === "chest" ? "shrine:tile-ancient-chest"
                                    : hollowGateEvent.kind === "pet_event" ? "shrine:tile-pet-encounter"
                                    : hollowGateEvent.kind === "pet_battle" ? "shrine:tile-hollow-beast"
                                    : hollowGateEvent.kind === "tile_game" ? "shrine:tile-tile-game"
                                    : hollowGateEvent.kind === "locked" ? "shrine:tile-sealed-door"
                                    : hollowGateEvent.kind === "npc" ? "shrine:tile-shrine-keeper"
                                    : hollowGateEvent.kind === "story" ? "shrine:tile-story"
                                    : hollowGateEvent.kind === "battle" || hollowGateEvent.kind === "elite" || hollowGateEvent.kind === "boss" ? "shrine:tile-hollow-beast"
                                    : null;
                                const tileImage = tileImageKey ? sharedImages[tileImageKey] : null;
                                if (hollowGateEvent.presentation === "boss-victory") {
                                    return (
                                        <HollowGateBossCinematic
                                            mode="victory"
                                            eyebrow={hollowGateEvent.eyebrow || "SHRINE RECLAIMED"}
                                            title={hollowGateEvent.title}
                                            body={hollowGateEvent.body}
                                            image={hollowGateEvent.image || HOLLOW_GATE_ALPHA_CINEMATIC}
                                            actionLabel={hollowGateEvent.choices[0]?.label || "Take Final Rewards + Leave"}
                                            onContinue={() => hollowGateEvent.choices[0]?.onSelect()}
                                            onEmergencyForfeit={onEmergencyForfeit}
                                            exitPending={exitPending}
                                        />
                                    );
                                }
                                return (
                                    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", overflowY: "auto", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1000, padding: "16px 12px max(16px, env(safe-area-inset-bottom, 16px))" }} onClick={() => {}}>
                                        <div role="dialog" aria-modal="true" aria-labelledby="hg-event-title" style={{ background: "linear-gradient(180deg, rgba(15,9,28,0.97), rgba(8,4,18,0.99))", border: "2px solid rgba(168,85,247,0.5)", borderRadius: 12, padding: 24, maxWidth: 520, width: "90%", color: "#e9d5ff" }}>
                                            {tileImage && (
                                                <img src={tileImage} alt={hollowGateEvent.title} style={{ width: "100%", height: 180, objectFit: "cover", borderRadius: 8, marginBottom: 12 }} />
                                            )}
                                            <h3 id="hg-event-title" style={{ margin: "0 0 12px", color: "#faf5ff" }}>{hollowGateEvent.title}</h3>
                                            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{hollowGateEvent.body}</p>
                                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
                                                {hollowGateEvent.choices.map((c, i) => (
                                                    <button key={i} autoFocus={i === 0} className={c.tone === "danger" ? "danger-button" : ""} onClick={c.onSelect}>{c.label}</button>
                                                ))}
                                            </div>
                                            <div style={{ marginTop: 18, paddingTop: 12, borderTop: "1px solid rgba(248,113,113,0.25)" }}>
                                                <button
                                                    className="danger-button"
                                                    type="button"
                                                    onClick={onEmergencyForfeit}
                                                    title="Ends the run as a defeat if this encounter cannot continue."
                                                >
                                                    {exitPending ? "Settling Run..." : "Emergency Forfeit Run"}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Hidden Chamber overlay — wears the chamber background art if generated. */}
                            {hollowGateHiddenChamber && (() => {
                                const chamberBg = sharedImages["shrine:hidden-chamber-background"];
                                const chamberStyle = chamberBg
                                    ? `linear-gradient(180deg, rgba(30,15,50,0.82), rgba(15,5,30,0.92)), url(${chamberBg}) center/cover no-repeat`
                                    : "linear-gradient(180deg, rgba(30,15,50,0.97), rgba(15,5,30,0.99))";
                                return (
                                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", overflowY: "auto", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1001, padding: "16px 12px max(16px, env(safe-area-inset-bottom, 16px))" }}>
                                    <div role="dialog" aria-modal="true" aria-labelledby="hg-hidden-title" style={{ background: chamberStyle, border: "2px solid rgba(168,85,247,0.6)", borderRadius: 12, padding: 28, maxWidth: 620, width: "92%", color: "#e9d5ff", boxShadow: "0 0 50px rgba(168,85,247,0.35)" }}>
                                        <p className="act-label" style={{ color: "#a855f7", letterSpacing: 2 }}>HIDDEN CHAMBER</p>
                                        <h2 id="hg-hidden-title" style={{ margin: "0 0 12px", color: "#faf5ff" }}>Secret Area Discovered</h2>
                                        <p style={{ lineHeight: 1.6 }}>A ritual circle pulses violet at the chamber's center. Spirit lanterns hover above a cracked altar. An ancient tablet hums with sealed chakra, and a shrine relic floats untouched within the seal.</p>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, margin: "16px 0", fontSize: 13 }}>
                                            <div style={{ background: "rgba(168,85,247,0.12)", padding: 10, borderRadius: 6 }}><strong>Shrine Relic</strong><br/>{hollowGateHiddenChamber.relicTaken ? "Claimed" : "Available"}</div>
                                            <div style={{ background: "rgba(168,85,247,0.12)", padding: 10, borderRadius: 6 }}><strong>Spirit Lantern</strong><br/>Active</div>
                                            <div style={{ background: "rgba(168,85,247,0.12)", padding: 10, borderRadius: 6 }}><strong>Ancient Tablet</strong><br/>{hollowGateHiddenChamber.searched ? "Read" : "Readable"}</div>
                                        </div>
                                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                                            <button autoFocus={!hollowGateHiddenChamber.searched} disabled={hollowGateHiddenChamber.searched} onClick={() => { playGameSfx("paper", { gain: 0.72 }); onSearchHiddenChamber(); }}>🔍 Search Chamber</button>
                                            <button disabled={hollowGateHiddenChamber.relicTaken} onClick={() => { playGameSfx("mythic", { gain: 0.62 }); onTakeHiddenChamberRelic(); }}>🏺 Take Relic</button>
                                            <button autoFocus={hollowGateHiddenChamber.searched} onClick={onCloseHiddenChamber} className="danger-button">Return to Shrine</button>
                                            <button onClick={onEmergencyForfeit} className="danger-button">
                                                {exitPending ? "Settling Run..." : "Emergency Forfeit Run"}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                );
                            })()}
                        </div>
    );
}
