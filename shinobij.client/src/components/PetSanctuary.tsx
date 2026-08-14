import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import sanctuaryArt from "../assets/pet-home/companion-sanctuary.webp";
import { ultraPetTraits } from "../data/pet-config";
import { captureProductEvent } from "../lib/analytics";
import { activeCarriedPetIds, activeCarriedPets, maxPets } from "../lib/entitlements";
import { petDisplayName } from "../lib/pet";
import { petCardImage } from "../lib/pet-battle-anim";
import { fetchPetSanctuary, transferPetSanctuary, type PetSanctuaryFilters, type PetSanctuaryItem } from "../lib/pet-sanctuary-api";
import { petVisualVariantClass } from "../lib/pet-visual-variant";
import type { Character } from "../types/character";
import type { Pet } from "../types/pet";
import { gameConfirm } from "./GameAlert";

const ELEMENTS = ["all", "Fire", "Water", "Wind", "Lightning", "Earth"] as const;
const RARITIES = ["all", "standard", "rare", "legendary", "mythic"] as const;
const ORIGINS = ["all", "starter", "wild", "bred", "event", "admin"] as const;

function title(value: string): string {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Unknown";
}

function initials(pet: Pet): string {
    return petDisplayName(pet).split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase();
}

function storedLabel(storedAt: number): string {
    if (!storedAt) return "Safe in the preserve";
    return `Arrived ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(storedAt)}`;
}

