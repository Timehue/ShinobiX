import { useEffect, useState } from "react";
import homeArt from "../assets/pet-home/home-hero.webp";
import sanctuaryArt from "../assets/pet-home/companion-sanctuary.webp";
import hatcheryArt from "../assets/pet-home/breeding-barn.webp";
import { PetBreedingBarn } from "../components/PetBreedingBarn";
import { PetCollectionGallery } from "../components/PetCollectionGallery";
import { clearPetHomeTabHint, peekPetHomeTabHint, PetHomeTabs, type PetHomeContentTab } from "../components/PetHomeTabs";
import { PetSanctuary } from "../components/PetSanctuary";
import type { Character, VersionedCharacterCommit } from "../types/character";
import type { Screen } from "../types/core";
import "../styles/pet-home.css";

const HOME_SECTION_HERO: Record<PetHomeContentTab, { kicker: string; title: string; description: string; art: string }> = {
    collection: {
        kicker: "Companion Home · Collection",
        title: "Your Companions",
        description: "Browse every bond you've forged and choose who joins your next journey.",
        art: homeArt,
    },
    sanctuary: {
        kicker: "Companion Home · Sanctuary",
        title: "A Place to Rest",
        description: "Keep cherished companions safe while you shape your carried roster.",
        art: sanctuaryArt,
    },
    breeding: {
        kicker: "Companion Home · Hatchery",
        title: "A New Generation",
        description: "Choose two companions and begin the next chapter of their bloodline.",
        art: hatcheryArt,
    },
};

export function Home({ character, updateCharacter, onVersionedCharacter, onServerVersion, setScreen, onBack, backLabel = "Village", sharedImages }: {
    character: Character;
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
    onVersionedCharacter?: VersionedCharacterCommit;
    onServerVersion: (version: number) => void;
    setScreen: (screen: Screen) => void;
    onBack: () => void;
    backLabel?: string;
    sharedImages: Record<string, string>;
}) {
    const [tab, setTab] = useState<PetHomeContentTab>(peekPetHomeTabHint);
    useEffect(() => clearPetHomeTabHint(), []);
    const activePet = character.pets.find((pet) => pet.id === character.activePetId);
    const hero = HOME_SECTION_HERO[tab];
    return <main className="pet-home-screen" data-section={tab}>
        <header className="pet-home-hero" style={{ backgroundImage: `linear-gradient(90deg,rgba(3,8,18,.96),rgba(3,8,18,.24) 62%,rgba(3,8,18,.76)),url(${hero.art})` }}>
            <button type="button" className="pet-home-back" onClick={onBack} aria-label={`Back to ${backLabel}`}>
                <span aria-hidden="true">←</span>
                <span><small>Return to</small><strong>{backLabel}</strong></span>
            </button>
            <div className="pet-home-hero-copy">
                <span className="pet-home-kicker">{hero.kicker}</span>
                <h1>{hero.title}</h1>
                <p>{hero.description}</p>
            </div>
            <aside className="pet-home-hero-ledger" aria-label="Companion Home status">
                <div><span>Owned</span><strong>{character.pets.length}</strong><small>companions</small></div>
                <div><span>Field lead</span><strong>{activePet?.nickname || activePet?.name || "Unassigned"}</strong><small>{activePet ? `Level ${activePet.level}` : "Choose in Pet Yard"}</small></div>
                <div><span>Breeding</span><strong>{character.petBreeding ? character.petBreeding.state === "egg" ? "Egg ready" : "In progress" : "Available"}</strong><small>Bloodline program</small></div>
            </aside>
        </header>
        <PetHomeTabs active={tab} onHomeTab={setTab} setScreen={setScreen} />
        {tab === "collection"
            ? <PetCollectionGallery character={character} sharedImages={sharedImages} />
            : tab === "sanctuary"
                ? <PetSanctuary character={character} updateCharacter={updateCharacter} onVersionedCharacter={onVersionedCharacter} onServerVersion={onServerVersion} sharedImages={sharedImages} />
                : <PetBreedingBarn character={character} updateCharacter={updateCharacter} onVersionedCharacter={onVersionedCharacter} onServerVersion={onServerVersion} sharedImages={sharedImages} />}
    </main>;
}
