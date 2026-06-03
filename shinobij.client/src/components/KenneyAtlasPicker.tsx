/**
 * KenneyAtlasPicker — admin tool for slicing tiles out of a sprite atlas and
 * assigning them to Hollow Gate shrine icon/theme slots (published as
 * shared images). Used only by the admin creator panel. Extracted verbatim
 * from App.tsx with no behavior change; publishSharedImage is imported back
 * from ../App (same pattern as the other extracted components).
 */
/* eslint-disable react-hooks/set-state-in-effect */ // matches App.tsx's file-wide suppression; logic moved verbatim
import { useState, useEffect, Fragment, type Dispatch, type SetStateAction } from "react";
import {
    HOLLOW_GATE_ICON_ROLES,
    HOLLOW_GATE_ICON_SLOTS,
    HOLLOW_GATE_THEME_SLOTS,
    HOLLOW_GATE_THEMES,
    HOLLOW_GATE_ICON_KEY,
    type HollowGateIconSlot,
} from "../data/hollow-gate-atlas";
import { hollowGateTileIconForKind } from "../data/hollow-gate-flavor";
import { publishSharedImage } from "../lib/shared-images";

export function KenneyAtlasPicker({
    sharedImages,
    setSharedImages,
}: {
    sharedImages: Record<string, string>;
    setSharedImages: Dispatch<SetStateAction<Record<string, string>>>;
}) {
    // ── Atlas registry ────────────────────────────────────────────────────
    // Drop additional Kenney CC0 packs into shinobij.client/public/assets/
    // dungeon/ and add them here. Each entry is a candidate the user can
    // pick from the dropdown. The custom-URL field below also lets them
    // load any URL ad-hoc without editing this list.
    const KNOWN_ATLASES: Array<{ id: string; label: string; url: string; tileSize: number; gap: number }> = [
        // ── Already in the repo ──
        { id: "caves",          label: "Kenney — Roguelike Caves & Dungeons (terrain)",  url: "/assets/dungeon/tilemap.png",                  tileSize: 16, gap: 1 },
        // 0x72's Dungeon Tileset II — best single-atlas coverage: chests, monsters,
        // wizards, knights, skeletons, demons, doors, stairs, traps, torches,
        // weapons, potions. CC-BY-4.0 — credit "0x72" in README.
        { id: "0x72",           label: "0x72 — Dungeon Tileset II (chars + chests + monsters)", url: "/assets/dungeon/0x72-dungeon-tileset-ii.png", tileSize: 16, gap: 0 },
        // Companion atlases packaged alongside 0x72 (or similar community pack):
        // floor/wall tilesets split into separate files. Useful if the user wants
        // very specific dungeon surfaces.
        { id: "atlas-floor",      label: "Atlas — Floor tiles (16×16)",     url: "/assets/dungeon/atlas-floor.png",      tileSize: 16, gap: 0 },
        { id: "atlas-walls-low",  label: "Atlas — Low walls (16×16)",       url: "/assets/dungeon/atlas-walls-low.png",  tileSize: 16, gap: 0 },
        { id: "atlas-walls-high", label: "Atlas — High walls (16×32)",      url: "/assets/dungeon/atlas-walls-high.png", tileSize: 16, gap: 0 },
        // ── Drop-in slots for additional Kenney packs (file just needs to exist) ──
        { id: "tiny-dungeon",   label: "Kenney — Tiny Dungeon (drop in tiny-dungeon.png)", url: "/assets/dungeon/tiny-dungeon.png", tileSize: 16, gap: 1 },
        { id: "characters",     label: "Kenney — Roguelike Characters (drop in characters.png)", url: "/assets/dungeon/characters.png", tileSize: 16, gap: 1 },
    ];
    const PICKER_LS_KEY = "hollowGate.atlasPicker.config.v1";

    // Hydrate from localStorage so admin doesn't lose their atlas selection
    // when the page reloads.
    const loadInitial = (): { url: string; tileSize: number; gap: number } => {
        try {
            const raw = localStorage.getItem(PICKER_LS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed.url && typeof parsed.tileSize === "number") return parsed;
            }
        } catch { /* ignore */ }
        return { url: KNOWN_ATLASES[0].url, tileSize: 16, gap: 1 };
    };

    const initial = loadInitial();
    const [atlasUrlInput, setAtlasUrlInput] = useState(initial.url);
    const [atlasTileSize, setAtlasTileSize] = useState(initial.tileSize);
    const [atlasGap, setAtlasGap] = useState(initial.gap);
    const [atlas, setAtlas] = useState<{ url: string; w: number; h: number; tileSize: number; gap: number; img: HTMLImageElement } | null>(null);
    const [loadError, setLoadError] = useState<string>("");
    const [hoverCoord, setHoverCoord] = useState<{ x: number; y: number } | null>(null);
    const [pickedCoord, setPickedCoord] = useState<{ x: number; y: number } | null>(null);
    const [zoom, setZoom] = useState(3);
    // Currently-selected slot for one-click slot assignment. When set, clicking
    // a tile in the atlas slices it + uploads to KV under shrine:icon-<id>.
    const [assignSlot, setAssignSlot] = useState<string>("");
    const [busySlot, setBusySlot] = useState<string>("");
    const [savedToast, setSavedToast] = useState<{ slot: string; ts: number } | null>(null);

    // Re-load whenever the URL / tile-size / gap inputs change. Debounce-free
    // since each user action (Load click, dropdown change) updates state.
    useEffect(() => {
        setLoadError("");
        const img = new Image();
        img.onload = () => {
            setAtlas({
                url: img.src,
                w: img.naturalWidth,
                h: img.naturalHeight,
                tileSize: atlasTileSize,
                gap: atlasGap,
                img,
            });
            try {
                localStorage.setItem(PICKER_LS_KEY, JSON.stringify({
                    url: atlasUrlInput,
                    tileSize: atlasTileSize,
                    gap: atlasGap,
                }));
            } catch { /* ignore */ }
        };
        img.onerror = () => {
            setAtlas(null);
            setLoadError(`Couldn't load "${atlasUrlInput}". Drop the PNG into shinobij.client/public/assets/dungeon/ first.`);
        };
        img.src = atlasUrlInput;
    }, [atlasUrlInput, atlasTileSize, atlasGap]);

    const atlasConfigBar = (
        <div style={{ marginBottom: 10, padding: 10, background: "rgba(15,9,28,0.6)", borderRadius: 6, border: "1px solid rgba(168,85,247,0.25)" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap", fontSize: 13 }}>
                <label style={{ display: "grid", gap: 2, flex: "1 1 280px", minWidth: 240 }}>
                    <span style={{ color: "#c4b5fd" }}>Atlas URL</span>
                    <input
                        type="text"
                        value={atlasUrlInput}
                        onChange={(e) => setAtlasUrlInput(e.target.value)}
                        placeholder="/assets/dungeon/tilemap.png"
                        style={{ padding: "4px 8px", background: "rgba(0,0,0,0.4)", color: "#e9d5ff", border: "1px solid rgba(168,85,247,0.4)", borderRadius: 4, fontFamily: "monospace", fontSize: 12 }}
                    />
                </label>
                <label style={{ display: "grid", gap: 2 }}>
                    <span style={{ color: "#c4b5fd" }}>Tile size</span>
                    <input
                        type="number" min={4} max={64}
                        value={atlasTileSize}
                        onChange={(e) => setAtlasTileSize(Math.max(4, Number(e.target.value) || 16))}
                        style={{ width: 60, padding: "4px 6px", background: "rgba(0,0,0,0.4)", color: "#e9d5ff", border: "1px solid rgba(168,85,247,0.4)", borderRadius: 4 }}
                    />
                </label>
                <label style={{ display: "grid", gap: 2 }}>
                    <span style={{ color: "#c4b5fd" }}>Gap (px)</span>
                    <input
                        type="number" min={0} max={8}
                        value={atlasGap}
                        onChange={(e) => setAtlasGap(Math.max(0, Number(e.target.value) || 0))}
                        style={{ width: 60, padding: "4px 6px", background: "rgba(0,0,0,0.4)", color: "#e9d5ff", border: "1px solid rgba(168,85,247,0.4)", borderRadius: 4 }}
                    />
                </label>
                <label style={{ display: "grid", gap: 2, flex: "1 1 200px" }}>
                    <span style={{ color: "#c4b5fd" }}>Known atlases</span>
                    <select
                        value=""
                        onChange={(e) => {
                            const pick = KNOWN_ATLASES.find(a => a.id === e.target.value);
                            if (!pick) return;
                            setAtlasUrlInput(pick.url);
                            setAtlasTileSize(pick.tileSize);
                            setAtlasGap(pick.gap);
                        }}
                        style={{ padding: "4px 8px", background: "rgba(0,0,0,0.4)", color: "#e9d5ff", border: "1px solid rgba(168,85,247,0.4)", borderRadius: 4 }}
                    >
                        <option value="">— Load preset —</option>
                        {KNOWN_ATLASES.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                    </select>
                </label>
            </div>
            {loadError && (
                <p className="hint" style={{ marginTop: 6, color: "#fda4af", fontSize: 12 }}>{loadError}</p>
            )}
            {!loadError && atlas && (
                <p className="hint" style={{ marginTop: 6, color: "#86efac", fontSize: 12 }}>
                    Loaded <code>{atlas.url.split("/").pop()}</code> — {atlas.w}×{atlas.h} px.
                </p>
            )}
        </div>
    );

    if (!atlas) {
        return (
            <section className="summary-box" style={{ marginTop: 12 }}>
                <h3>🗂 Atlas Tile Picker</h3>
                {atlasConfigBar}
                <p className="hint">
                    Type an atlas URL or pick a preset above. Drop the PNG into
                    <code> shinobij.client/public/assets/dungeon/</code> with a matching
                    filename and it'll load automatically.
                </p>
            </section>
        );
    }

    const stride = atlas.tileSize + atlas.gap;
    const cols = Math.floor((atlas.w + atlas.gap) / stride);
    const rows = Math.floor((atlas.h + atlas.gap) / stride);
    const displayedTileSize = atlas.tileSize * zoom;

    // Slice a tile from the atlas at (x,y) and return a data URL.
    // Mirrors the slicer logic in the App-level useEffect — kept here as a
    // local helper so the picker can render previews + push to KV.
    function sliceTile(x: number, y: number): string | null {
        try {
            const ts = atlas!.tileSize;
            const stride = ts + atlas!.gap;
            const scale = 4;
            const outSize = ts * scale;
            const canvas = document.createElement("canvas");
            canvas.width = outSize;
            canvas.height = outSize;
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(atlas!.img, x * stride, y * stride, ts, ts, 0, 0, outSize, outSize);
            return canvas.toDataURL("image/png");
        } catch (err) {
            console.warn("[Atlas picker slice] failed", err);
            return null;
        }
    }

    async function assignTileToSlot(slotId: string, x: number, y: number) {
        const url = sliceTile(x, y);
        if (!url) {
            alert("Could not slice tile from atlas. Check console.");
            return;
        }
        const key = HOLLOW_GATE_ICON_KEY(slotId);
        setBusySlot(slotId);
        // Optimistic: paint the slice into sharedImages immediately so the
        // dungeon + legend update before the KV round-trip lands.
        setSharedImages(prev => ({ ...prev, [key]: url }));
        const ok = await publishSharedImage(key, url);
        setBusySlot("");
        if (ok) {
            setSavedToast({ slot: slotId, ts: Date.now() });
            setTimeout(() => setSavedToast(curr => (curr && curr.ts === Date.now() ? null : curr)), 2500);
        } else {
            alert(`Saved locally but the KV publish failed — refreshing the page will lose this assignment.`);
        }
    }

    async function clearSlot(slotId: string) {
        const key = HOLLOW_GATE_ICON_KEY(slotId);
        if (!confirm(`Clear the atlas image for "${slotId}"? The legend + tile will fall back to the emoji icon.`)) return;
        setBusySlot(slotId);
        setSharedImages(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
        // Real server-side delete via the new DELETE endpoint — used to be a
        // POST with empty string which the validator rejected, leaving the
        // KV record intact and resurrecting the assignment on reload.
        try {
            await fetch(`/api/images?id=${encodeURIComponent(key)}`, { method: 'DELETE' });
            // Bust the cache so a reload re-fetches from KV.
            try { sessionStorage.removeItem(`imgcat:shrine`); } catch { /* ignore */ }
        } catch (err) {
            console.warn("[clearSlot] DELETE failed", err);
        }
        setBusySlot("");
    }

    return (
        <section className="summary-box" style={{ marginTop: 12 }}>
            <h3>🗂 Atlas Tile Picker</h3>
            <p className="hint">
                Click any tile to copy its <code>(col, row)</code>. Atlas:
                <strong> {atlas.w}×{atlas.h}</strong> px,
                <strong> {cols}×{rows}</strong> tiles ({atlas.tileSize}×{atlas.tileSize} with {atlas.gap}px gap).
                Use the URL field to swap between packs — assignments save under
                <code> shrine:icon-&lt;slot&gt;</code> regardless of which atlas they came from.
            </p>

            {/* ── Atlas selector + custom URL ───────────────────────────── */}
            {atlasConfigBar}

            {/* ── Slot assign banner (current selection + saved toast) ──── */}
            <div style={{ marginBottom: 10, padding: 8, background: "rgba(168,85,247,0.08)", borderRadius: 6, border: "1px solid rgba(168,85,247,0.2)", fontSize: 13 }}>
                {assignSlot ? (
                    <span style={{ color: "#86efac" }}>
                        ✓ Click any atlas tile to assign it to <strong>{[...HOLLOW_GATE_ICON_SLOTS, ...HOLLOW_GATE_THEME_SLOTS].find(s => s.id === assignSlot)?.label ?? assignSlot}</strong>
                        <button onClick={() => setAssignSlot("")} style={{ marginLeft: 10, fontSize: 11, padding: "1px 6px", background: "transparent", color: "#fda4af", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 3 }}>cancel</button>
                    </span>
                ) : (
                    <span style={{ color: "#c4b5fd" }}>
                        Click a slot below to <strong>arm it</strong>, then click any atlas tile to assign that sprite.
                        Content roles have 4 variants each — the dungeon picks one per tile so adjacent chests / monsters / traps differ.
                        Themes bundle 4 tiles each; the generator stamps a theme on every room.
                    </span>
                )}
                {savedToast && (
                    <span style={{ marginLeft: 10, color: "#86efac", fontWeight: 600 }}>
                        ✅ Saved!
                    </span>
                )}
            </div>

            {/* ── Slot picker, grouped ─────────────────────────────────── */}
            {(() => {
                // Per-slot tile box renderer — used by both groups below.
                const SlotBox = ({ s }: { s: HollowGateIconSlot }) => {
                    const img = sharedImages[HOLLOW_GATE_ICON_KEY(s.id)];
                    const armed = assignSlot === s.id;
                    return (
                        <div
                            onClick={() => setAssignSlot(armed ? "" : s.id)}
                            title={`${s.label} — click to ${armed ? "disarm" : "arm for assignment"}`}
                            style={{
                                cursor: "pointer",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                padding: "4px 4px 2px",
                                borderRadius: 4,
                                background: armed
                                    ? "rgba(168,85,247,0.30)"
                                    : img ? "rgba(34,197,94,0.10)" : "rgba(15,9,28,0.5)",
                                border: armed
                                    ? "2px solid #a855f7"
                                    : img ? "1px solid rgba(34,197,94,0.4)" : "1px dashed rgba(168,85,247,0.25)",
                                width: 56,
                                boxShadow: armed ? "0 0 8px rgba(168,85,247,0.5)" : undefined,
                            }}
                        >
                            <div style={{
                                width: 42,
                                height: 42,
                                background: img ? `url(${img}) center/contain no-repeat` : "rgba(0,0,0,0.3)",
                                imageRendering: "pixelated",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "#a78bfa",
                                fontSize: 14,
                            }}>
                                {!img && s.kind && hollowGateTileIconForKind(s.kind)}
                            </div>
                            <div style={{ textAlign: "center", color: img ? "#86efac" : "#c4b5fd", marginTop: 2, fontSize: 9, lineHeight: 1.1 }}>
                                v{s.variantIndex}
                            </div>
                            {img && (
                                <button
                                    disabled={busySlot === s.id}
                                    onClick={(e) => { e.stopPropagation(); void clearSlot(s.id); }}
                                    style={{ fontSize: 9, padding: "0 3px", marginTop: 1, background: "transparent", color: "#fda4af", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 3, cursor: "pointer" }}
                                >×</button>
                            )}
                        </div>
                    );
                };

                // Group icon slots by variantGroup (role)
                const rolesGrouped = Object.entries(HOLLOW_GATE_ICON_ROLES).map(([role, cfg]) => ({
                    role,
                    cfg,
                    slots: HOLLOW_GATE_ICON_SLOTS.filter(s => s.variantGroup === role),
                }));

                return (
                    <>
                        <div style={{ marginBottom: 6, fontSize: 12, color: "#c4b5fd", fontWeight: 600 }}>
                            📍 Content icons — variants picked deterministically per tile
                        </div>
                        <div style={{ marginBottom: 12, display: "grid", gridTemplateColumns: "100px 1fr", gap: 6, alignItems: "center" }}>
                            {rolesGrouped.map(({ role, cfg, slots }) => (
                                <Fragment key={role}>
                                    <div style={{ fontSize: 12, color: "#e9d5ff", textAlign: "right", paddingRight: 6 }}>
                                        {cfg.label}<br/>
                                        <span style={{ fontSize: 10, color: "#a78bfa" }}>{slots.length} variant{slots.length === 1 ? "" : "s"}</span>
                                    </div>
                                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                        {slots.map(s => <SlotBox key={s.id} s={s} />)}
                                    </div>
                                </Fragment>
                            ))}
                        </div>

                        <div style={{ marginBottom: 6, fontSize: 12, color: "#c4b5fd", fontWeight: 600 }}>
                            🏛 Room themes — each theme bundles 4 tiles; rooms get a random theme per run
                        </div>
                        <div style={{ marginBottom: 12, display: "grid", gridTemplateColumns: "100px 1fr", gap: 6, alignItems: "center" }}>
                            {HOLLOW_GATE_THEMES.map(theme => {
                                const themeSlots = HOLLOW_GATE_THEME_SLOTS.filter(s => s.variantGroup === `theme-${theme.id}`);
                                return (
                                    <Fragment key={theme.id}>
                                        <div style={{ fontSize: 12, color: "#e9d5ff", textAlign: "right", paddingRight: 6 }}>
                                            {theme.label}<br/>
                                            <span style={{ fontSize: 10, color: "#a78bfa" }}>wall · floor · corridor · door</span>
                                        </div>
                                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                            {themeSlots.map(s => {
                                                const img = sharedImages[HOLLOW_GATE_ICON_KEY(s.id)];
                                                const armed = assignSlot === s.id;
                                                const roleLabel = s.id.split("-").pop()!;
                                                return (
                                                    <div
                                                        key={s.id}
                                                        onClick={() => setAssignSlot(armed ? "" : s.id)}
                                                        title={`${s.label} — click to ${armed ? "disarm" : "arm"}`}
                                                        style={{
                                                            cursor: "pointer",
                                                            display: "flex",
                                                            flexDirection: "column",
                                                            alignItems: "center",
                                                            padding: "4px 4px 2px",
                                                            borderRadius: 4,
                                                            background: armed
                                                                ? "rgba(168,85,247,0.30)"
                                                                : img ? "rgba(34,197,94,0.10)" : "rgba(15,9,28,0.5)",
                                                            border: armed
                                                                ? "2px solid #a855f7"
                                                                : img ? "1px solid rgba(34,197,94,0.4)" : "1px dashed rgba(168,85,247,0.25)",
                                                            width: 56,
                                                            boxShadow: armed ? "0 0 8px rgba(168,85,247,0.5)" : undefined,
                                                        }}
                                                    >
                                                        <div style={{
                                                            width: 42,
                                                            height: 42,
                                                            background: img ? `url(${img}) center/contain no-repeat` : "rgba(0,0,0,0.3)",
                                                            imageRendering: "pixelated",
                                                        }} />
                                                        <div style={{ textAlign: "center", color: img ? "#86efac" : "#c4b5fd", marginTop: 2, fontSize: 9, lineHeight: 1.1 }}>
                                                            {roleLabel}
                                                        </div>
                                                        {img && (
                                                            <button
                                                                disabled={busySlot === s.id}
                                                                onClick={(e) => { e.stopPropagation(); void clearSlot(s.id); }}
                                                                style={{ fontSize: 9, padding: "0 3px", marginTop: 1, background: "transparent", color: "#fda4af", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 3, cursor: "pointer" }}
                                                            >×</button>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </Fragment>
                                );
                            })}
                        </div>
                    </>
                );
            })()}

            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8, fontSize: 13 }}>
                <label>Zoom:</label>
                <input type="range" min={1} max={6} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
                <span><strong>{zoom}×</strong></span>
                {hoverCoord && (
                    <span style={{ marginLeft: 12, color: "#a78bfa" }}>
                        Hovering: <code>{`{ x: ${hoverCoord.x}, y: ${hoverCoord.y} }`}</code>
                    </span>
                )}
                {pickedCoord && (
                    <span style={{ marginLeft: "auto", color: "#86efac" }}>
                        ✅ Picked: <code style={{ background: "rgba(34,197,94,0.15)", padding: "2px 6px", borderRadius: 4 }}>
                            {`{ x: ${pickedCoord.x}, y: ${pickedCoord.y} }`}
                        </code>
                    </span>
                )}
            </div>
            <div
                style={{
                    position: "relative",
                    overflow: "auto",
                    maxHeight: 600,
                    border: "1px solid rgba(168,85,247,0.3)",
                    borderRadius: 6,
                    background: "rgba(0,0,0,0.6)",
                }}
            >
                <div
                    style={{
                        position: "relative",
                        width: atlas.w * zoom,
                        height: atlas.h * zoom,
                        backgroundImage: `url(${atlas.url})`,
                        backgroundSize: `${atlas.w * zoom}px ${atlas.h * zoom}px`,
                        backgroundRepeat: "no-repeat",
                        imageRendering: "pixelated",
                    }}
                    onMouseMove={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const px = (e.clientX - rect.left) / zoom;
                        const py = (e.clientY - rect.top) / zoom;
                        const x = Math.floor(px / stride);
                        const y = Math.floor(py / stride);
                        if (x >= 0 && y >= 0 && x < cols && y < rows) setHoverCoord({ x, y });
                        else setHoverCoord(null);
                    }}
                    onMouseLeave={() => setHoverCoord(null)}
                    onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const px = (e.clientX - rect.left) / zoom;
                        const py = (e.clientY - rect.top) / zoom;
                        const x = Math.floor(px / stride);
                        const y = Math.floor(py / stride);
                        if (x < 0 || y < 0 || x >= cols || y >= rows) return;
                        setPickedCoord({ x, y });
                        const text = `{ x: ${x}, y: ${y} }`;
                        try { void navigator.clipboard.writeText(text); } catch { /* ignore */ }
                        // If a slot is selected, also slice + upload — one click
                        // to both preview AND assign the tile to its role.
                        if (assignSlot) {
                            void assignTileToSlot(assignSlot, x, y);
                        }
                    }}
                >
                    {hoverCoord && (
                        <div
                            style={{
                                position: "absolute",
                                left: hoverCoord.x * stride * zoom,
                                top: hoverCoord.y * stride * zoom,
                                width: displayedTileSize,
                                height: displayedTileSize,
                                border: "2px solid #fbbf24",
                                pointerEvents: "none",
                                boxShadow: "0 0 8px rgba(251,191,36,0.6)",
                            }}
                        />
                    )}
                    {pickedCoord && (
                        <div
                            style={{
                                position: "absolute",
                                left: pickedCoord.x * stride * zoom,
                                top: pickedCoord.y * stride * zoom,
                                width: displayedTileSize,
                                height: displayedTileSize,
                                border: "3px solid #22c55e",
                                pointerEvents: "none",
                                boxShadow: "0 0 12px rgba(34,197,94,0.7)",
                            }}
                        />
                    )}
                </div>
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
                Current defaults in code (likely wrong — use the picker to find correct ones):
                <br/>
                • Wall: <code>{`{ x: 8, y: 2 }`}</code> · Room floor: <code>{`{ x: 10, y: 5 }`}</code>
                <br/>
                • Corridor floor: <code>{`{ x: 14, y: 6 }`}</code> · Door: <code>{`{ x: 27, y: 1 }`}</code>
                <br/>
                • Decorations: torch <code>{`{ x: 18, y: 0 }`}</code>, barrel <code>{`{ x: 2, y: 0 }`}</code>,
                plant <code>{`{ x: 4, y: 11 }`}</code>, skull <code>{`{ x: 19, y: 8 }`}</code>
            </p>
        </section>
    );
}