export function PetSanctuary({ character, updateCharacter, onServerVersion, sharedImages }: {
    character: Character;
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
    onServerVersion: (version: number) => void;
    sharedImages: Record<string, string>;
}) {
    const [items, setItems] = useState<PetSanctuaryItem[]>([]);
    const [total, setTotal] = useState(0);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [element, setElement] = useState("all");
    const [rarity, setRarity] = useState("all");
    const [origin, setOrigin] = useState("all");
    const [depositPetId, setDepositPetId] = useState(character.pets[0]?.id ?? "");
    const [loading, setLoading] = useState(true);
    const [busyPetId, setBusyPetId] = useState("");
    const [message, setMessage] = useState("");
    const requestRef = useRef(0);

    const filters = useMemo<PetSanctuaryFilters>(() => ({ search, element, rarity, origin }), [search, element, rarity, origin]);
    const carriedCapacity = maxPets(character);
    const eligibleCarried = activeCarriedPets<Pet>(character);
    const eligibleCarriedIds = new Set(activeCarriedPetIds(character));
    const preservedOverflowCount = Math.max(0, character.pets.length - eligibleCarried.length);
    const selectedDepositPetId = character.pets.some((pet) => pet.id === depositPetId)
        ? depositPetId
        : character.pets[0]?.id ?? "";

    useEffect(() => {
        captureProductEvent("sanctuary_overflow_explanation_viewed", {
            screenId: "companion-sanctuary",
            source: "pet-home",
        });
    }, []);

    const load = useCallback(async (mode: "replace" | "append", cursor?: string | null, signal?: AbortSignal) => {
        const request = ++requestRef.current;
        if (mode === "replace") setLoading(true);
        try {
            const result = await fetchPetSanctuary(character.name, filters, cursor, signal);
            if (signal?.aborted || request !== requestRef.current) return;
            setItems((current) => mode === "append"
                ? [...current, ...result.items.filter((item) => !current.some((entry) => entry.pet.id === item.pet.id))]
                : result.items);
            setTotal(result.total);
            setNextCursor(result.nextCursor);
            setMessage("");
        } catch (error) {
            if ((error as Error).name !== "AbortError" && request === requestRef.current) setMessage((error as Error).message);
        } finally {
            if (request === requestRef.current) setLoading(false);
        }
    }, [character.name, filters]);

    useEffect(() => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => void load("replace", null, controller.signal), search ? 240 : 0);
        return () => { controller.abort(); window.clearTimeout(timer); };
    }, [load, search]);

    async function moveToSanctuary() {
        const pet = character.pets.find((entry) => entry.id === selectedDepositPetId);
        if (!pet || busyPetId) return;
        setBusyPetId(pet.id); setMessage("");
        try {
            const result = await transferPetSanctuary({ playerName: character.name, petId: pet.id, action: "to-sanctuary" });
            onServerVersion(result._saveVersion);
            updateCharacter(result.character);
            await load("replace");
            setMessage(`${petDisplayName(result.pet)} is resting safely in the Sanctuary.`);
        } catch (error) { setMessage((error as Error).message); }
        finally { setBusyPetId(""); }
    }

    async function moveToRoster(item: PetSanctuaryItem) {
        if (busyPetId || eligibleCarried.length >= carriedCapacity) return;
        setBusyPetId(item.pet.id); setMessage("");
        try {
            const result = await transferPetSanctuary({ playerName: character.name, petId: item.pet.id, action: "to-roster" });
            onServerVersion(result._saveVersion);
            updateCharacter(result.character);
            setItems((current) => current.filter((entry) => entry.pet.id !== item.pet.id));
            setTotal((current) => Math.max(0, current - 1));
            setMessage(`${petDisplayName(result.pet)} joined your carried roster.`);
        } catch (error) { setMessage((error as Error).message); }
        finally { setBusyPetId(""); }
    }

    async function release(item: PetSanctuaryItem) {
        if (busyPetId) return;
        const name = petDisplayName(item.pet);
        if (!(await gameConfirm(`Release ${name} from your Sanctuary? This bond cannot be restored.`, { danger: true, confirmLabel: "Release" }))) return;
        setBusyPetId(item.pet.id); setMessage("");
        try {
            const result = await transferPetSanctuary({ playerName: character.name, petId: item.pet.id, action: "release" });
            onServerVersion(result._saveVersion);
            setItems((current) => current.filter((entry) => entry.pet.id !== item.pet.id));
            setTotal((current) => Math.max(0, current - 1));
            setMessage(`${name} was released.`);
        } catch (error) { setMessage((error as Error).message); }
        finally { setBusyPetId(""); }
    }

    return <section className="pet-sanctuary" aria-labelledby="pet-sanctuary-title">
        <div className="pet-sanctuary-hero" style={{ backgroundImage: `linear-gradient(90deg,rgba(3,8,18,.94),rgba(3,8,18,.38) 62%,rgba(3,8,18,.72)),linear-gradient(0deg,rgba(3,8,18,.92),transparent 55%),url(${sanctuaryArt})` }}>
            <div><span className="pet-home-kicker">Unlimited bonded-companion preserve</span><h2 id="pet-sanctuary-title">Companion Sanctuary</h2><p>Companions beyond your carried roster rest here safely. Captures and hatches arrive automatically whenever your battle-ready spaces are full.</p></div>
            <div className="pet-sanctuary-ledger" aria-label="Companion capacity"><span><b>{eligibleCarried.length}/{carriedCapacity}</b> Carried</span>{preservedOverflowCount > 0 && <span><b>{preservedOverflowCount}</b> Preserved overflow</span>}<span><b>{total}</b> Sanctuary</span><strong>No ownership cap</strong></div>
        </div>

        <div className="pet-sanctuary-manager">
            <div><span className="pet-home-kicker">Roster management</span><h3>Send a companion to rest</h3><p>Base carries 4; Supporter carries 6. Overflow stays owned but cannot fight, breed, or start new training or expeditions. Store a carried pet to promote the next one. Sanctuary pets rest outside all activities.</p></div>
            <label><span>Owned roster companion</span><select value={selectedDepositPetId} onChange={(event) => setDepositPetId(event.target.value)} disabled={!character.pets.length || Boolean(busyPetId)}><option value="">No roster companions</option>{character.pets.map((pet) => <option key={pet.id} value={pet.id}>{petDisplayName(pet)} · Lv. {pet.level} · {title(pet.rarity)}{eligibleCarriedIds.has(pet.id) ? " · Carried" : " · Preserved overflow"}</option>)}</select></label>
            <button type="button" className="pet-home-primary" disabled={!selectedDepositPetId || Boolean(busyPetId)} onClick={() => void moveToSanctuary()}>{busyPetId === selectedDepositPetId ? "Preparing habitat…" : "Move to Sanctuary"}</button>
        </div>
        {message && <p className="pet-sanctuary-message" role="status">{message}</p>}

        <div className="pet-sanctuary-toolbar" aria-label="Filter Sanctuary companions">
            <label className="pet-search"><span>Search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, nickname, trait…" /></label>
            <label><span>Element</span><select value={element} onChange={(event) => setElement(event.target.value)}>{ELEMENTS.map((value) => <option key={value} value={value}>{title(value)}</option>)}</select></label>
            <label><span>Rarity</span><select value={rarity} onChange={(event) => setRarity(event.target.value)}>{RARITIES.map((value) => <option key={value} value={value}>{title(value)}</option>)}</select></label>
            <label><span>Origin</span><select value={origin} onChange={(event) => setOrigin(event.target.value)}>{ORIGINS.map((value) => <option key={value} value={value}>{title(value)}</option>)}</select></label>
        </div>
        {loading ? <div className="pet-sanctuary-loading" role="status"><span /><p>Opening the habitats…</p></div> : items.length ? <div className="pet-sanctuary-grid">{items.map((item) => {
            const pet = item.pet;
            const art = petCardImage(pet, sharedImages);
            const apex = pet.trait && ultraPetTraits.includes(pet.trait) ? pet.trait : null;
            const isBusy = busyPetId === pet.id;
            const rosterFull = eligibleCarried.length >= carriedCapacity;
            return <article key={pet.id} className={`pet-sanctuary-card rarity-${pet.rarity} ${petVisualVariantClass(pet)}`}>
                <div className="pet-sanctuary-portrait">{art ? <img src={art} alt={petDisplayName(pet)} /> : <span aria-label={`${petDisplayName(pet)} artwork unavailable`}>{initials(pet)}</span>}<em>Lv. {pet.level}</em></div>
                {pet.paletteVariantId && <strong className="chromatic-ribbon">Chromatic</strong>}{apex && <strong className="apex-trait-ribbon">Apex · {apex}</strong>}
                <div className="pet-sanctuary-copy"><span>{title(pet.rarity)} · {pet.element ?? "Neutral"}</span><h3>{petDisplayName(pet)}</h3><p>{pet.trait ?? "Unrevealed trait"} · {title(item.source)} arrival</p><small>{storedLabel(item.storedAt)}</small></div>
                <dl><div><dt>HP</dt><dd>{pet.hp}</dd></div><div><dt>ATK</dt><dd>{pet.attack}</dd></div><div><dt>DEF</dt><dd>{pet.defense}</dd></div><div><dt>SPD</dt><dd>{pet.speed}</dd></div></dl>
                <div className="pet-sanctuary-actions"><button type="button" className="pet-home-primary" disabled={rosterFull || Boolean(busyPetId)} title={rosterFull ? `Carried roster full (${eligibleCarried.length}/${carriedCapacity})` : undefined} onClick={() => void moveToRoster(item)}>{isBusy ? "Moving…" : rosterFull ? "Roster full" : "Add to carried"}</button><button type="button" className="pet-sanctuary-release" disabled={Boolean(busyPetId)} onClick={() => void release(item)}>Release</button></div>
            </article>;
        })}</div> : <div className="pet-sanctuary-empty"><span>静</span><h3>{total ? "No companions match these filters" : "Every habitat is ready"}</h3><p>{total ? "Try widening your search." : "Overflow captures, hatched companions, and pets you move from your roster will appear here."}</p></div>}
        {nextCursor && !loading && <button type="button" className="pet-sanctuary-more" disabled={Boolean(busyPetId)} onClick={() => void load("append", nextCursor)}>Load more habitats</button>}
    </section>;
}
