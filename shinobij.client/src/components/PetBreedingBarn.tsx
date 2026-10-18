import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import barnArt from "../assets/pet-home/breeding-barn.webp";
import { visiblePoll } from "../lib/poll";
import crestFire from "../assets/pet-home/crest-fire.webp";
import crestWater from "../assets/pet-home/crest-water.webp";
import crestWind from "../assets/pet-home/crest-wind.webp";
import crestLightning from "../assets/pet-home/crest-lightning.webp";
import crestEarth from "../assets/pet-home/crest-earth.webp";
import { activeCarriedPetIds } from "../lib/entitlements";
import { petDisplayName } from "../lib/pet";
import { breedingOddsForPets, clientPetBreedingBlocker } from "../lib/pet-breeding";
import { fetchBreedingStatus, startPetBreeding } from "../lib/pet-breeding-api";
import { playPetSfx, primePetSfx } from "../lib/pet-sfx";
import { petVisualVariantClass } from "../lib/pet-visual-variant";
import { shouldApplyBreedingStatus } from "../lib/pet-breeding-status-guard";
import type { BeginCharacterSync, Character, VersionedCharacterCommit } from "../types/character";
import type { Pet, PetBreedingSession } from "../types/pet";
import { BreedingCountdown } from "./BreedingCountdown";
import { CompanionIdentity } from "./CompanionIdentity";
import { PetEggCard } from './PetEggCard';
import {
    useCapabilityMutationAvailability,
    useCapabilityViewAvailability,
    useLiveCapabilities,
} from "../lib/live-capabilities-context";
import { capabilityAdmissionAllowed } from "../lib/live-capability-admission";

const CREST_ART: Record<string, string> = { Fire: crestFire, Water: crestWater, Wind: crestWind, Lightning: crestLightning, Earth: crestEarth };

