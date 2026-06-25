/*
 * Pet Tamer profession hub — the screen the right-menu "🐾 Pet Tamer" button
 * opens once a player has chosen the Pet Tamer profession. A beast-handler's
 * den: it shows the live PvE / training / expedition bonuses the profession is
 * granting right now, lists the player's companions, and links into the Pet
 * Yard and Pet Arena where those bonuses pay off.
 *
 * Read-only over existing character fields + the exported petTamer* helpers —
 * no new endpoints, no reward writes.
 */
import petTamerBg from "../../assets/professions/pettamer.webp";
import { BackToVillageButton } from "../../components/BackToVillageButton";
import { ProfessionHero } from "../../components/ProfessionHero";
import { MasteryPanel } from "../../components/MasteryPanel";
import { ProfessionRankBar } from "../ProfessionRankBar";
import { DailyProfessionMissions } from "../DailyProfessionMissions";
import {
    type Character,
    type Screen,
    petTamerPveMultiplier,
    petTamerTrainingSpeedPct,
    petTamerExpeditionMult,
} from "../../App";

const ACCENT = "#84cc16";

export function PetTamerHub({
    character,
    updateCharacter,
    setScreen,
    onBack,
}: {
    character: Character;
    updateCharacter: (character: Character) => void;
    setScreen: (s: Screen) => void;
    onBack: () => void;
}) {
    const pveBonusPct = Math.round((petTamerPveMultiplier(character) - 1) * 1000) / 10;
    const trainSpeedPct = petTamerTrainingSpeedPct(character);
    const expeditionPct = Math.round((petTamerExpeditionMult(character) - 1) * 1000) / 10;
    const pets = character.pets ?? [];

    const stat = (label: string, value: string) => (
        <div className="summary-box" style={{ flex: "1 1 140px", textAlign: "center", border: `1px solid ${ACCENT}55` }}>
            <div style={{ fontSize: "1.3rem", fontWeight: 800, color: ACCENT }}>{value}</div>
            <div className="hint" style={{ fontSize: "0.74rem" }}>{label}</div>
        </div>
    );

    return (
        <div className="card">
            <BackToVillageButton onClick={onBack} label="← Back" />
            <ProfessionHero image={petTamerBg} icon="🐾" title="Pet Tamer" tagline="Walk with beasts." accent={ACCENT} />

            <ProfessionRankBar character={character} />

            {/* Live profession bonuses */}
            <h4 style={{ margin: "1rem 0 0.5rem" }}>Active Bonuses</h4>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: "1rem" }}>
                {stat("PvE Pet Damage", `+${pveBonusPct}%`)}
                {stat("Training Speed", `+${trainSpeedPct}%`)}
                {stat("Expedition Rewards", `+${expeditionPct}%`)}
            </div>
            <p className="hint" style={{ margin: "0 0 1rem", fontSize: "0.78rem" }}>
                Your first expedition each day grants <strong style={{ color: ACCENT }}>2× Tamer XP</strong>. Bonuses scale as you rank up.
            </p>

            {/* Companions */}
            <h4 style={{ margin: "0 0 0.5rem" }}>🐾 Your Companions ({pets.length})</h4>
            {pets.length === 0 ? (
                <p className="hint" style={{ margin: "0 0 1rem" }}>
                    You haven't befriended any beasts yet. Visit the Pet Yard to find a companion.
                </p>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: "1rem" }}>
                    {pets.slice(0, 8).map((p, i) => (
                        <div key={`${p.name}-${i}`} className="summary-box" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <strong style={{ flex: 1 }}>{p.nickname || p.name}</strong>
                            <span className="hint" style={{ fontSize: "0.78rem" }}>Lv {p.level}</span>
                            {p.element && <span style={{ fontSize: "0.74rem", color: ACCENT }}>{p.element}</span>}
                            <span className="hint" style={{ fontSize: "0.72rem", textTransform: "capitalize" }}>{p.rarity}</span>
                        </div>
                    ))}
                    {pets.length > 8 && <p className="hint" style={{ margin: 0, fontSize: "0.74rem" }}>+{pets.length - 8} more in the Pet Yard…</p>}
                </div>
            )}

            {/* Where to use the bonuses */}
            <h4 style={{ margin: "0 0 0.5rem" }}>Den</h4>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: "1.5rem" }}>
                <button onClick={() => setScreen("pets")} style={{ background: `linear-gradient(${ACCENT}cc,${ACCENT}88)`, borderColor: ACCENT, color: "#0a1a02" }}>
                    🐾 Pet Yard
                </button>
                <button onClick={() => setScreen("petArena")} style={{ borderColor: ACCENT }}>
                    🏟️ Pet Arena
                </button>
            </div>

            <DailyProfessionMissions character={character} />
            <MasteryPanel character={character} updateCharacter={updateCharacter} />
        </div>
    );
}
