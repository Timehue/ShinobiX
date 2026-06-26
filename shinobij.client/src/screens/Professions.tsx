/*
 * Professions screen — the single destination of the right-menu Professions
 * button. It routes by state:
 *
 *   • No profession chosen yet → <ProfessionOverview>: a description + layout of
 *     all three paths (Healer / Vanguard / Pet Tamer) so the player can read up
 *     before the Elder's choice. The actual irreversible choice still happens in
 *     the forced ProfessionPicker overlay (fires at Level 13) — this screen is
 *     the always-available reference, not a second commit path.
 *   • Profession chosen → the matching hub (HealerHub / VanguardHub /
 *     PetTamerHub), which the menu button also relabels to.
 *
 * Lazy-loaded by App.tsx; the three hubs ride in this chunk.
 */
import overviewBg from "../assets/professions/overview.webp";
import healerBg from "../assets/professions/healer.webp";
import vanguardBg from "../assets/professions/vanguard.webp";
import petTamerBg from "../assets/professions/pettamer.webp";
import { BackToVillageButton } from "../components/BackToVillageButton";
import { PROFESSION_INFO } from "../data/professions";
import { HealerHub } from "./professions/HealerHub";
import { VanguardHub } from "./professions/VanguardHub";
import { PetTamerHub } from "./professions/PetTamerHub";
import type { Character, PlayerRecord, Profession, Screen } from "../App";

// Mirrors api/profession/choose.ts PROFESSION_UNLOCK_LEVEL.
const PROFESSION_UNLOCK_LEVEL = 13;

const CARD_IMAGE: Record<Profession, string> = {
    healer: healerBg,
    vanguard: vanguardBg,
    petTamer: petTamerBg,
};

export function Professions({
    character,
    updateCharacter,
    setScreen,
    onBack,
    playerRoster,
}: {
    character: Character;
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
    setScreen: (s: Screen) => void;
    onBack: () => void;
    playerRoster: PlayerRecord[];
}) {
    // Chosen → route straight to that profession's hub.
    if (character.profession === "healer") {
        return <HealerHub character={character} updateCharacter={updateCharacter} setScreen={setScreen} onBack={onBack} playerRoster={playerRoster} />;
    }
    if (character.profession === "vanguard") {
        return <VanguardHub character={character} updateCharacter={updateCharacter} setScreen={setScreen} onBack={onBack} />;
    }
    if (character.profession === "petTamer") {
        return <PetTamerHub character={character} updateCharacter={updateCharacter} setScreen={setScreen} onBack={onBack} />;
    }

    // No profession yet → the three-path overview.
    const eligible = character.level >= PROFESSION_UNLOCK_LEVEL;

    return (
        <div className="card">
            <BackToVillageButton onClick={onBack} label="← Back" />

            <div
                style={{
                    position: "relative",
                    borderRadius: 12,
                    overflow: "hidden",
                    marginBottom: "1rem",
                    border: "1px solid rgba(168,85,247,0.4)",
                    minHeight: 170,
                    backgroundImage: `linear-gradient(180deg, rgba(8,10,22,0.25), rgba(8,10,22,0.9)), url(${overviewBg})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                }}
            >
                <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "16px 18px" }}>
                    <p className="act-label" style={{ color: "#c4b5fd", letterSpacing: 3, margin: 0 }}>CHOOSE YOUR PATH</p>
                    <h2 style={{ margin: "4px 0 0", color: "#faf5ff", textShadow: "0 2px 10px rgba(0,0,0,0.7)" }}>The Three Professions</h2>
                </div>
            </div>

            <p className="hint" style={{ marginTop: 0 }}>
                At <strong>Level {PROFESSION_UNLOCK_LEVEL}</strong>, the village elder summons you to choose a profession — a
                permanent path that shapes how you grow. Read each one below.
                {eligible
                    ? " You're ready: the elder will call on you to choose."
                    : ` You're Level ${character.level} — keep training to unlock the choice.`}
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginTop: "1rem" }}>
                {PROFESSION_INFO.map(info => (
                    <div
                        key={info.id}
                        style={{
                            background: "linear-gradient(180deg, rgba(15,18,34,0.9), rgba(8,10,22,0.95))",
                            border: `2px solid ${info.accent}`,
                            borderRadius: 12,
                            overflow: "hidden",
                            boxShadow: `0 0 20px ${info.accent}22`,
                            display: "flex",
                            flexDirection: "column",
                        }}
                    >
                        <div
                            style={{
                                height: 120,
                                backgroundImage: `linear-gradient(180deg, rgba(8,10,22,0.1), rgba(8,10,22,0.75)), url(${CARD_IMAGE[info.id]})`,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                            }}
                        />
                        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <span style={{ fontSize: 30, color: info.accent, lineHeight: 1 }}>{info.icon}</span>
                                <div>
                                    <h3 style={{ margin: 0, color: info.accent, fontSize: 20 }}>{info.name}</h3>
                                    <p style={{ margin: "2px 0 0", color: "#c4b5fd", fontStyle: "italic", fontSize: 13 }}>{info.tagline}</p>
                                </div>
                            </div>
                            <p style={{ margin: 0, color: "#cbd5e1", fontSize: "0.85rem", lineHeight: 1.5 }}>{info.summary}</p>
                            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5, fontSize: "0.82rem", color: "#e2e8f0" }}>
                                {info.perks.map(b => <li key={b}>{b}</li>)}
                            </ul>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
                                {info.rankHighlights.map(h => (
                                    <div key={h.rank} style={{ display: "flex", gap: 8, fontSize: "0.76rem" }}>
                                        <strong style={{ color: info.accent, minWidth: 56 }}>{h.rank}</strong>
                                        <span className="hint">{h.perk}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <p className="hint" style={{ marginTop: "1rem", fontSize: "0.78rem", opacity: 0.75 }}>
                Your choice is permanent. Once you choose, this menu opens your profession's hub.
            </p>
        </div>
    );
}
