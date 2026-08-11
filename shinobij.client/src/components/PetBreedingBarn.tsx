import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import barnArt from "../assets/pet-home/breeding-barn.webp";
import eggFire from "../assets/pet-home/egg-fire.webp";
import eggWater from "../assets/pet-home/egg-water.webp";
import eggWind from "../assets/pet-home/egg-wind.webp";
import eggLightning from "../assets/pet-home/egg-lightning.webp";
import eggEarth from "../assets/pet-home/egg-earth.webp";
import crestFire from "../assets/pet-home/crest-fire.webp";
import crestWater from "../assets/pet-home/crest-water.webp";
import crestWind from "../assets/pet-home/crest-wind.webp";
import crestLightning from "../assets/pet-home/crest-lightning.webp";
import crestEarth from "../assets/pet-home/crest-earth.webp";
import rareOverlay from "../assets/pet-home/hatch-rare-overlay.webp";
import chromaticOverlay from "../assets/pet-home/hatch-chromatic-overlay.webp";
import hatchSanctum from "../assets/pet-home/hatch-sanctum.webp";
import { activeCarriedPetIds, maxPets } from "../lib/entitlements";
import { petDisplayName } from "../lib/pet";
import { petCardImage } from "../lib/pet-battle-anim";
import { breedingOddsForPets, clientPetBreedingBlocker } from "../lib/pet-breeding";
import { fetchBreedingStatus, hatchPetBreeding, startPetBreeding } from "../lib/pet-breeding-api";
import { playPetSfx, primePetSfx } from "../lib/pet-sfx";
import { petVisualVariantClass } from "../lib/pet-visual-variant";
import { petTraitDescriptions, ultraPetTraits } from "../data/pet-config";
import { shouldApplyBreedingStatus } from "../lib/pet-breeding-status-guard";
import type { Character } from "../types/character";
import type { Pet, PetBreedingSession } from "../types/pet";
import { BreedingCountdown } from "./BreedingCountdown";

const EGG_ART: Record<string, string> = { Fire: eggFire, Water: eggWater, Wind: eggWind, Lightning: eggLightning, Earth: eggEarth };
const CREST_ART: Record<string, string> = { Fire: crestFire, Water: crestWater, Wind: crestWind, Lightning: crestLightning, Earth: crestEarth };

