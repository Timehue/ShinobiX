import { useState } from "react";
import homeArt from "../assets/pet-home/home-hero.webp";
import { PetBreedingBarn } from "../components/PetBreedingBarn";
import { PetCollectionGallery } from "../components/PetCollectionGallery";
import { PetHomeTabs, takePetHomeTabHint, type PetHomeTab } from "../components/PetHomeTabs";
import { PetSanctuary } from "../components/PetSanctuary";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import "../styles/pet-home.css";

export function Home({ character, updateCharacter, onServerVersion, setScreen, onBack, sharedImages }: {
    character: Character;
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
    onServerVersion: (version: number) => void;
    setScreen: (screen: Screen) => void;
    onBack: () => void;
    sharedImages: Record<string, string>;
}) {
    const [tab, setTab] = useState<Exclude<PetHomeTab, "yard">>(takePetHomeTabHint);
    return <main className="pet-home-screen">
        <header className="pet-home-hero" style={{ backgroundImage: `linear-gradient(90deg,rgba(3,8,18,.96),rgba(3,8,18,.24) 62%,rgba(3,8,18,.76)),url(${homeArt})` }}>
            <button className="pet-home-back" onClick={onBack}>← Village</button><div><span className="pet-home-kicker">Companion sanctuary</span><h1>Home</h1><p>Every bond, bloodline, and rare miracle under one roof.</p></div>
        </header>
        <PetHomeTabs active={tab} onHomeTab={setTab} setScreen={setScreen} />
        {tab === "collection"
            ? <PetCollectionGallery character={character} sharedImages={sharedImages} />
            : tab === "sanctuary"
                ? <PetSanctuary character={character} updateCharacter={updateCharacter} onServerVersion={onServerVersion} sharedImages={sharedImages} />
                : <PetBreedingBarn character={character} updateCharacter={updateCharacter} onServerVersion={onServerVersion} sharedImages={sharedImages} />}
    </main>;
}
