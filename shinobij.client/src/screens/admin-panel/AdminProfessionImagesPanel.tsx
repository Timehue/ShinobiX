import { compressDataUrl, publishSharedImage } from '../../lib/shared-images';

/** Shared-image editor for the existing profession picker keys. */
export function AdminProfessionImagesPanel({ sharedImages }: { sharedImages: Record<string, string> }) {
    // Profession picker image slots. Each row is a key the picker
    // reads from sharedImages; upload a file to publish to the
    // shared KV. Picker falls back to color gradients when missing.
    const slots: Array<{ key: string; label: string; hint: string }> = [
        { key: "profession:backdrop", label: "Village backdrop (intro + choose pages)", hint: "Wide landscape — village square or elder's hall. Used as the dim backdrop behind the picker." },
        { key: "profession:elder-portrait", label: "Elder portrait (intro page)", hint: "Square portrait of the village elder speaking to the player. ~512x512." },
        { key: "profession:portrait-petTamer", label: "Pet Tamer choice card", hint: "Square art — shinobi with a beast companion. ~512x512." },
        { key: "profession:portrait-healer", label: "Healer choice card", hint: "Square art — medical-nin tending to a patient. ~512x512." },
        { key: "profession:portrait-vanguard", label: "Vanguard choice card", hint: "Square art — shinobi leading a charge. ~512x512." },
    ];

    async function uploadProfessionImage(key: string, file: File) {
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const img = await compressDataUrl(reader.result as string, 512, 0.82);
                const ok = await publishSharedImage(key, img);
                if (!ok) alert(`Failed to publish ${key} to shared KV. Try again.`);
            } catch (err) {
                alert(`Upload failed: ${err instanceof Error ? err.message : "unknown"}`);
            }
        };
        reader.readAsDataURL(file);
    }

    return (
        <div className="admin-subpanel">
            <div className="admin-panel-heading">
                <h3>🧑‍⚕️ Profession Picker — Image Slots</h3>
                <p className="hint">
                    Upload images shown in the Level-13 profession picker (visual novel + choice cards).
                    Each slot is a shared image key; the picker falls back to a colored gradient when no
                    image is set. Recommended size: square 512×512 for portraits, wide 1024×512 for the backdrop.
                </p>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
                {slots.map(slot => {
                    const currentImage = sharedImages[slot.key];
                    return (
                        <div key={slot.key} className="summary-box" style={{ display: "grid", gridTemplateColumns: "120px 1fr auto", gap: 12, alignItems: "center" }}>
                            <div style={{ width: 120, height: 120, background: "rgba(0,0,0,0.45)", border: "1px dashed rgba(168,85,247,0.4)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                                {currentImage
                                    ? <img src={currentImage} alt={slot.label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                    : <span style={{ color: "#a78bfa", fontSize: 11, textAlign: "center", padding: 6 }}>No image yet</span>}
                            </div>
                            <div>
                                <strong>{slot.label}</strong>
                                <p className="hint" style={{ margin: "4px 0 0", fontSize: "0.78rem" }}>{slot.hint}</p>
                                <code style={{ fontSize: "0.72rem", color: "#94a3b8" }}>{slot.key}</code>
                            </div>
                            <label style={{ cursor: "pointer", padding: "6px 12px", background: "linear-gradient(135deg, #7c3aed, #a855f7)", borderRadius: 4, color: "#faf5ff", fontSize: "0.85rem" }}>
                                {currentImage ? "Replace" : "Upload"}
                                <input
                                    type="file"
                                    accept="image/*"
                                    style={{ display: "none" }}
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) void uploadProfessionImage(slot.key, file);
                                    }}
                                />
                            </label>
                        </div>
                    );
                })}
            </div>
            <p className="hint" style={{ marginTop: 12 }}>
                Tip: portraits look best with the character centered and a transparent or color-matched background.
                The picker uses the profession's accent color (cyan / orange / lime) on top of the uploaded image.
            </p>
        </div>
    );
}