function makeRequestId(): string {
    return typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `breed-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ParentPicker({ label, value, character, other, onChange, sharedImages }: {
    label: string; value: string; character: Character; other: Pet | null; onChange: (id: string) => void; sharedImages: Record<string, string>;
}) {
    const carriedIds = new Set(activeCarriedPetIds(character));
    return <label className="breeding-parent-picker"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Choose a companion</option>{character.pets.map((pet) => {
        const blocker = clientPetBreedingBlocker(character, pet);
        const mismatch = other && other.id !== pet.id && other.element !== pet.element;
        const duplicate = other?.id === pet.id;
        const reason = !carriedIds.has(pet.id)
            ? "Preserved overflow — swap in Sanctuary"
            : blocker || (duplicate ? "Already selected" : mismatch ? `Needs ${other.element}` : "");
        return <option key={pet.id} value={pet.id} disabled={Boolean(reason)}>{petDisplayName(pet)} · {pet.element ?? "None"} · {pet.breedingUsesRemaining ?? 0} uses{reason ? ` — ${reason}` : ""}</option>;
    })}</select>{value && (() => { const pet = character.pets.find((entry) => entry.id === value); const art = pet ? petCardImage(pet, sharedImages) : ""; return pet ? <span className={`breeding-parent-preview ${petVisualVariantClass(pet)}`}>{art ? <img src={art} alt="" /> : null}<strong>{petDisplayName(pet)}</strong><small>{pet.rarity} · {pet.element} · {pet.breedingUsesRemaining}/{pet.breedingUsesMax} uses</small></span> : null; })()}</label>;
}

export function PetBreedingBarn({ character, updateCharacter, onServerVersion, sharedImages }: {
    character: Character;
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
    onServerVersion: (version: number) => void;
    sharedImages: Record<string, string>;
}) {
    const [parent1Id, setParent1Id] = useState("");
    const [parent2Id, setParent2Id] = useState("");
    const [sessionOverride, setSessionOverride] = useState<PetBreedingSession | null | undefined>(undefined);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [hatchedPet, setHatchedPet] = useState<Pet | null>(null);
    const [hatchedDestination, setHatchedDestination] = useState<"roster" | "sanctuary">("roster");
    const requestId = useRef<string | null>(null);
    const feedbackRef = useRef<{ sessionId: string; state: PetBreedingSession["state"]; progress: number; complete: boolean } | null>(null);
    const refreshRequestRef = useRef(0);
    const latestSaveVersionRef = useRef(0);
    const rareStingTimer = useRef<number | null>(null);
    const modalRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => { requestId.current = null; }, [parent1Id, parent2Id]);
    useEffect(() => () => {
        if (rareStingTimer.current !== null) window.clearTimeout(rareStingTimer.current);
    }, []);
    const refresh = useCallback(async (signal?: AbortSignal) => {
        const requestNo = ++refreshRequestRef.current;
        try {
            const result = await fetchBreedingStatus(character.name, signal);
            // Polls can resolve out of order around the readyAt transition.
            // Only the latest request may replace the visible session, and a
            // response may not roll the character back to an older save version.
            const version = Number(result._saveVersion ?? 0);
            if (!shouldApplyBreedingStatus({
                requestNo,
                latestRequestNo: refreshRequestRef.current,
                responseVersion: version,
                latestAcceptedVersion: latestSaveVersionRef.current,
                aborted: signal?.aborted,
            })) return;
            if (version > latestSaveVersionRef.current) latestSaveVersionRef.current = version;
            onServerVersion(version);
            setSessionOverride(result.session);
            if (result.character) {
                updateCharacter((current) => {
                    if (!current) return result.character ?? current;
                    const currentVersion = Number((current as Character & { _saveVersion?: number })._saveVersion ?? latestSaveVersionRef.current);
                    return version >= currentVersion ? result.character ?? current : current;
                });
            }
        } catch (error) {
            if ((error as Error).name !== "AbortError") setMessage((error as Error).message);
        }
    }, [character.name, onServerVersion, updateCharacter]);
    useEffect(() => {
        const controller = new AbortController();
        const initial = window.setTimeout(() => void refresh(controller.signal), 0);
        const id = window.setInterval(() => void refresh(controller.signal), 45_000);
        return () => { controller.abort(); window.clearTimeout(initial); window.clearInterval(id); };
    }, [refresh]);
    useEffect(() => {
        if (!confirmOpen && !hatchedPet) return;
        const modal = modalRef.current;
        if (!modal) return;
        const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const focusable = () => [...modal.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')];
        const frame = window.requestAnimationFrame(() => (focusable()[0] ?? modal).focus());
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                if (confirmOpen) setConfirmOpen(false);
                else setHatchedPet(null);
                return;
            }
            if (event.key !== "Tab") return;
            const controls = focusable();
            if (!controls.length) { event.preventDefault(); modal.focus(); return; }
            const first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        };
        document.addEventListener("keydown", onKey);
        return () => {
            window.cancelAnimationFrame(frame);
            document.removeEventListener("keydown", onKey);
            if (priorFocus?.isConnected) priorFocus.focus();
        };
    }, [confirmOpen, hatchedPet]);

    const parent1 = character.pets.find((pet) => pet.id === parent1Id) ?? null;
    const parent2 = character.pets.find((pet) => pet.id === parent2Id) ?? null;
    const carriedParentIds = new Set(activeCarriedPetIds(character));
    const session = sessionOverride === undefined
        ? character.petBreeding ?? null
        : character.petBreeding?.sessionId === sessionOverride?.sessionId
            ? character.petBreeding
            : sessionOverride;
    useEffect(() => {
        if (!session) { feedbackRef.current = null; return; }
        const progress = session.requirements?.reduce((sum, requirement) => sum + Math.min(requirement.progress, requirement.target), 0) ?? 0;
        const complete = session.requirements?.length === 3 && session.requirements.every((requirement) => requirement.progress >= requirement.target);
        const prior = feedbackRef.current;
        if (session.state === "egg" && (!prior || prior.sessionId !== session.sessionId || prior.state === "breeding")) {
            playPetSfx("superEffective");
        } else if (session.state === "egg" && prior?.state === "egg" && progress > prior.progress) {
            playPetSfx(complete && !prior.complete ? "victory" : "buff");
        }
        feedbackRef.current = { sessionId: session.sessionId, state: session.state, progress, complete: Boolean(complete) };
    }, [session]);
    const odds = useMemo(() => parent1 && parent2 ? breedingOddsForPets(parent1, parent2) : null, [parent1, parent2]);
    const canStart = Boolean(parent1 && parent2
        && carriedParentIds.has(parent1.id)
        && carriedParentIds.has(parent2.id)
        && parent1.id !== parent2.id
        && parent1.element === parent2.element
        && !clientPetBreedingBlocker(character, parent1)
        && !clientPetBreedingBlocker(character, parent2));

    async function confirmStart() {
        if (!parent1 || !parent2 || !canStart || busy) return;
        primePetSfx();
        setBusy(true); setMessage("");
        refreshRequestRef.current += 1;
        requestId.current ||= makeRequestId();
        try {
            const result = await startPetBreeding({ playerName: character.name, parent1Id: parent1.id, parent2Id: parent2.id, requestId: requestId.current });
            latestSaveVersionRef.current = Math.max(latestSaveVersionRef.current, result._saveVersion);
            onServerVersion(result._saveVersion);
            updateCharacter(result.character); setSessionOverride(result.session); setConfirmOpen(false); requestId.current = null; playPetSfx("finisher");
        } catch (error) { setMessage((error as Error).message); }
        finally { setBusy(false); }
    }

    async function hatch() {
        if (!session || busy) return;
        primePetSfx();
        setBusy(true); setMessage("");
        refreshRequestRef.current += 1;
        try {
            const result = await hatchPetBreeding({ playerName: character.name, sessionId: session.sessionId });
            latestSaveVersionRef.current = Math.max(latestSaveVersionRef.current, result._saveVersion);
            onServerVersion(result._saveVersion);
            updateCharacter(result.character); setSessionOverride(null); setHatchedDestination(result.destination); setHatchedPet(result.pet); playPetSfx("victory");
            if (result.pet.paletteVariantId || (result.pet.trait && ultraPetTraits.includes(result.pet.trait))) {
                if (rareStingTimer.current !== null) window.clearTimeout(rareStingTimer.current);
                rareStingTimer.current = window.setTimeout(() => playPetSfx("superEffective"), 420);
            }
        } catch (error) { setMessage((error as Error).message); }
        finally { setBusy(false); }
    }

    const complete = session?.requirements?.length === 3 && session.requirements.every((requirement) => requirement.progress >= requirement.target);
    const yardFull = character.pets.length >= maxPets(character);
    const hatchedArt = hatchedPet ? petCardImage(hatchedPet, sharedImages) : "";
    const hatchInitials = hatchedPet ? petDisplayName(hatchedPet).split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase() : "";
    const apexTrait = hatchedPet?.trait && ultraPetTraits.includes(hatchedPet.trait) ? hatchedPet.trait : null;
    return <section className="breeding-barn" style={{ backgroundImage: `linear-gradient(180deg,rgba(3,8,18,.28),rgba(3,8,18,.94)),url(${barnArt})` }} aria-labelledby="breeding-barn-title">
        <div className="pet-home-section-heading"><div><span className="pet-home-kicker">One barn · 24-hour ritual</span><h2 id="breeding-barn-title">Breeding Barn</h2></div><strong>{session ? "Occupied" : "Available"}</strong></div>
        {message && <p className="pet-home-message" role="status">{message}</p>}
        {!session ? <div className="breeding-setup">
            <div className="breeding-parent-grid"><ParentPicker label="First parent" value={parent1Id} character={character} other={parent2} onChange={(id) => { primePetSfx(); playPetSfx("command"); setParent1Id(id); }} sharedImages={sharedImages} /><span className="breeding-link">×</span><ParentPicker label="Second parent" value={parent2Id} character={character} other={parent1} onChange={(id) => { primePetSfx(); playPetSfx("command"); setParent2Id(id); }} sharedImages={sharedImages} /></div>
            {odds && <div className="breeding-odds"><span><b>{odds.parent1}%</b> First species</span><span><b>{odds.parent2}%</b> Second species</span><span><b>{odds.alternate}%</b> Same element/tier</span><span><b>{odds.randomNonStandard}%</b> Rare+ surprise</span><span className="chromatic"><b>{odds.chromatic}%</b> Chromatic (independent)</span><span className="apex"><b>{odds.apexTrait}%</b> Apex Shrine trait (independent)</span></div>}
            <p className="breeding-contract">Each parent spends one breeding use when the sealed result is created. The species and Chromatic rolls remain private until hatch.</p>
            {character.pets.length > carriedParentIds.size && <p className="hatch-overflow-note">Preserved overflow stays owned but cannot start breeding. Swap a companion into the carried roster through the Sanctuary first.</p>}
            <button type="button" className="pet-home-primary" disabled={!canStart || busy} onClick={() => { primePetSfx(); playPetSfx("command"); setConfirmOpen(true); }}>Begin 24-hour breeding</button>
        </div> : session.state === "breeding" ? <div className="breeding-in-progress"><div className="breeding-parent-names"><span>{session.parentNames[0]}</span><i><img src={CREST_ART[session.parentElement]} alt="" />{session.parentElement}</i><span>{session.parentNames[1]}</span></div><BreedingCountdown readyAt={session.readyAt} onElapsed={() => void refresh()} /><p>The result is sealed. Parents remain committed until the timer reaches zero.</p></div> : <div className="egg-nursery"><div className="egg-stage"><img src={EGG_ART[session.parentElement] ?? eggEarth} alt={`${session.parentElement} companion egg`} /><span><img className="element-crest" src={CREST_ART[session.parentElement]} alt="" />{session.parentElement} egg</span></div><div className="hatch-requirements"><h3>Hatch bonds</h3>{session.requirements?.map((requirement) => <div key={requirement.id} className={`hatch-requirement requirement-${requirement.category}`}><span>{requirement.label}</span><progress aria-label={`${requirement.label}: ${requirement.progress} of ${requirement.target}`} value={requirement.progress} max={requirement.target} /><b>{requirement.progress}/{requirement.target}</b></div>)}</div><button type="button" className="pet-home-primary" disabled={!complete || busy} onClick={() => void hatch()}>{complete ? yardFull ? "Hatch to Sanctuary" : "Hatch companion" : "Complete all three bonds"}</button>{yardFull && <p className="hatch-overflow-note">Your carried roster is full ({character.pets.length}/{maxPets(character)}). This companion will hatch safely into the Sanctuary.</p>}</div>}
        {confirmOpen && parent1 && parent2 && <div className="pet-home-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmOpen(false); }}><div ref={modalRef} className="pet-home-modal" role="dialog" aria-modal="true" aria-labelledby="breed-confirm-title" aria-describedby="breed-confirm-copy" tabIndex={-1}><span className="pet-home-kicker">Final confirmation</span><h3 id="breed-confirm-title">Commit {petDisplayName(parent1)} and {petDisplayName(parent2)}?</h3><p id="breed-confirm-copy">One breeding use will be permanently consumed from each parent. Breeding takes 24 real hours and cannot be canceled or rerolled. The sealed result cannot be previewed.</p><div className="pet-home-modal-actions"><button type="button" onClick={() => setConfirmOpen(false)}>Cancel</button><button type="button" className="pet-home-primary" disabled={busy} onClick={() => void confirmStart()}>{busy ? "Sealing…" : "Commit parents"}</button></div></div></div>}
        {hatchedPet && <div className="pet-home-modal-backdrop hatch-cinematic"><div ref={modalRef} className={`pet-home-modal hatch-reveal ${petVisualVariantClass(hatchedPet)}${apexTrait ? " hatch-reveal--apex" : ""}`} role="dialog" aria-modal="true" aria-labelledby="hatch-title" aria-describedby="hatch-summary" tabIndex={-1}><img className="hatch-sanctum" src={hatchSanctum} alt="" /><img className={`hatch-aura ${hatchedPet.paletteVariantId ? "hatch-aura--chromatic" : "hatch-aura--rare"}`} src={hatchedPet.paletteVariantId ? chromaticOverlay : rareOverlay} alt="" /><span className="pet-home-kicker">Bond awakened</span><h3 id="hatch-title">{petDisplayName(hatchedPet)}</h3><div className="hatch-pet-stage">{hatchedArt ? <img className="hatch-pet" src={hatchedArt} alt={petDisplayName(hatchedPet)} /> : <span className="hatch-pet-fallback" aria-label={`${petDisplayName(hatchedPet)} artwork unavailable`}>{hatchInitials}</span>}</div><p id="hatch-summary">{hatchedPet.rarity} · {hatchedPet.element} · {hatchedPet.trait} · Generation {hatchedPet.generation}</p>{apexTrait && <><strong className="apex-trait-ribbon">Apex trait · {apexTrait}</strong><small className="apex-trait-copy">{petTraitDescriptions[apexTrait]}</small></>}{hatchedPet.paletteVariantId && <strong className="chromatic-ribbon">Chromatic miracle</strong>}{hatchedDestination === "sanctuary" && <p className="hatch-sanctuary-note">Your carried roster was full, so this companion is resting safely in the Sanctuary.</p>}<button type="button" className="pet-home-primary" onClick={() => setHatchedPet(null)}>{hatchedDestination === "sanctuary" ? "Rest well" : "Welcome home"}</button></div></div>}
    </section>;
}
