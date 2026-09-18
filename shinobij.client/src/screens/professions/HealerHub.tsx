import healerBg from "../../assets/professions/healer.webp";
import hospitalArt from "../../assets/facilities/hospital.webp";
import { ProfessionHero } from "../../components/ProfessionHero";
import { HealerInjuredList } from "../../components/HealerInjuredList";
import { MasteryPanel } from "../../components/MasteryPanel";
import { ProfessionRankBar } from "../ProfessionRankBar";
import { DailyProfessionMissions } from "../DailyProfessionMissions";
import { ProfessionDestination, ProfessionMetric, ProfessionSectionHeading } from "./ProfessionHubUI";
import type { Character, PlayerRecord, Screen } from "../../App";
import type { VersionedCharacterCommit } from "../../types/character";

export function HealerHub({ character, updateCharacter, setScreen, onBack, playerRoster, onServerVersion, onVersionedCharacter }: {
    character: Character; updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>; setScreen: (s: Screen) => void; onBack: () => void; playerRoster: PlayerRecord[]; onServerVersion: (version: unknown) => boolean; onVersionedCharacter: VersionedCharacterCommit;
}) {
    const healerRank = character.professionRank ?? 1;
    return <div className="profession-hub profession-hub-healer ph-hub">
        <ProfessionHero image={healerBg} title="Healer" tagline="Mend what war breaks." chapter="The sanctuary / Healing arts" description="Be the reason your village lives to fight another day." village={character.village} onBack={onBack} />
        <div className="ph-body">
            <ProfessionRankBar character={character} headquarters />
            <section className="ph-panel" aria-label="Healer field briefing">
                <ProfessionSectionHeading eyebrow="The healing arts" title="A village in your care" detail={healerRank >= 10 ? "Worldwide care unlocked" : "Village care"} />
                <dl className="ph-metrics"><ProfessionMetric label="Chakra available" value={(character.chakra ?? 0).toLocaleString()} detail="Your healing reserve" /><ProfessionMetric label="Raid-assist XP" value="+50%" detail="Treat allies fresh from battle" /><ProfessionMetric label="Worldwide care" value={healerRank >= 10 ? "Unlocked" : "Rank 10"} detail="Reach villagers in any sector" /></dl>
                <p className="ph-note">Restore wounded and knocked-out allies in {character.village}. Each heal earns profession XP based on the share of HP restored.</p>
            </section>
            <section className="ph-ward" aria-label="Village ward">
                <ProfessionSectionHeading eyebrow="On duty" title="The village ward" />
                <ProfessionDestination image={hospitalArt} title="Village Hospital" description="Enter the ward and tend to your village" onClick={() => setScreen("hospital")} featured />
                <HealerInjuredList character={character} updateCharacter={updateCharacter} playerRoster={playerRoster} onServerVersion={onServerVersion} headquarters />
            </section>
            <DailyProfessionMissions character={character} headquarters />
            <MasteryPanel character={character} onVersionedCharacter={onVersionedCharacter} headquarters />
        </div>
    </div>;
}
