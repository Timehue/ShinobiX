/*
 * Healer profession hub — the screen the right-menu "✚ Healer" button opens
 * once a player has chosen the Healer profession. Visually a hospital ward: it
 * lists injured / knocked-out villagers and (for Healers) lets you heal them.
 *
 * Reuses the same server-authoritative heal flow as the Village Hospital via
 * the shared <HealerInjuredList> component, so there is one heal code path. The
 * actual who-can-heal-whom gating lives server-side in api/player/heal.ts: any
 * Healer can heal admitted same-village allies; Rank 10 unlocks healing injured
 * villagers anywhere in the world.
 */
import healerBg from "../../assets/professions/healer.webp";
import { BackToVillageButton } from "../../components/BackToVillageButton";
import { ProfessionHero } from "../../components/ProfessionHero";
import { HealerInjuredList } from "../../components/HealerInjuredList";
import { MasteryPanel } from "../../components/MasteryPanel";
import { ProfessionRankBar } from "../ProfessionRankBar";
import { DailyProfessionMissions } from "../DailyProfessionMissions";
import type { Character, PlayerRecord, Screen } from "../../App";

export function HealerHub({
    character,
    updateCharacter,
    setScreen,
    playerRoster,
}: {
    character: Character;
    updateCharacter: (character: Character) => void;
    setScreen: (s: Screen) => void;
    playerRoster: PlayerRecord[];
}) {
    const healerRank = character.professionRank ?? 1;

    return (
        <div className="card">
            <BackToVillageButton onClick={() => setScreen("village")} />
            <ProfessionHero image={healerBg} icon="✚" title="Healer" tagline="Mend what war breaks." accent="#22d3ee" />

            <ProfessionRankBar character={character} />

            <div className="summary-box" style={{ background: "linear-gradient(180deg,rgba(34,211,238,0.12),rgba(8,10,22,0.4))", border: "1px solid rgba(34,211,238,0.45)", margin: "1rem 0" }}>
                <p className="hint" style={{ margin: 0 }}>
                    Heal wounded and knocked-out allies in <strong>{character.village}</strong>. Each heal grants profession
                    XP equal to the share of HP you restore. Allies fresh from a fight grant a <strong style={{ color: "#22d3ee" }}>+50% Raid-Assist</strong> bonus.
                    {healerRank >= 10
                        ? " At Rank 10 you can heal injured villagers anywhere in the world — see the list below."
                        : ` Reach Rank 10 to heal injured villagers anywhere in the world (you're Rank ${healerRank}).`}
                </p>
            </div>

            <button
                onClick={() => setScreen("hospital")}
                style={{ background: "linear-gradient(#0e7490,#155e75)", borderColor: "#22d3ee", marginBottom: "0.5rem" }}
            >
                🏥 Go to the Village Hospital
            </button>

            <HealerInjuredList character={character} updateCharacter={updateCharacter} playerRoster={playerRoster} />

            <div style={{ marginTop: "1.5rem" }}>
                <DailyProfessionMissions character={character} />
                <MasteryPanel character={character} updateCharacter={updateCharacter} />
            </div>
        </div>
    );
}
