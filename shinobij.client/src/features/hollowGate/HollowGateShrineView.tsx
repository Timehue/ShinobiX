import { HollowGateShardBar } from "../../components/HollowGateShardBar";
import { HOLLOW_GATE_MAX_FLOOR } from "../../constants/game";
import { HOLLOW_GATE_ICON_KEY, HOLLOW_GATE_ICON_ROLES } from "../../data/hollow-gate-atlas";
import { hollowGateIntroPages, hollowGateTileIconForKind } from "../../data/hollow-gate-flavor";
import { computeHollowGateVisible } from "../../lib/hollow-gate-dungeon";
import { hollowGateClawBackPreview } from "../../lib/hollow-gate-run";
import { WING_GLYPH, WING_TINT, wingThemeAt } from "../../lib/hollow-gate-wings";
import { isPetOnExpedition } from "../../lib/pet";
import type { Character, HollowGateShrineRun, HollowGateTerrain, HollowGateTileKind } from "../../types/character";

type HollowGateEventModal = {
    title: string;
    body: string;
    kind: HollowGateTileKind;
    choices: { label: string; onSelect: () => void; tone?: "danger" | "safe" | "primary" }[];
} | null;

type HiddenChamberState = { searched: boolean; relicTaken: boolean } | null;

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
    setHollowGateRun: (run: HollowGateShrineRun) => void;
    setCharacter: (character: Character) => void;
    pushHollowGateLog: (line: string) => void;
    petEligible: boolean;
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
    setHollowGateRun,
    setCharacter,
    pushHollowGateLog,
    petEligible,
    onSearchHiddenChamber,
    onTakeHiddenChamberRelic,
    onCloseHiddenChamber,
}: HollowGateShrineViewProps) {
    const run = hollowGateRun;
    const pet = character.pets.find(p => p.id === character.activePetId);
    const shrineBg = sharedImages["shrine:hollow-gate-background"];
    const cardBackground = shrineBg
        ? `linear-gradient(180deg, rgba(15,9,28,0.78), rgba(8,4,18,0.88)), url(${shrineBg}) center/cover no-repeat`
        : "linear-gradient(180deg, rgba(15,9,28,0.92), rgba(8,4,18,0.95))";

    return (
                        <div className="card hollow-gate-shrine" style={{ background: cardBackground, color: "#e9d5ff", padding: 16, borderRadius: 12 }}>
                            {/* First-entry Intro VN overlay — blocks interaction until dismissed. */}
                            {hollowGateIntroPage !== null && (() => {
                                const page = hollowGateIntroPages[hollowGateIntroPage] ?? hollowGateIntroPages[0];
                                const introImage = sharedImages[page.imageKey];
                                const isLast = hollowGateIntroPage >= hollowGateIntroPages.length - 1;
                                return (
                                    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.86)", overflowY: "auto", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1100, padding: "16px 12px max(16px, env(safe-area-inset-bottom, 16px))" }}>
                                        <div style={{ background: "linear-gradient(180deg, rgba(15,9,28,0.97), rgba(8,4,18,0.99))", border: "2px solid rgba(168,85,247,0.6)", borderRadius: 12, padding: 24, maxWidth: 640, width: "92%", color: "#e9d5ff", boxShadow: "0 0 70px rgba(168,85,247,0.4)" }}>
                                            <p className="act-label" style={{ color: "#a855f7", letterSpacing: 2 }}>HOLLOW GATE — INTRODUCTION</p>
                                            <h2 style={{ margin: "0 0 12px", color: "#faf5ff" }}>{page.title}</h2>
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
                                    <p className="act-label" style={{ color: "#a855f7", letterSpacing: 2 }}>⛩ HOLLOW GATE SHRINE</p>
                                    <h2 style={{ margin: 0, color: "#faf5ff" }}>Floor {run.floor} / {HOLLOW_GATE_MAX_FLOOR} · {run.completed ? "Warden Defeated" : "Shadow Miasma"}</h2>
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
                                        <div style={{
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

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: 16 }}>
                                {/* Grid: room-flood visibility lights the room you're in; walls always
                                    read as stone; surprise tiles stay disguised until stepped on. */}
                                {(() => {
                                    // Room-flood visibility (whole floor when Diviner's Eye is active).
                                    const visibleSet = run.diviner
                                        ? new Set(run.tiles.map((_, i) => i))   // Diviner's Eye — whole floor lit
                                        : computeHollowGateVisible(run);
                                    // Pull all admin-generated terrain textures once per render. Each is
                                    // optional — the renderer falls through to a CSS gradient if missing.
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
                                    // Helper: layered background for a terrain texture (returns CSS string).
                                    function bgFromTexture(image: string | undefined, fallback: string, overlay = "rgba(15,9,28,0.35)") {
                                        return image
                                            ? `linear-gradient(135deg, ${overlay}, rgba(8,4,18,0.55)), url(${image}) center/cover no-repeat`
                                            : fallback;
                                    }
                                    // Room theme tile lookup. Each room has a theme stamped on it; for a
                                    // given (theme, role) try shrine:icon-theme-<theme>-<role>. If absent
                                    // we fall back to the base atlas tile. Themes only apply to tiles that
                                    // belong to a room (room_floor + doors); corridors stay default.
                                    function themedTileFor(role: "wall" | "floor" | "corridor" | "door", theme: string | undefined): string | undefined {
                                        if (!theme) return undefined;
                                        return sharedImages[`shrine:icon-theme-${theme}-${role}`];
                                    }
                                    function bgForTerrain(terrainKind: HollowGateTerrain, idx: number, theme?: string): string {
                                        if (terrainKind === "wall") {
                                            const themed = themedTileFor("wall", theme);
                                            const v = themed ?? wallVariants[variantPick(idx, wallVariants.length)];
                                            return v
                                                ? `linear-gradient(135deg, rgba(15,9,28,0.35), rgba(8,4,18,0.55)), url(${v}) center/cover no-repeat`
                                                : "linear-gradient(135deg, #1c1430 0%, #0e0820 40%, #2a1f3e 100%)";
                                        }
                                        if (terrainKind === "corridor_floor") {
                                            const themed = themedTileFor("corridor", theme);
                                            const v = themed ?? corridorFloorVariants[variantPick(idx, corridorFloorVariants.length)];
                                            return bgFromTexture(v, "linear-gradient(135deg, rgba(40,28,72,0.7), rgba(28,18,54,0.85))");
                                        }
                                        if (terrainKind === "door") {
                                            const themed = themedTileFor("door", theme);
                                            return bgFromTexture(themed ?? doorTexture, "linear-gradient(135deg, rgba(120,72,32,0.5), rgba(64,40,18,0.75))", "rgba(40,20,8,0.3)");
                                        }
                                        // room_floor (default)
                                        const themed = themedTileFor("floor", theme);
                                        const v = themed ?? roomFloorVariants[variantPick(idx, roomFloorVariants.length)];
                                        return bgFromTexture(v, "linear-gradient(135deg, rgba(50,38,82,0.7), rgba(34,24,60,0.85))");
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
                                    return (
                                <div className="hollow-gate-grid" style={{ display: "grid", gridTemplateColumns: `repeat(${run.width}, 1fr)`, gap: 3, background: "rgba(0,0,0,0.55)", padding: 8, borderRadius: 8 }}>
                                    {run.tiles.map((tile, i) => {
                                        const x = i % run.width;
                                        const y = Math.floor(i / run.width);
                                        const isPlayer = x === run.playerX && y === run.playerY;
                                        const revealed = tile.revealed;
                                        // Lit when the room-flood visibility set includes this index.
                                        const visible = visibleSet.has(i);
                                        // Wall test prefers terrain; falls back to kind for legacy runs.
                                        const wall = tile.terrain === "wall" || (tile.terrain == null && tile.kind === "wall");
                                        const terrainKind: HollowGateTerrain =
                                            tile.terrain ?? (tile.kind === "wall" ? "wall" : "room_floor");

                                        // Background by tile state: only currently-visible tiles draw
                                        // their terrain (via bgForTerrain variant banks); the rest = fog.
                                        const cellTheme = tileTheme(i);
                                        let bg: string;
                                        if (wall) {
                                            bg = visible ? bgForTerrain("wall", i, cellTheme) : "rgba(7,4,15,0.92)";
                                        } else if (isPlayer) {
                                            bg = "linear-gradient(135deg, #2563eb, #7c3aed)";
                                        } else if (visible) {
                                            // Terrain base layer, then optional decoration sprite, then content tint.
                                            let terrainBase = bgForTerrain(terrainKind, i, cellTheme);
                                            // Wing color-coding: tint floors/doors by their wing (Treasure/Beast/Trial).
                                            const wTheme = wingThemeAt(run, i);
                                            if (wTheme && WING_TINT[wTheme]) terrainBase = `linear-gradient(${WING_TINT[wTheme]}, ${WING_TINT[wTheme]}), ${terrainBase}`;
                                            if (tile.decoration != null) {
                                                const decoImg = pickDecorationFor(i, cellTheme, tile.decoration);
                                                if (decoImg) {
                                                    terrainBase = `url(${decoImg}) center/80% no-repeat, ${terrainBase}`;
                                                }
                                            }
                                            // Surprise tiles (trap/battle/elite/pet) stay disguised as
                                            // floor until actually stepped on (revealed) — tint hidden.
                                            const isSurpriseKind = tile.kind === "trap"
                                                || tile.kind === "battle"
                                                || tile.kind === "elite"
                                                || tile.kind === "pet_event"
                                                || tile.kind === "pet_battle";
                                            const hideContent = isSurpriseKind && !revealed;
                                            const contentTint = hideContent ? null
                                                : tile.kind === "boss" ? "linear-gradient(135deg, rgba(127,29,29,0.7), rgba(185,28,28,0.7))"
                                                : tile.kind === "trap" ? "rgba(239,68,68,0.22)"
                                                : tile.kind === "chest" ? "rgba(234,179,8,0.22)"
                                                : tile.kind === "shrine" ? "rgba(168,85,247,0.26)"
                                                : tile.kind === "exit" ? "rgba(34,197,94,0.22)"
                                                : tile.kind === "locked" ? "rgba(148,163,184,0.22)"
                                                : tile.kind === "npc" ? "rgba(56,189,248,0.22)"
                                                : tile.kind === "descend" ? "rgba(192,132,252,0.26)"
                                                : tile.kind === "battle" ? "rgba(248,113,113,0.18)"
                                                : tile.kind === "elite" ? "rgba(220,38,38,0.26)"
                                                : tile.kind === "pet_event" ? "rgba(96,165,250,0.18)"
                                                : tile.kind === "pet_battle" ? "rgba(251,146,60,0.24)"  // beast orange
                                                : tile.kind === "tile_game" ? "rgba(45,212,191,0.22)"   // tile-game teal
                                                : tile.kind === "story" ? "rgba(250,204,21,0.18)"
                                                : tile.kind === "shard_vein" ? "rgba(167,139,250,0.24)"
                                                : null;
                                            bg = contentTint
                                                ? `linear-gradient(${contentTint}, ${contentTint}), ${terrainBase}`
                                                : terrainBase;
                                        } else {
                                            bg = "rgba(7,4,15,0.92)"; // deep fog
                                        }

                                        // Wall styling: brick-ish pattern via inset shadow.
                                        // Only walls that are CURRENTLY visible (perimeter of the lit
                                        // room) get the shadow detail — fog walls stay flat dark.
                                        const wallShadow = wall && visible ? "inset 0 0 0 1px rgba(168,85,247,0.18), inset 2px 2px 0 rgba(0,0,0,0.4)" : undefined;

                                        // Icon shows only on visible tiles; surprise tiles also need
                                        // `revealed` (stay disguised as floor until stepped on).
                                        const isSurpriseKind = tile.kind === "trap"
                                            || tile.kind === "battle"
                                            || tile.kind === "elite"
                                            || tile.kind === "pet_event"
                                            || tile.kind === "pet_battle";
                                        // Icon = atlas image (shrine:icon-<slot>) if assigned, else emoji.
                                        // Slot id mirrors HOLLOW_GATE_ICON_SLOTS (a few kinds remap below).
                                        function iconSlotIdFor(k: HollowGateTileKind): string | null {
                                            if (k === "pet_event") return "pet";
                                            if (k === "pet_battle") return "petbattle";
                                            if (k === "tile_game") return "tilegame";
                                            if (k === "shard_vein") return "shardvein";
                                            if (k === "empty" || k === "wall") return null;
                                            return k;
                                        }
                                        const showIcon =
                                            isPlayer ? true
                                            : wall ? false
                                            : !visible ? false
                                            : isSurpriseKind && !revealed ? false
                                            : true;
                                        const iconSlotId = isPlayer ? "you" : iconSlotIdFor(tile.kind);
                                        // Variant-aware icon pick (shrine:icon-<role>-1..N). Player tile
                                        // falls back to the player's own avatar if no "you" slot is assigned.
                                        const playerAvatar = isPlayer
                                            ? (character.avatarImage || sharedImages[`avatar:${character.name.toLowerCase()}`])
                                            : undefined;
                                        const iconImage = showIcon && iconSlotId
                                            ? (pickRoleIconImage(iconSlotId, i) ?? playerAvatar)
                                            : undefined;
                                        let icon: string;
                                        if (!showIcon) icon = !visible && !wall ? "·" : "";       // fog dot or blank
                                        else if (isPlayer) icon = "🥷";
                                        else {
                                            icon = hollowGateTileIconForKind(tile.kind);
                                            // Label wing doors with their destination (🏆/🐺/⚔) for an informed choice.
                                            if (tile.terrain === "door") { const dt = wingThemeAt(run, i); if (dt && WING_GLYPH[dt]) icon = WING_GLYPH[dt]; }
                                        }

                                        // Opacity: player = full, visible cells = full so the lit
                                        // room reads clearly, anything else = dim fog dot.
                                        const iconOpacity = isPlayer || visible ? 1 : 0.30;

                                        return (
                                            <div
                                                key={i}
                                                title={wall ? "Wall" : visible ? tile.kind : "Out of sight"}
                                                style={{
                                                    aspectRatio: "1 / 1",
                                                    background: bg,
                                                    border: isPlayer ? "2px solid #60a5fa"
                                                        : wall && visible ? "1px solid rgba(0,0,0,0.5)"
                                                        : visible ? "1px solid rgba(168,85,247,0.5)"
                                                        : "1px solid rgba(168,85,247,0.08)",
                                                    borderRadius: 4,
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    fontSize: "clamp(16px, 2.6vw, 28px)",
                                                    color: isPlayer || visible ? "#f5f3ff" : "rgba(196,181,253,0.85)",
                                                    opacity: iconOpacity,
                                                    boxShadow: isPlayer ? "0 0 12px rgba(96,165,250,0.6)" : wallShadow,
                                                    transition: "background 200ms, opacity 200ms",
                                                }}
                                            >
                                                {iconImage ? (
                                                    <img
                                                        src={iconImage}
                                                        alt={iconSlotId ?? ""}
                                                        style={{
                                                            width: "78%",
                                                            height: "78%",
                                                            objectFit: "contain",
                                                            imageRendering: "pixelated",
                                                            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.7))",
                                                            pointerEvents: "none",
                                                        }}
                                                    />
                                                ) : icon}
                                            </div>
                                        );
                                    })}
                                </div>
                                    );
                                })()}

                                {/* Side panel */}
                                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                    {/* Objectives panel — updates as the run progresses. */}
                                    {(() => {
                                        const reachedFloor5 = run.floor >= HOLLOW_GATE_MAX_FLOOR;
                                        const wardenDefeated = Boolean(run.completed) || run.tiles.some(t => t.kind === "boss" && t.resolved);
                                        const hiddenChamberFound = run.tiles.some(t => t.kind === "shrine" && t.resolved);
                                        const objectives = [
                                            { label: "Reach Floor 5", done: reachedFloor5 },
                                            { label: "Defeat the Hollow Gate Warden", done: wardenDefeated },
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
                                                    {legendCell("you",     "You")}      {legendCell("battle",  "Battle")}
                                                    {legendCell("elite",   "Elite")}    {legendCell("boss",    "Boss")}
                                                    {legendCell("trap",    "Trap")}     {legendCell("chest",   "Chest")}
                                                    {legendCell("shrine",  "Shrine")}   {legendCell("story",   "Story")}
                                                    {legendCell("pet",      "Pet")}        {legendCell("petbattle", "Hollow Beast")}
                                                    {legendCell("tilegame", "Tile Game")}  {legendCell("npc",       "Keeper")}
                                                    {legendCell("descend",  "Descend")}    {legendCell("exit",      "Leave")}
                                                    {legendCell("locked",   "Locked Door")}{legendCell("wall",      "Wall")}
                                                    <span>· Unexplored</span><span style={{ opacity: 0.55 }}>· In view (dim)</span>
                                                </div>
                                            );
                                        })()}
                                        <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(168,85,247,0.2)", fontSize: 11, color: "#a78bfa" }}>
                                            Layout: rooms connected by corridors; loot &amp; NPCs in rooms, ambushes in corridors.
                                        </div>
                                    </div>
                                    <div style={{ background: "rgba(15,9,28,0.7)", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 8, padding: 10, fontSize: 12 }}>
                                        <h4 style={{ margin: "0 0 6px", color: "#c4b5fd" }}>Active Pet</h4>
                                        {pet ? (
                                            <>
                                                <div><strong>{pet.name}</strong> · Lv. {pet.level}</div>
                                                <div style={{ color: petEligible ? "#86efac" : "#fda4af" }}>
                                                    {petEligible ? "Joins shrine battles" : isPetOnExpedition(pet) ? "On expedition" : "Not PvE-ready (needs Lv. 50)"}
                                                </div>
                                            </>
                                        ) : <div className="hint">No active pet selected.</div>}
                                    </div>
                                </div>
                            </div>

                            {/* Movement controls — note: there is no voluntary "Leave Shrine"
                                button. You can only exit by stepping on the Exit (Leave) tile
                                or by dying. Each entry consumes 1 Hollow Gate Key. */}
                            <div style={{ marginTop: 12, display: "flex", justifyContent: "center", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                                <div style={{ fontSize: 12, color: "#c4b5fd" }}>WASD / Arrow Keys to move · or tap:</div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 44px)", gap: 4 }}>
                                    <div />
                                    <button onClick={() => moveHollowGatePlayer(0, -1)} disabled={!!hollowGateEvent || !!hollowGateHiddenChamber}>▲</button>
                                    <div />
                                    <button onClick={() => moveHollowGatePlayer(-1, 0)} disabled={!!hollowGateEvent || !!hollowGateHiddenChamber}>◀</button>
                                    <div />
                                    <button onClick={() => moveHollowGatePlayer(1, 0)} disabled={!!hollowGateEvent || !!hollowGateHiddenChamber}>▶</button>
                                    <div />
                                    <button onClick={() => moveHollowGatePlayer(0, 1)} disabled={!!hollowGateEvent || !!hollowGateHiddenChamber}>▼</button>
                                    <div />
                                </div>
                                <div style={{ fontSize: 11, color: "#fda4af", textAlign: "center" }}>
                                    No retreat. Reach the<br/>Leave tile (⇩) or die.
                                </div>
                            </div>

                            <HollowGateShardBar run={run} character={character} setRun={setHollowGateRun} setCharacter={setCharacter} pushLog={pushHollowGateLog} />

                            {/* Event log */}
                            <div style={{ marginTop: 12, background: "rgba(0,0,0,0.45)", border: "1px solid rgba(168,85,247,0.25)", borderRadius: 8, padding: 10, maxHeight: 140, overflowY: "auto", fontSize: 13 }}>
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
                                    : hollowGateEvent.kind === "battle" || hollowGateEvent.kind === "elite" ? "shrine:tile-corrupted-shinobi"
                                    : null;
                                const tileImage = tileImageKey ? sharedImages[tileImageKey] : null;
                                return (
                                    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", overflowY: "auto", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1000, padding: "16px 12px max(16px, env(safe-area-inset-bottom, 16px))" }} onClick={() => {}}>
                                        <div style={{ background: "linear-gradient(180deg, rgba(15,9,28,0.97), rgba(8,4,18,0.99))", border: "2px solid rgba(168,85,247,0.5)", borderRadius: 12, padding: 24, maxWidth: 520, width: "90%", color: "#e9d5ff" }}>
                                            {tileImage && (
                                                <img src={tileImage} alt={hollowGateEvent.title} style={{ width: "100%", height: 180, objectFit: "cover", borderRadius: 8, marginBottom: 12 }} />
                                            )}
                                            <h3 style={{ margin: "0 0 12px", color: "#faf5ff" }}>{hollowGateEvent.title}</h3>
                                            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{hollowGateEvent.body}</p>
                                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
                                                {hollowGateEvent.choices.map((c, i) => (
                                                    <button key={i} className={c.tone === "danger" ? "danger-button" : ""} onClick={c.onSelect}>{c.label}</button>
                                                ))}
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
                                    <div style={{ background: chamberStyle, border: "2px solid rgba(168,85,247,0.6)", borderRadius: 12, padding: 28, maxWidth: 620, width: "92%", color: "#e9d5ff", boxShadow: "0 0 50px rgba(168,85,247,0.35)" }}>
                                        <p className="act-label" style={{ color: "#a855f7", letterSpacing: 2 }}>HIDDEN CHAMBER</p>
                                        <h2 style={{ margin: "0 0 12px", color: "#faf5ff" }}>Secret Area Discovered</h2>
                                        <p style={{ lineHeight: 1.6 }}>A ritual circle pulses violet at the chamber's center. Spirit lanterns hover above a cracked altar. An ancient tablet hums with sealed chakra, and a shrine relic floats untouched within the seal.</p>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, margin: "16px 0", fontSize: 13 }}>
                                            <div style={{ background: "rgba(168,85,247,0.12)", padding: 10, borderRadius: 6 }}><strong>Shrine Relic</strong><br/>{hollowGateHiddenChamber.relicTaken ? "Claimed" : "Available"}</div>
                                            <div style={{ background: "rgba(168,85,247,0.12)", padding: 10, borderRadius: 6 }}><strong>Spirit Lantern</strong><br/>Active</div>
                                            <div style={{ background: "rgba(168,85,247,0.12)", padding: 10, borderRadius: 6 }}><strong>Ancient Tablet</strong><br/>{hollowGateHiddenChamber.searched ? "Read" : "Readable"}</div>
                                        </div>
                                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                                            <button disabled={hollowGateHiddenChamber.searched} onClick={onSearchHiddenChamber}>🔍 Search Chamber</button>
                                            <button disabled={hollowGateHiddenChamber.relicTaken} onClick={onTakeHiddenChamberRelic}>🏺 Take Relic</button>
                                            <button onClick={onCloseHiddenChamber} className="danger-button">Return to Shrine</button>
                                        </div>
                                    </div>
                                </div>
                                );
                            })()}
                        </div>
    );
}
