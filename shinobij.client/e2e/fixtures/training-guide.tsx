import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import { Training } from "../../src/screens/Training";
import { OnboardingCoach } from "../../src/components/OnboardingCoach";
import { baseStats } from "../../src/lib/stats";
import { STARTER_PETS } from "../../src/data/starter-pets";
import type { Character } from "../../src/types/character";
import type { ActiveTraining } from "../../src/types/combat";

const params = new URLSearchParams(location.search);
export function Fixture() {
    const [character, setCharacter] = useState({ name: "Training Apprentice", bloodline: params.get("bloodline") ?? "Ashen Eyes", specialty: "Ninjutsu",
        level: 1, stats: baseStats(), stamina: 1000, maxStamina: 1000, hp: 500, maxHp: 500, village: "Moonshadow Village",
        onboardingStep: "training", pets: [], jutsuMastery: [], equippedJutsuIds: [], equipment: {}, totalStatsTrained: 0,
    } as unknown as Character);
    const [activeTraining, setActiveTraining] = useState<ActiveTraining | null>(null);
    useEffect(() => {
        (window as unknown as { trainingFixtureCharacter: Character }).trainingFixtureCharacter = character;
    }, [character]);
    return <>
        <main data-onboarding-step={character.onboardingStep} style={{ maxWidth: 1400, margin: "20px auto", padding: "0 12px 300px" }}>
            <Training character={character} activeTraining={activeTraining} setActiveTraining={setActiveTraining}
                onVersionedCharacter={next => { setCharacter(next); return true; }} onBack={() => {}} />
        </main>
        <OnboardingCoach character={character} screen="training" activeTraining={activeTraining} currentSector={0}
            guidePet={STARTER_PETS.find(option => option.pet.name === "Ripple Seal")!.pet}
            setScreen={() => {}} updateCharacter={setCharacter} onStartSpar={() => {}} />
    </>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
