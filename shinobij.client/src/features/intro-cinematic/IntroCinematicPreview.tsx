import { useState, type CSSProperties } from "react";
import type { Character, Screen } from "../../App";
import { OnboardingCoach } from "../../components/OnboardingCoach";
import { STARTER_PETS } from "../../data/starter-pets";
import { villagePageImage } from "../../lib/village-page-image";
import { STARTER_AVATARS } from "../character-creator/characterCreatorCopy";
import { IntroCinematic } from "./IntroCinematic";
import "./intro-cinematic-preview.css";

const PREVIEW_AVATAR = STARTER_AVATARS[1].image;
const PREVIEW_PARAMS = new URLSearchParams(window.location.search);
const PREVIEW_SCENE = PREVIEW_PARAMS.get("scene");
const PREVIEW_ELEMENT = PREVIEW_PARAMS.get("pet")?.toLowerCase() ?? "wind";
const PREVIEW_PET = STARTER_PETS.find(
    ({ element }) => element.toLowerCase() === PREVIEW_ELEMENT,
)?.pet ?? STARTER_PETS[2].pet;
const TUTORIAL_STEPS = [
    "training",
    "jutsu",
    "jutsuLoadout",
    "inventory",
    "academySpar",
    "cafeteria",
    "firstMission",
    "logbook",
    "sectorReturn",
] as const;
const requestedStep = PREVIEW_PARAMS.get("step");
const PREVIEW_STEP = TUTORIAL_STEPS.find((step) => step === requestedStep) ?? "training";

const CINEMATIC_CHARACTER = {
    name: "Kaien",
    village: "Stormveil Village",
    avatarImage: PREVIEW_AVATAR,
    onboardingStep: "academyIntro",
    pets: [],
    activePetId: null,
} as unknown as Character;

const WALKTHROUGH_CHARACTER = {
    name: "Kaien",
    village: "Stormveil Village",
    avatarImage: PREVIEW_AVATAR,
    onboardingStep: PREVIEW_STEP,
    pets: [PREVIEW_PET],
    activePetId: PREVIEW_PET.id,
    hp: PREVIEW_STEP === "cafeteria" ? 62 : 100,
    maxHp: 100,
    equipment: {},
    jutsuMastery: [],
    equippedJutsuIds: [],
    unspentStats: 20,
    hospitalized: false,
} as unknown as Character;

const HANDOFF_CHARACTER = {
    ...WALKTHROUGH_CHARACTER,
    onboardingStep: "companionIntro",
} as Character;

/** Development-only preview mounted by `?preview=intro`. */
export function IntroCinematicPreview() {
    const [take, setTake] = useState(0);
    const [character, setCharacter] = useState<Character>(WALKTHROUGH_CHARACTER);
    const [screen, setScreen] = useState<Screen>("village");

    if (PREVIEW_SCENE === "handoff") {
        const backgroundStyle = {
            "--icx-preview-bg": `url(${villagePageImage(HANDOFF_CHARACTER.village)})`,
        } as CSSProperties;

        return (
            <main className="icx-walkthrough-preview is-handoff" style={backgroundStyle}>
                <header className="icx-preview-location">
                    <span>The world beyond the shrine</span>
                    <h1>{HANDOFF_CHARACTER.village}</h1>
                </header>
                <aside className="icx-preview-shinobi">
                    <img src={HANDOFF_CHARACTER.avatarImage} alt="" />
                    <span><strong>{HANDOFF_CHARACTER.name}</strong>New Shinobi</span>
                </aside>
                <IntroCinematic
                    key={take}
                    character={HANDOFF_CHARACTER}
                    onComplete={() => setTake((current) => current + 1)}
                />
            </main>
        );
    }

    if (PREVIEW_SCENE === "walkthrough") {
        const backgroundStyle = {
            "--icx-preview-bg": `url(${villagePageImage(character.village)})`,
        } as CSSProperties;

        return (
            <main className="icx-walkthrough-preview" style={backgroundStyle}>
                <header className="icx-preview-location">
                    <span>Academy Path</span>
                    <h1>{screen === "training" ? "Training Grounds" : character.village}</h1>
                </header>
                <section className="icx-preview-destination" aria-label="Tutorial destination preview">
                    <span className="icx-preview-kicker">Next destination</span>
                    <h2>{screen === "training" ? "Begin Stat Training" : "The Academy Awaits"}</h2>
                    <p>
                        {screen === "training"
                            ? "Choose a discipline and begin your first timed session."
                            : "Your chosen companion will guide every step of your first mission."}
                    </p>
                </section>
                <aside className="icx-preview-shinobi">
                    <img src={character.avatarImage} alt="" />
                    <span><strong>{character.name}</strong>New Shinobi</span>
                </aside>
                <OnboardingCoach
                    character={character}
                    screen={screen}
                    activeTraining={null}
                    currentSector={0}
                    guidePet={PREVIEW_PET}
                    setScreen={setScreen}
                    updateCharacter={setCharacter}
                    onStartSpar={() => undefined}
                />
            </main>
        );
    }

    return (
        <IntroCinematic
            key={take}
            character={CINEMATIC_CHARACTER}
            replay
            onClose={() => setTake((current) => current + 1)}
        />
    );
}
