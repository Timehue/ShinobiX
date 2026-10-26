import type { Dispatch, SetStateAction } from "react";
import { craftDungeonEvents } from "../data/vn-events";
import { compressDataUrl, publishSharedImage } from "../lib/shared-images";
import { gameConfirm } from "../components/GameAlert";
import { adminCompactRow, adminCoverImage } from "../lib/admin-panel-styles";

type Progress = { current: number; total: number; label: string } | null;
type Props = {
    sharedImages: Record<string, string>;
    setSharedImages: Dispatch<SetStateAction<Record<string, string>>>;
    dungeonImgBulkRunning: boolean;
    setDungeonImgBulkRunning: Dispatch<SetStateAction<boolean>>;
    dungeonImgBulkProgress: Progress;
    setDungeonImgBulkProgress: Dispatch<SetStateAction<Progress>>;
};

// Progress remains owned by AdminPanel so switching tabs keeps an ongoing batch.
export default function AdminRelicDungeonImagesPanel({ sharedImages, setSharedImages,
    dungeonImgBulkRunning, setDungeonImgBulkRunning, dungeonImgBulkProgress, setDungeonImgBulkProgress }: Props) {
    // Image slots for each of the 5 biome relic dungeons. The
    // dungeon runtime reads these via the `event:<id>:<slot>`
    // sharedImages keys (DungeonEncounter + startDungeonAiFight
    // + DungeonPetBattle). Falls back to event/page defaults
    // when a slot is empty.
    type SlotDef = { slot: string; label: string; hint: string; promptTemplate: (biome: string, dungeonName: string) => string };
    const slotTypes: SlotDef[] = [
        {
            slot: "backdrop",
            label: "VN Backdrop",
            hint: "Wide scene art (1024×512+) shown at the dungeon entrance (Seal 1). With no upload, players see the built-in entrance art. The pre-rebuild entrance uploads are retired and never shown.",
            promptTemplate: (biome, dungeonName) => `${biome} hidden dungeon entrance, sealed stone stairwell descending into ancient ruins, atmospheric ${biome} environment, ${dungeonName}, fantasy RPG landscape art, dramatic lighting`,
        },
        {
            slot: "warden",
            label: "Dungeon Warden",
            hint: "Boss portrait (~512×512) shown on the right-hand VN side and in the Seal 1 arena battle.",
            promptTemplate: (biome, dungeonName) => `Dungeon Warden of the ${dungeonName}, masked ${biome}-themed shinobi boss portrait, ominous mask and robes, glowing eyes, ${biome} chakra aura, dark fantasy RPG character art, square portrait`,
        },
        {
            slot: "tilescene",
            label: "Tile Game Scene",
            hint: "Banner image shown above the Seal 2 card-game board.",
            promptTemplate: (biome, dungeonName) => `Ancient ${biome} shrine altar covered with glowing stone tiles and ${biome}-themed cards floating above it, ${dungeonName} tile-shrine ritual scene, mystical fantasy RPG art, wide banner composition`,
        },
        {
            slot: "pet",
            label: "Rare Beast (Seal 3)",
            hint: "Pet portrait (~512×512) shown for the final pet battle. Stats stay rolled from the random rare pool.",
            promptTemplate: (biome, dungeonName) => `Rare chakra-beast spirit boss of the ${dungeonName}, ${biome}-themed mystical creature, glowing eyes, ${biome} aura, fantasy RPG pet boss portrait, square composition`,
        },
    ];

    async function uploadDungeonImage(eventId: string, slot: string, file: File) {
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const img = await compressDataUrl(reader.result as string, 1024, 0.85);
                const key = `event:${eventId}:${slot}`;
                // Optimistic update so the preview refreshes
                // before the KV round-trip lands. Mirrors the
                // Hollow Gate atlas pattern.
                setSharedImages(prev => ({ ...prev, [key]: img }));
                const ok = await publishSharedImage(key, img);
                if (!ok) alert(`Failed to publish ${key} to shared KV. The local preview will revert on refresh.`);
            } catch (err) {
                alert(`Upload failed: ${err instanceof Error ? err.message : "unknown"}`);
            }
        };
        reader.readAsDataURL(file);
    }

    async function clearDungeonImage(eventId: string, slot: string) {
        const key = `event:${eventId}:${slot}`;
        if (!(await gameConfirm(`Remove the ${slot} image for this dungeon?`, { danger: true, confirmLabel: "Remove" }))) return;
        setSharedImages(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
        try {
            await fetch(`/api/images?id=${encodeURIComponent(key)}`, { method: 'DELETE' });
            try { sessionStorage.removeItem(`imgcat:event`); } catch { /* ignore */ }
        } catch (err) {
            console.warn(`[relicDungeons] DELETE ${key} failed`, err);
        }
    }

    // ── Single-slot AI generation (used by per-slot 🎨 button + the
    // bulk generators below). Calls /api/generate-image with a
    // biome-aware prompt, compresses, then publishes under the
    // shared-image key so all clients pick it up immediately.
    async function generateDungeonSlotImage(eventId: string, slot: SlotDef, dungeonName: string, biome: string) {
        const prompt = slot.promptTemplate(biome, dungeonName);
        const response = await fetch("/api/generate-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, label: `Relic Dungeon ${slot.label}` }),
        });
        const rawText = await response.text();
        let data: Record<string, unknown>;
        try { data = rawText ? JSON.parse(rawText) : {}; } catch { throw new Error(`Server error ${response.status}`); }
        if (!response.ok) throw new Error((data.error as string) || `Status ${response.status}`);
        if (!data.image) throw new Error("No image returned.");
        const img = await compressDataUrl(data.image as string, 1024, 0.85);
        const key = `event:${eventId}:${slot.slot}`;
        setSharedImages(prev => ({ ...prev, [key]: img }));
        const ok = await publishSharedImage(key, img);
        if (!ok) throw new Error(`Saved locally but KV publish failed for ${key}`);
    }

    async function generateAllForDungeon(dungeon: typeof craftDungeonEvents[number], overwriteFilled: boolean) {
        setDungeonImgBulkRunning(true);
        setDungeonImgBulkProgress({ current: 0, total: slotTypes.length, label: `${dungeon.name} — starting…` });
        const errors: string[] = [];
        for (let i = 0; i < slotTypes.length; i++) {
            const slot = slotTypes[i];
            const key = `event:${dungeon.id}:${slot.slot}`;
            // Skip filled slots in "missing only" mode so admins
            // don't waste credits regenerating slots they already
            // hand-uploaded.
            if (!overwriteFilled && sharedImages[key]) {
                setDungeonImgBulkProgress({ current: i + 1, total: slotTypes.length, label: `${dungeon.name} — ${slot.label} (skip, already filled)` });
                continue;
            }
            setDungeonImgBulkProgress({ current: i + 1, total: slotTypes.length, label: `${dungeon.name} — ${slot.label}` });
            try {
                await generateDungeonSlotImage(dungeon.id, slot, dungeon.name, dungeon.biome);
            } catch (err) {
                errors.push(`${dungeon.name} · ${slot.label}: ${err instanceof Error ? err.message : "failed"}`);
            }
        }
        setDungeonImgBulkProgress(null);
        setDungeonImgBulkRunning(false);
        if (errors.length > 0) alert(`Generation finished with ${errors.length} error(s):\n${errors.join("\n")}`);
    }

    async function generateAllForEveryDungeon(overwriteFilled: boolean) {
        setDungeonImgBulkRunning(true);
        const total = craftDungeonEvents.length * slotTypes.length;
        let done = 0;
        const errors: string[] = [];
        for (const dungeon of craftDungeonEvents) {
            for (const slot of slotTypes) {
                const key = `event:${dungeon.id}:${slot.slot}`;
                done += 1;
                if (!overwriteFilled && sharedImages[key]) {
                    setDungeonImgBulkProgress({ current: done, total, label: `${dungeon.name} — ${slot.label} (skip)` });
                    continue;
                }
                setDungeonImgBulkProgress({ current: done, total, label: `${dungeon.name} — ${slot.label}` });
                try {
                    await generateDungeonSlotImage(dungeon.id, slot, dungeon.name, dungeon.biome);
                } catch (err) {
                    errors.push(`${dungeon.name} · ${slot.label}: ${err instanceof Error ? err.message : "failed"}`);
                }
            }
        }
        setDungeonImgBulkProgress(null);
        setDungeonImgBulkRunning(false);
        if (errors.length > 0) alert(`Bulk generation finished with ${errors.length} error(s):\n${errors.join("\n")}`);
        else alert(`Bulk generation complete. All ${total} slot${total === 1 ? "" : "s"} processed.`);
    }

    return (
        <div className="admin-subpanel">
            <div className="admin-panel-heading">
                <h3>🗝 Relic Dungeons — Image Slots</h3>
                <p className="hint">
                    Each of the 5 biome relic dungeons has 4 image slots: VN backdrop, Dungeon Warden boss
                    portrait, Tile Game scene banner, and the Seal 3 Rare Beast portrait. Slots are stored
                    in the shared KV under <code>event:&lt;dungeon-id&gt;:&lt;slot&gt;</code> keys and overlay the
                    static event defaults at runtime. Images are downscaled to 1024px max edge. <strong>Every
                    upload and AI generation auto-saves to the shared KV</strong> — the green ✓ badge confirms
                    each slot is persisted.
                </p>
            </div>

            {/* ── Bulk generator controls ───────────────────────
                "Missing only" by default so admins don't blow
                credits on slots they've hand-curated. Hold the
                modifier-style "Regenerate all" button to overwrite
                existing images. */}
            <section className="summary-box" style={{ marginBottom: 16 }}>
                <h4 style={{ margin: "0 0 6px" }}>🎨 Batch AI Image Generation</h4>
                <p className="hint" style={{ marginTop: 0, fontSize: "0.8rem" }}>
                    Uses /api/generate-image with biome-themed prompts. Each generated image is auto-saved to
                    the shared KV under the same key the runtime reads. Total slots across all 5 dungeons: <strong>{craftDungeonEvents.length * slotTypes.length}</strong>.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    <button
                        style={{ background: "linear-gradient(135deg, #4f46e5, #818cf8)", color: "#fff", fontWeight: 600 }}
                        disabled={dungeonImgBulkRunning}
                        onClick={() => void generateAllForEveryDungeon(false)}
                    >
                        🎨 Generate Missing (all 5 dungeons)
                    </button>
                    <button
                        className="danger-button"
                        disabled={dungeonImgBulkRunning}
                        onClick={async () => {
                            if (!(await gameConfirm("Regenerate EVERY slot for all 5 dungeons? This overwrites images you've already saved.", { danger: true, confirmLabel: "Regenerate" }))) return;
                            void generateAllForEveryDungeon(true);
                        }}
                    >
                        ♻ Regenerate ALL (overwrite)
                    </button>
                </div>
                {dungeonImgBulkProgress && (
                    <p style={{ marginTop: 10, color: "#facc15", fontSize: "0.85rem" }}>
                        ⏳ {dungeonImgBulkProgress.current}/{dungeonImgBulkProgress.total} · {dungeonImgBulkProgress.label}
                    </p>
                )}
            </section>

            <div style={{ display: "grid", gap: 20 }}>
                {craftDungeonEvents.map(dungeon => {
                    const filled = slotTypes.filter(s => sharedImages[`event:${dungeon.id}:${s.slot}`]).length;
                    return (
                    <section key={dungeon.id} className="summary-box">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                            <div>
                                <h4 style={{ marginTop: 0, marginBottom: 4 }}>{dungeon.icon} {dungeon.name}</h4>
                                <p className="hint" style={{ marginTop: 0 }}>
                                    Biome: <strong>{dungeon.biome}</strong> · Level Req: <strong>{dungeon.levelReq}</strong> · Event ID: <code>{dungeon.id}</code> · Slots filled: <strong>{filled}/{slotTypes.length}</strong>
                                </p>
                            </div>
                            <div style={adminCompactRow}>
                                <button
                                    style={{ background: "linear-gradient(135deg, #4f46e5, #818cf8)", color: "#fff", fontWeight: 600, fontSize: "0.78rem", padding: "4px 10px" }}
                                    disabled={dungeonImgBulkRunning}
                                    onClick={() => void generateAllForDungeon(dungeon, false)}
                                >
                                    🎨 Generate Missing
                                </button>
                                <button
                                    className="danger-button"
                                    style={{ fontSize: "0.78rem", padding: "4px 10px" }}
                                    disabled={dungeonImgBulkRunning}
                                    onClick={async () => {
                                        if (!(await gameConfirm(`Regenerate all 4 images for ${dungeon.name}? This overwrites existing images.`, { danger: true, confirmLabel: "Regenerate" }))) return;
                                        void generateAllForDungeon(dungeon, true);
                                    }}
                                >
                                    ♻ Regenerate All
                                </button>
                            </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
                            {slotTypes.map(slotDef => {
                                const key = `event:${dungeon.id}:${slotDef.slot}`;
                                const currentImage = sharedImages[key];
                                return (
                                    <div key={key} className="summary-box" style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 10, alignItems: "center" }}>
                                        <div style={{ width: 90, height: 90, background: "rgba(0,0,0,0.45)", border: "1px dashed rgba(250,204,21,0.4)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative" }}>
                                            {currentImage
                                                ? <img src={currentImage} alt={slotDef.label} style={adminCoverImage} />
                                                : <span style={{ color: "#facc15", fontSize: 11, textAlign: "center", padding: 4 }}>No image</span>}
                                            {currentImage && (
                                                <span
                                                    title="Saved to shared KV"
                                                    style={{ position: "absolute", top: 2, right: 2, background: "rgba(20,83,45,0.92)", color: "#86efac", fontSize: 10, padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}
                                                >
                                                    ✓ Saved
                                                </span>
                                            )}
                                        </div>
                                        <div>
                                            <strong style={{ fontSize: "0.9rem" }}>{slotDef.label}</strong>
                                            <p className="hint" style={{ margin: "2px 0 6px", fontSize: "0.72rem" }}>{slotDef.hint}</p>
                                            <div style={adminCompactRow}>
                                                <label style={{ cursor: dungeonImgBulkRunning ? "not-allowed" : "pointer", padding: "4px 10px", background: "linear-gradient(135deg, #ca8a04, #facc15)", borderRadius: 4, color: "#1c1917", fontSize: "0.78rem", fontWeight: 600, opacity: dungeonImgBulkRunning ? 0.5 : 1 }}>
                                                    {currentImage ? "Replace" : "Upload"}
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        style={{ display: "none" }}
                                                        disabled={dungeonImgBulkRunning}
                                                        onChange={(e) => {
                                                            const file = e.target.files?.[0];
                                                            if (file) void uploadDungeonImage(dungeon.id, slotDef.slot, file);
                                                        }}
                                                    />
                                                </label>
                                                <button
                                                    style={{ padding: "4px 10px", fontSize: "0.78rem", background: "linear-gradient(135deg, #4f46e5, #818cf8)", color: "#fff" }}
                                                    disabled={dungeonImgBulkRunning}
                                                    onClick={async () => {
                                                        setDungeonImgBulkRunning(true);
                                                        setDungeonImgBulkProgress({ current: 1, total: 1, label: `${dungeon.name} — ${slotDef.label}` });
                                                        try {
                                                            await generateDungeonSlotImage(dungeon.id, slotDef, dungeon.name, dungeon.biome);
                                                        } catch (err) {
                                                            alert(`Generation failed: ${err instanceof Error ? err.message : "unknown"}`);
                                                        } finally {
                                                            setDungeonImgBulkProgress(null);
                                                            setDungeonImgBulkRunning(false);
                                                        }
                                                    }}
                                                >
                                                    🎨 AI
                                                </button>
                                                {currentImage && (
                                                    <button
                                                        className="danger-button"
                                                        style={{ padding: "4px 10px", fontSize: "0.78rem" }}
                                                        disabled={dungeonImgBulkRunning}
                                                        onClick={() => void clearDungeonImage(dungeon.id, slotDef.slot)}
                                                    >
                                                        Remove
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                    );
                })}
            </div>
        </div>
    );
}
