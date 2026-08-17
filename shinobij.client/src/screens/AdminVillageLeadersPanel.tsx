import { AiImagePrompt } from "../components/AiImagePrompt";
import { villageLeadership, type VillageLeadershipImages } from "../data/village-leadership";

type VillageLeadershipProfile = { kage: string; elders: string[] };
type LeadershipImageSlot = "kage" | number;

type AdminVillageLeadersPanelProps = {
    leadershipImages: VillageLeadershipImages;
    leaderSaveStatus: string;
    elderRoleLabels: readonly string[];
    onSaveAll: () => Promise<void>;
    onGenerateAllMissing: (village: string, leadership: VillageLeadershipProfile) => Promise<void>;
    onImageFile: (file: File, village: string, slot: LeadershipImageSlot) => void;
    onUpdateImage: (village: string, slot: LeadershipImageSlot, image: string) => void;
};

export function AdminVillageLeadersPanel({
    leadershipImages,
    leaderSaveStatus,
    elderRoleLabels,
    onSaveAll,
    onGenerateAllMissing,
    onImageFile,
    onUpdateImage,
}: AdminVillageLeadersPanelProps) {
    return (
        <div className="admin-subpanel">
            <div className="admin-panel-heading">
                <h3>Village Leaders</h3>
                <p>Add portraits for the Kage, War Elder, Trade Elder, and Training Elder. These appear in each village's Town Hall.</p>
            </div>
            <div className="menu" style={{ marginBottom: "0.5rem" }}>
                <button onClick={onSaveAll}>Save All Leader Images</button>
                {leaderSaveStatus && <span className="hint" style={{ color: leaderSaveStatus.includes("fail") ? "#ff7777" : "#a5d6a7" }}>{leaderSaveStatus}</span>}
            </div>
            {Object.entries(villageLeadership).map(([village, leadership]) => {
                const images = leadershipImages[village] ?? { kage: "", elders: ["", "", ""] };
                const missingCount = (!images.kage ? 1 : 0) + leadership.elders.filter((_, index) => !images.elders?.[index]).length;
                return (
                    <section className="summary-box village-leader-section" key={village}>
                        <div className="village-leader-section-header">
                            <h3>{village}</h3>
                            {missingCount > 0 && (
                                <button onClick={() => void onGenerateAllMissing(village, leadership)}>
                                    ✨ Generate {missingCount} Missing Portrait{missingCount > 1 ? "s" : ""}
                                </button>
                            )}
                        </div>
                        <div className="leader-admin-grid">
                            <div className="leader-admin-card">
                                <h4>Kage</h4>
                                <strong>{leadership.kage}</strong>
                                {images.kage ? <img src={images.kage} alt={leadership.kage} /> : <div className="leader-image-placeholder">No Image</div>}
                                <input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImageFile(file, village, "kage"); }} />
                                <div className="menu">
                                    <AiImagePrompt label="Kage Image" suggestedPrompt={`${leadership.kage}, shinobi village Kage leader portrait`} onImage={(image) => onUpdateImage(village, "kage", image)} />
                                    {images.kage && <button className="danger-button" onClick={() => onUpdateImage(village, "kage", "")}>Remove Image</button>}
                                </div>
                            </div>
                            {leadership.elders.map((elder, index) => (
                                <div className="leader-admin-card" key={elder}>
                                    <h4>{elderRoleLabels[index] ?? `Elder ${index + 1}`}</h4>
                                    <strong>{elder}</strong>
                                    {images.elders?.[index] ? <img src={images.elders[index]} alt={elder} /> : <div className="leader-image-placeholder">No Image</div>}
                                    <input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImageFile(file, village, index); }} />
                                    <div className="menu">
                                        <AiImagePrompt label="Elder Image" suggestedPrompt={`${elder}, ${elderRoleLabels[index] ?? "elder"}, shinobi NPC portrait`} onImage={(image) => onUpdateImage(village, index, image)} />
                                        {images.elders?.[index] && <button className="danger-button" onClick={() => onUpdateImage(village, index, "")}>Remove Image</button>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}
