import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Character } from "../types/character";
import type { Pet } from "../types/pet";
import type { Screen } from "../types/core";
import { academyCeremony, academyVowDefinition } from "../lib/academy-narrative";
import { buildAcademyHandoff, type AcademyHandoffAction } from "../lib/academy-handoff";
import { petPoseImage } from "../lib/pet-battle-anim";
import { villagePageImage } from "../lib/village-page-image";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";
import academyDummyArt from "../assets/academy/academy-training-dummy.webp";
import hollowTraceArt from "../assets/academy/onboarding/hollow-trace.webp";
import fieldSealArt from "../assets/academy/onboarding/shiranui-field-seal.webp";
import "./academy-story-moments.css";

type SharedProps = {
    character: Character;
    guidePet: Pet | null;
    sharedImages: Record<string, string>;
    updateCharacter: (character: Character) => void;
    onSkip: () => void;
};
type Beat = { kicker: string; title: string; body: string; speaker?: string };

function StoryMoment({ art, alt, variant, beats, doneLabel, onDone, onSkip, pet }: {
    art: string; alt: string; variant: "omen" | "trace"; beats: Beat[];
    doneLabel: string; onDone: () => void; onSkip: () => void; pet?: ReactNode;
}) {
    const [index, setIndex] = useState(0);
    const beat = beats[index];
    const last = index === beats.length - 1;
    return createPortal(
        <section className={`asm-root is-${variant}`} role="dialog" aria-modal="true" aria-labelledby="asm-title">
            <img className="asm-bg" src={art} alt={alt} />
            <div className="asm-grade" />
            {pet}
            <article className="asm-card">
                <div className="asm-dots" aria-label={`Story beat ${index + 1} of ${beats.length}`}>
                    {beats.map((_, dot) => <i key={dot} className={dot <= index ? "on" : ""} />)}
                </div>
                <p className="asm-kicker">{beat.kicker}</p>
                <h2 id="asm-title">{beat.title}</h2>
                {beat.speaker && <strong className="asm-speaker">{beat.speaker}</strong>}
                <p className="asm-body">{beat.body}</p>
                <div className="asm-actions">
                    <button type="button" className="asm-primary" autoFocus onClick={() => last ? onDone() : setIndex(index + 1)}>{last ? doneLabel : "Continue"}</button>
                    <button type="button" className="asm-skip" onClick={onSkip}>Skip Academy</button>
                </div>
            </article>
        </section>, document.body,
    );
}

function PetWitness({ pet, images }: { pet: Pet | null; images: Record<string, string> }) {
    return pet ? <img className="asm-pet" src={petPoseImage(pet, images)} alt={`${pet.name}, your companion`} /> : null;
}

export function AcademySparOmen(props: SharedProps) {
    useBodyScrollLock(true);
    const vow = academyVowDefinition(props.character.academyVow);
    const petName = props.guidePet?.name ?? "Your companion";
    return <StoryMoment art={academyDummyArt} alt="The Academy training dummy after the spar" variant="omen" beats={[
        { kicker: "Academy Spar · Aftermath", title: "The dummy falls. Its seals do not.", body: "For one breath, every training mark burns magenta and turns toward you. The instructors keep cheering. None of them seem to see it." },
        { kicker: "A Voice Without Breath", title: "Your answer comes back in the wrong voice.", speaker: petName, body: `That sounded like you, but it wasn't you. It repeated your exact words: “${vow.sparCallback}” You heard it too, right? There's foxfire on your sleeve. Let's get you patched up, then find out where it leads.` },
    ]} doneLabel="Keep the vow" onDone={() => props.updateCharacter({ ...props.character, academyIncidentSeen: true })} onSkip={props.onSkip} pet={<PetWitness pet={props.guidePet} images={props.sharedImages} />} />;
}