function makeRequestId(): string {
    return typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `breed-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ParentPicker({ label, value, character, other, onChange, sharedImages }: {
    label: string; value: string; character: Character; other: Pet | null; onChange: (id: string) => void; sharedImages: Record<string, string>;
}) {
    const carriedIds = new Set(activeCarriedPetIds(character));
    return <label className="breeding-parent-picker"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Choose a companion</option>{character.pets.map((pet) => {
        const blocker = carriedIds.has(pet.id) ? clientPetBreedingBlocker(character, pet) : "Preserved overflow — move to carried first";
        const mismatch = other && other.id !== pet.id && other.element !== pet.element;
        const duplicate = other?.id === pet.id;
        const reason = blocker || (duplicate ? "Already selected" : mismatch ? `Needs ${other.element}` : "");
        return <option key={pet.id} value={pet.id} disabled={Boolean(reason)}>{petDisplayName(pet)} · {pet.element ?? "None"} · {pet.breedingUsesRemaining ?? 0} uses{reason ? ` — ${reason}` : ""}</option>;
    })}</select>{value && (() => { const pet = character.pets.find((entry) => entry.id === value); return pet ? <span className={`breeding-parent-preview companion-card rarity-${pet.rarity} ${petVisualVariantClass(pet)}`}><CompanionIdentity pet={pet} sharedImages={sharedImages} compact /><small>{pet.breedingUsesRemaining}/{pet.breedingUsesMax} breeding uses</small></span> : null; })()}</label>;
}

export function PetBreedingBarn({ character, updateCharacter, onVersionedCharacter, beginCharacterSync, onServerVersion, sharedImages, onOpenSanctuary }: {
    character: Character;
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
    onVersionedCharacter?: VersionedCharacterCommit;
    beginCharacterSync?: BeginCharacterSync;
    onServerVersion: (version: number) => void;
    sharedImages: Record<string, string>;
    onOpenSanctuary?: () => void;
}) {
    const breedingReadAvailability = useCapabilityViewAvailability();
    const breedingStartAvailability = useCapabilityMutationAvailability("petBreedingStarts");
    const { mutationAvailability, viewAvailability } = useLiveCapabilities();
    const breedingReadAvailable = capabilityAdmissionAllowed(breedingReadAvailability);
    const breedingStartsAvailable = capabilityAdmissionAllowed(breedingStartAvailability);
    const [parent1Id, setParent1Id] = useState("");
    const [parent2Id, setParent2Id] = useState("");
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const requestId = useRef<string | null>(null);
    const feedbackRef = useRef<{ sessionId: string; state: PetBreedingSession["state"]; progress: number; complete: boolean } | null>(null);
    const refreshRequestRef = useRef(0);
    const latestSaveVersionRef = useRef(0);
    const modalRef = useRef<HTMLDivElement | null>(null);
    const trackedSessionId = character.petBreeding?.sessionId ?? null;
    const commitServerCharacter = useCallback((nextCharacter: Character, version: number): boolean => {
        if (onVersionedCharacter) return onVersionedCharacter(nextCharacter, version);
        onServerVersion(version);
        updateCharacter(nextCharacter);
        return true;
    }, [onServerVersion, onVersionedCharacter, updateCharacter]);

    useEffect(() => { requestId.current = null; }, [parent1Id, parent2Id]);
    // Home passes an inline onServerVersion and App a fresh onVersionedCharacter
    // every render. Read them through a ref so `refresh` stays stable; otherwise
    // the effects below re-fetched status (and restarted the poll, aborting the
    // read in flight) on every App render.
    const refreshDepsRef = useRef({ commitServerCharacter, onServerVersion, viewAvailability, beginCharacterSync });
    useEffect(() => {
        refreshDepsRef.current = { commitServerCharacter, onServerVersion, viewAvailability, beginCharacterSync };
    }, [commitServerCharacter, onServerVersion, viewAvailability, beginCharacterSync]);
    const refresh = useCallback(async (signal?: AbortSignal) => {
        const { commitServerCharacter, onServerVersion, viewAvailability, beginCharacterSync } = refreshDepsRef.current;
        if (!capabilityAdmissionAllowed(viewAvailability())) return;
        const requestNo = ++refreshRequestRef.current;
        try {
            const authority = await beginCharacterSync?.(character.name);
            if (signal?.aborted || (authority && !authority.isCurrent())) return;
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
            if (result.character) {
                if (!(authority?.commit ?? commitServerCharacter)(result.character, version)) return;
            } else onServerVersion(version);
        } catch (error) {
            if ((error as Error).name !== "AbortError") setMessage((error as Error).message);
        }
    }, [character.name]);
    useEffect(() => {
        if (!breedingReadAvailable) return;
        const controller = new AbortController();
        const initial = window.setTimeout(() => void refresh(controller.signal), 0);
        return () => { controller.abort(); window.clearTimeout(initial); };
    }, [breedingReadAvailable, refresh]);
    useEffect(() => {
        if (!breedingReadAvailable || !trackedSessionId) return;
        const controller = new AbortController();
        const stop = visiblePoll(() => void refresh(controller.signal), 45_000);
        return () => { controller.abort(); stop(); };
    }, [breedingReadAvailable, refresh, trackedSessionId]);
    useEffect(() => {
        if (!confirmOpen) return;
        const modal = modalRef.current;
        if (!modal) return;
        const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const focusable = () => [...modal.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')];
        const frame = window.requestAnimationFrame(() => (focusable()[0] ?? modal).focus());
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                setConfirmOpen(false);
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
    }, [confirmOpen]);

    const parent1 = character.pets.find((pet) => pet.id === parent1Id) ?? null;
    const parent2 = character.pets.find((pet) => pet.id === parent2Id) ?? null;
    const carriedParentIds = new Set(activeCarriedPetIds(character));
    const session = character.petBreeding ?? null;
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
    const pairingEligible = Boolean(parent1 && parent2 && carriedParentIds.has(parent1.id) && carriedParentIds.has(parent2.id) && parent1.id !== parent2.id && parent1.element === parent2.element && !clientPetBreedingBlocker(character, parent1) && !clientPetBreedingBlocker(character, parent2));
    const canStart = breedingStartsAvailable && pairingEligible;

    async function confirmStart() {
        if (!breedingStartsAvailable || !capabilityAdmissionAllowed(mutationAvailability("petBreedingStarts")) || !parent1 || !parent2 || !canStart || busy) return;
        primePetSfx();
        setBusy(true); setMessage("");
        refreshRequestRef.current += 1;
        requestId.current ||= makeRequestId();
        try {
            const authority = await beginCharacterSync?.(character.name);
            if (authority && !authority.isCurrent()) return;
            const result = await startPetBreeding({ playerName: character.name, parent1Id: parent1.id, parent2Id: parent2.id, requestId: requestId.current });
            latestSaveVersionRef.current = Math.max(latestSaveVersionRef.current, result._saveVersion);
            // Started even if a newer save was adopted first and this commit is
            // refused as stale (the coordinator then reads the stored save back).
            (authority?.commit ?? commitServerCharacter)(result.character, result._saveVersion);
            setConfirmOpen(false); requestId.current = null; playPetSfx("finisher");
            setMessage(result.eggProduced ? 'An egg was created and moved to Sanctuary. Incubation takes 12 hours of gameplay.' : 'This pairing did not produce an egg. Each parent used one breeding use.');
        } catch (error) { setMessage((error as Error).message); }
        finally { setBusy(false); }
    }

    return <section className="breeding-barn" style={{ backgroundImage: `linear-gradient(180deg,rgba(3,8,18,.28),rgba(3,8,18,.94)),url(${barnArt})` }} aria-labelledby="breeding-barn-title">
        <div className="pet-home-section-heading"><div><span className="pet-home-kicker">80% egg chance · 12 hours of gameplay</span><h2 id="breeding-barn-title">Shinobi Hatchery</h2></div><strong>{session ? "Occupied" : "Available"}</strong></div>
        {message && <p className="pet-home-message" role="status">{message}</p>}
        {!session ? <div className="breeding-setup">
            {!breedingStartsAvailable && <p className="pet-home-message" role="status">{breedingStartAvailability === "unknown" ? "Checking whether new companion pairings are available…" : "New companion pairings are temporarily paused. Existing timers and eggs remain visible; hatching follows the global action gate."}</p>}
            <div className="breeding-parent-grid"><ParentPicker label="First parent" value={parent1Id} character={character} other={parent2} onChange={(id) => { primePetSfx(); playPetSfx("command"); setParent1Id(id); }} sharedImages={sharedImages} /><span className="breeding-link">×</span><ParentPicker label="Second parent" value={parent2Id} character={character} other={parent1} onChange={(id) => { primePetSfx(); playPetSfx("command"); setParent2Id(id); }} sharedImages={sharedImages} /></div>
            {odds && <p className="breeding-contract">Offspring odds below apply when a pairing produces an egg.</p>}
            {odds && <div className="breeding-odds"><span><b>{odds.parent1}%</b> First species</span><span><b>{odds.parent2}%</b> Second species</span><span><b>{odds.alternate}%</b> Same element/tier</span><span><b>{odds.randomNonStandard}%</b> Rare+ surprise</span><span className="chromatic"><b>{odds.chromatic}%</b> Chromatic (independent)</span><span className="apex"><b>{odds.apexTrait}%</b> Apex Shrine trait (independent)</span></div>}
            <p className="breeding-contract">Each pairing uses one breeding use from each parent and has an 80% chance to create an egg. Successful eggs incubate in Sanctuary; species and Chromatic rolls stay private until hatch.</p>
            <button type="button" className="pet-home-primary" disabled={!canStart || busy} onClick={() => { primePetSfx(); playPetSfx("command"); setConfirmOpen(true); }}>Pair companions</button>
        </div> : session.state === "breeding" ? <div className="breeding-in-progress"><div className="breeding-parent-names"><span>{session.parentNames[0]}</span><i><img src={CREST_ART[session.parentElement]} alt="" />{session.parentElement}</i><span>{session.parentNames[1]}</span></div><BreedingCountdown readyAt={session.readyAt} onElapsed={() => void refresh()} /><p>The result is sealed. Parents remain committed until the timer reaches zero.</p></div> : <><PetEggCard session={session} />{onOpenSanctuary && <button type="button" className="pet-home-primary" onClick={onOpenSanctuary}>View egg in Sanctuary</button>}</>}
        {confirmOpen && parent1 && parent2 && <div className="pet-home-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmOpen(false); }}><div ref={modalRef} className="pet-home-modal" role="dialog" aria-modal="true" aria-labelledby="breed-confirm-title" aria-describedby="breed-confirm-copy" tabIndex={-1}><span className="pet-home-kicker">Final confirmation</span><h3 id="breed-confirm-title">Commit {petDisplayName(parent1)} and {petDisplayName(parent2)}?</h3><p id="breed-confirm-copy">Each parent spends one breeding use, including on a failed attempt. There is an 80% chance of an egg. Successful eggs go to Sanctuary and hatch after 12 hours of gameplay; offline time does not count.</p><div className="pet-home-modal-actions"><button type="button" onClick={() => setConfirmOpen(false)}>Cancel</button><button type="button" className="pet-home-primary" disabled={busy || !breedingStartsAvailable} onClick={() => void confirmStart()}>{busy ? "Sealing…" : "Commit parents"}</button></div></div></div>}
    </section>;
}
