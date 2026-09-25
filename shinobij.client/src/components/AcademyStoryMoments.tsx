import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Character } from "../types/character";
import type { Pet } from "../types/pet";
import type { Screen } from "../types/core";
import { academyCeremony, academyVowDefinition } from "../lib/academy-narrative";
import type { AcademyNarrativeAction } from "../lib/academy-narrative-api";
import type { FirstContractRoute } from '../../../shared/first-contract';
import { FIRST_CONTRACT_COPY } from '../lib/first-contract';
import { openFirstContractActivity } from '../lib/first-contract-navigation';
import { buildAcademyHandoff } from '../lib/academy-handoff';
import { FirstContractRoutes } from './FirstContractRoutes';
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
    commitMilestone: (action: AcademyNarrativeAction, sector?: number, route?: FirstContractRoute) => Promise<void>;
    onSkip: () => void;
};
type Beat = { kicker: string; title: string; body: string; speaker?: string };

function StoryMoment({ art, alt, variant, beats, doneLabel, onDone, onSkip, pet }: {
    art: string; alt: string; variant: "omen" | "trace"; beats: Beat[];
    doneLabel: string; onDone: () => Promise<void>; onSkip: () => void; pet?: ReactNode;
}) {
    const [index, setIndex] = useState(0);
    const [saving, setSaving] = useState(false);
    const beat = beats[index];
    const last = index === beats.length - 1;
    const advance = async () => {
        if (!last) { setIndex((current) => current + 1); return; }
        if (saving) return;
        setSaving(true);
        try { await onDone(); }
        catch (error) { alert(error instanceof Error ? error.message : "The Academy milestone could not be saved."); }
        finally { setSaving(false); }
    };
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
                    <button type="button" className="asm-primary" autoFocus disabled={saving} onClick={() => { void advance(); }}>{saving ? "Saving…" : last ? doneLabel : "Continue"}</button>
                    <button type="button" className="asm-skip" onClick={onSkip}>Skip Academy</button>
                </div>
            </article>
        </section>, document.body,
    );
}

function PetWitness({ pet, images }: { pet: Pet | null; images: Record<string, string> }) {
    return pet ? <img className="asm-pet" src={petPoseImage(pet, images)} alt={`${pet.name}, your companion`} /> : null;
}

async function persistMilestone(props: SharedProps, action: AcademyNarrativeAction, sector?: number) {
    await props.commitMilestone(action, sector);
}

export function AcademySparOmen(props: SharedProps) {
    useBodyScrollLock(true);
    const vow = academyVowDefinition(props.character.academyVow);
    const petName = props.guidePet?.name ?? "Your companion";
    return <StoryMoment art={academyDummyArt} alt="The Academy training dummy after the spar" variant="omen" beats={[
        { kicker: "Academy Spar · Aftermath", title: "The dummy falls. Its seals do not.", body: "For one breath, every training mark burns magenta and turns toward you. The instructors keep cheering. None of them seem to see it." },
        { kicker: "A Voice Without Breath", title: "Your answer comes back in the wrong voice.", speaker: petName, body: `That sounded like you, but it wasn't you. It repeated your exact words: “${vow.sparCallback}” You heard it too, right? There's foxfire on your sleeve. Let's get you patched up, then find out where it leads.` },
    ]} doneLabel="Keep the vow" onDone={() => persistMilestone(props, "incident")} onSkip={props.onSkip} pet={<PetWitness pet={props.guidePet} images={props.sharedImages} />} />;
}

export function AcademyFieldTrace(props: SharedProps & { currentSector: number }) {
    useBodyScrollLock(true);
    const vow = academyVowDefinition(props.character.academyVow);
    return <StoryMoment art={hollowTraceArt} alt="Blue foxfire tracks leading to a Hollow Gate scar on a weathered road marker" variant="trace" beats={[
        { kicker: `First Field Assignment · Sector ${props.currentSector}`, title: "The foxfire stops at an old road marker.", body: "Blue-white tracks end beneath a cut of magenta light. A frayed route ribbon hangs above it, pulled upward against the wind." },
        { kicker: "Hollow Gate Trace", title: "The mark is measuring the road.", speaker: props.guidePet?.name ?? "Your companion", body: `The rings moved when you said, “${vow.quote}” I saw it. Remember the shape. We're taking this back together.` },
    ]} doneLabel="Return with the evidence" onDone={() => persistMilestone(props, "trace", props.currentSector)} onSkip={props.onSkip} pet={<PetWitness pet={props.guidePet} images={props.sharedImages} />} />;
}