export function AcademyFieldTrace(props: SharedProps & { currentSector: number }) {
    useBodyScrollLock(true);
    const vow = academyVowDefinition(props.character.academyVow);
    return <StoryMoment art={hollowTraceArt} alt="Blue foxfire tracks leading to a Hollow Gate scar on a forest road marker" variant="trace" beats={[
        { kicker: `First Field Assignment · Sector ${props.currentSector}`, title: "The foxfire stops at an old road marker.", body: "Blue-white tracks end beneath a cut of magenta light. Wet leaves hang above it, pulled upward against the wind." },
        { kicker: "Hollow Gate Trace", title: "The mark is measuring the road.", speaker: props.guidePet?.name ?? "Your companion", body: `The rings moved when you said, “${vow.quote}” I saw it. Remember the shape. We're taking this back together.` },
    ]} doneLabel="Return with the evidence" onDone={() => props.updateCharacter({ ...props.character, academySectorVisited: true, academyTraceSector: props.currentSector })} onSkip={props.onSkip} pet={<PetWitness pet={props.guidePet} images={props.sharedImages} />} />;
}

export function AcademyReturnCeremony(props: SharedProps & {
    setScreen: (screen: Screen) => void;
    onOpenAwakening?: () => void;
}) {
    useBodyScrollLock(true);
    const [pathsOpen, setPathsOpen] = useState(Boolean(props.character.academyFieldSeal));
    const rite = academyCeremony(props.character.village);
    const vow = academyVowDefinition(props.character.academyVow);
    const handoff = buildAcademyHandoff({ ...props.character, onboardingStep: "done" });
    const paths: AcademyHandoffAction[] = handoff ? [handoff.primary, handoff.secondary] : [
        { label: "Take an E-Rank mission", screen: "missions" as Screen, detail: "Begin a real rookie assignment." },
        { label: "Continue your story", screen: "storyHall" as Screen, detail: "Follow your village's next chapter." },
    ];
    const finish = (screen: Screen, intent?: "openAwakening") => {
        props.updateCharacter({ ...props.character, academyFieldSeal: true, onboardingStep: "done" });
        if (intent === "openAwakening" && props.onOpenAwakening) {
            props.onOpenAwakening();
            return;
        }
        props.setScreen(screen);
    };
    return createPortal(
        <section className="asm-root is-ceremony" role="dialog" aria-modal="true" aria-labelledby="ceremony-title">
            <div className="asm-village" style={{ backgroundImage: `url(${villagePageImage(props.character.village)})` }} />
            <article className="asm-ceremony">
                <div className="asm-copy">
                    <p className="asm-kicker">{rite.rite}</p>
                    <h2 id="ceremony-title">{pathsOpen ? "Your next step is yours." : "Shiranui's Field Seal"}</h2>
                    {!pathsOpen ? <>
                        <strong className="asm-speaker">{rite.witness}</strong>
                        <p className="asm-body">{rite.opening} {rite.villagePromise}</p>
                        <blockquote>“{vow.quote}”</blockquote>
                        <p className="asm-seal-line">{vow.keepsakeLine}</p>
                        <small>Permanent narrative keepsake · No combat stats · This is not a Genin promotion</small>
                        <button type="button" className="asm-primary" autoFocus onClick={() => { props.updateCharacter({ ...props.character, academyFieldSeal: true }); setPathsOpen(true); }}>Accept the Field Seal</button>
                        <button type="button" className="asm-skip" onClick={props.onSkip}>Skip Academy</button>
                    </> : <>
                        <p className="asm-body">The guided route ends here. This choice only decides where you go first; your Logbook keeps the whole road visible.</p>
                        <div className="asm-paths">{paths.map((path) => <button type="button" key={path.label} onClick={() => finish(path.screen, path.intent)}><strong>{path.label}</strong><span>{path.detail}</span></button>)}</div>
                        <button type="button" className="asm-skip" onClick={() => finish("village")}>Stay in the village for now</button>
                    </>}
                </div>
                <img className="asm-seal" src={fieldSealArt} alt="Shiranui's Field Seal" />
            </article>
        </section>, document.body,
    );
}
