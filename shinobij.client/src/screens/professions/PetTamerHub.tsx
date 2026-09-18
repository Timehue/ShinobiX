import { useState } from "react";
import { petTamerPveMultiplier, petTamerTrainingSpeedPct, petTamerExpeditionMult } from "../../lib/profession-bonuses";
import { petCardImage } from "../../lib/pet-battle-anim";
import { petDisplayName } from "../../lib/pet";
import { petVisualVariantClass } from "../../lib/pet-visual-variant";
import petTamerBg from "../../assets/professions/pettamer.webp";
import yardArt from "../../assets/facilities/pet-yard.webp";
import arenaArt from "../../assets/coliseum/pet-arena-command-v2.webp";
import { ProfessionHero } from "../../components/ProfessionHero";
import { MasteryPanel } from "../../components/MasteryPanel";
import { ProfessionRankBar } from "../ProfessionRankBar";
import { DailyProfessionMissions } from "../DailyProfessionMissions";
import { ProfessionDestination, ProfessionMetric, ProfessionSectionHeading } from "./ProfessionHubUI";
import type { Character, Screen } from "../../App";
import type { Pet } from "../../types/pet";
import type { VersionedCharacterCommit } from "../../types/character";

function CompanionPortrait({ pet, sharedImages }: { pet: Pet; sharedImages: Record<string, string> }) {
    const image = petCardImage(pet, sharedImages);
    const [failedSource, setFailedSource] = useState<string | null>(null);
    return <div className={`ph-companion-portrait ${petVisualVariantClass(pet)}`}>
        {image && image !== failedSource ? <img src={image} alt="" loading="lazy" onError={() => setFailedSource(image)} /> : <span className="ph-portrait-monogram" aria-hidden="true">{petDisplayName(pet).slice(0, 1)}</span>}
        <span className="ph-companion-level">Lv. {pet.level}</span>
    </div>;
}

export function PetTamerHub({ character, onVersionedCharacter, setScreen, onBack, sharedImages }: {
    character: Character; onVersionedCharacter: VersionedCharacterCommit; setScreen: (s: Screen) => void; onBack: () => void; sharedImages: Record<string, string>;
}) {
    const pveBonusPct = Math.round((petTamerPveMultiplier(character) - 1) * 1000) / 10;
    const trainSpeedPct = petTamerTrainingSpeedPct(character);
    const expeditionPct = Math.round((petTamerExpeditionMult(character) - 1) * 1000) / 10;
    const pets = character.pets ?? [];

    return <div className="profession-hub profession-hub-pet-tamer ph-hub">
        <ProfessionHero image={petTamerBg} title="Pet Tamer" tagline="Walk with beasts." chapter="The wilds / Companion sanctuary" description="A bond forged in trust. A strength shared in battle." village={character.village} onBack={onBack} />
        <div className="ph-body">
            <ProfessionRankBar character={character} headquarters />
            <section className="ph-panel" aria-label="Active profession bonuses">
                <ProfessionSectionHeading eyebrow="Strength in kinship" title="Your bond, amplified" detail="Active bonuses" />
                <dl className="ph-metrics"><ProfessionMetric label="PvE pet damage" value={`+${pveBonusPct}%`} detail="Fight as one" /><ProfessionMetric label="Training speed" value={`+${trainSpeedPct}%`} detail="Grow together" /><ProfessionMetric label="Expedition rewards" value={`+${expeditionPct}%`} detail="Bring more home" /></dl>
                <div className="ph-daily-perk"><strong>2×</strong><p><b>The first journey of the day</b><span>Your first collected expedition grants double Tamer XP, pet XP, and ryo, plus a large material-find boost.</span></p></div>
            </section>
            <section aria-label="Pet Tamer destinations">
                <ProfessionSectionHeading eyebrow="Beyond the sanctuary" title="Answer the wild" />
                <div className="ph-destinations"><ProfessionDestination image={yardArt} title="Pet Yard" description="Care, training & expeditions" onClick={() => setScreen("pets")} featured /><ProfessionDestination image={arenaArt} title="Pet Arena" description="Put your bond to the test" onClick={() => setScreen("petArena")} /></div>
            </section>
            <section className="ph-panel" aria-label="Your companions">
                <ProfessionSectionHeading eyebrow="Your companions" title="The company you keep" detail={`${pets.length} bonded`} />
                {pets.length === 0 ? <div className="ph-empty"><strong>Every bond begins with a first encounter.</strong><p>Visit the Pet Yard to find a companion and begin your journey together.</p><button type="button" onClick={() => setScreen("pets")}>Find a companion <span aria-hidden="true">↗</span></button></div> : <><div className="ph-companions">{pets.slice(0, 8).map((pet, i) => <article className={`ph-companion rarity-${pet.rarity}`} key={pet.id ?? `${pet.name}-${i}`}><CompanionPortrait pet={pet} sharedImages={sharedImages} /><div className="ph-companion-copy"><span>{pet.rarity} · {pet.element}</span><h4 title={petDisplayName(pet)}>{petDisplayName(pet)}</h4></div></article>)}</div>{pets.length > 8 && <button type="button" className="ph-roster-link" onClick={() => setScreen("pets")}>View all {pets.length} companions <span aria-hidden="true">↗</span></button>}</>}
            </section>
            <DailyProfessionMissions character={character} headquarters />
            <MasteryPanel character={character} onVersionedCharacter={onVersionedCharacter} headquarters />
        </div>
    </div>;
}