export function AcademyReturnCeremony(props: SharedProps & {
    setScreen: (screen: Screen) => void;
    onOpenAwakening?: () => void;
}) {
    useBodyScrollLock(true);
    const [pathsOpen, setPathsOpen] = useState(Boolean(props.character.academyFieldSeal));
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');
    const saveLock = useRef(false);
    const ceremonyRef = useRef<HTMLElement>(null);
    useEffect(() => { if (pathsOpen) ceremonyRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }, [pathsOpen]);
    const rite = academyCeremony(props.character.village);
    const vow = academyVowDefinition(props.character.academyVow);
    const handoff = buildAcademyHandoff({ ...props.character, onboardingStep: "done" });
    const saveAction = async (action: "seal" | "complete", route?: FirstContractRoute) => {
        if (saveLock.current) return false;
        saveLock.current = true;
        setSaveError('');
        setSaving(true);
        try { await props.commitMilestone(action, undefined, route); return true; }
        catch (error) { setSaveError(error instanceof Error ? error.message : "The Academy milestone could not be saved. Try again."); return false; }
        finally { saveLock.current = false; setSaving(false); }
    };
    const acceptSeal = async () => {
        if (await saveAction("seal")) setPathsOpen(true);
    };
    const finish = async (screen: Screen, route?: FirstContractRoute, intent?: "openAwakening") => {
        if (!await saveAction("complete", route)) return;
        if (intent === "openAwakening" && props.onOpenAwakening) props.onOpenAwakening();
        else if (route) openFirstContractActivity(props.character, route, props.setScreen);
        else props.setScreen(screen);
    };
    return createPortal(
        <section className="asm-root is-ceremony" ref={ceremonyRef} role="dialog" aria-modal="true" aria-labelledby="ceremony-title" onKeyDown={(event) => {
            if (event.key !== 'Tab') return;
            const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
            if (!controls.length) { event.preventDefault(); return; }
            if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
            else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
        }}>
            <div className="asm-village" style={{ backgroundImage: `url(${villagePageImage(props.character.village)})` }} />
            <article className="asm-ceremony">
                <div className="asm-copy">
                    <p className="asm-kicker">{rite.rite}</p>
                    <h2 id="ceremony-title">{pathsOpen ? "Your next step is yours." : "Shiranui's Field Seal"}</h2>
                    {saveError && <p className="asm-body" role="alert">{saveError}</p>}
                    {!pathsOpen ? <>
                        <p className="asm-body">{rite.fieldReport}</p>
                        <strong className="asm-speaker">{rite.witness}</strong>
                        <p className="asm-body">{rite.opening} {rite.villagePromise}</p>
                        <blockquote>“{vow.quote}”</blockquote>
                        <p className="asm-seal-line">{vow.keepsakeLine}</p>
                        <small>Permanent narrative keepsake · No combat stats · This is not a Genin promotion</small>
                        <button type="button" className="asm-primary" autoFocus disabled={saving} onClick={() => { void acceptSeal(); }}>{saving ? "Saving…" : "Accept the Field Seal"}</button>
                        <button type="button" className="asm-skip" onClick={props.onSkip}>Skip Academy</button>
                    </> : <>
                        <p className="asm-body">Academy tutorial complete. Choose your first assignment. You can change direction later; your Logbook keeps the whole road visible.</p>
                        <FirstContractRoutes onChoose={(route) => { void finish(FIRST_CONTRACT_COPY[route].screen, route); }} busy={saving} hasCompanion={props.character.pets.length > 0} />
                        {handoff?.primary.intent === 'openAwakening' && <button type="button" className="asm-skip" disabled={saving} onClick={() => { void finish('centralHub', undefined, 'openAwakening'); }}>Visit the Awakening Stone</button>}
                        <button type="button" className="asm-skip" disabled={saving} onClick={() => { void finish("village"); }}>Stay in the village for now</button>
                    </>}
                </div>
                <img className="asm-seal" src={fieldSealArt} alt="Shiranui's Field Seal" />
            </article>
        </section>, document.body,
    );
}
