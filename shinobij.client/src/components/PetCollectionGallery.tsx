import { useMemo, useState } from "react";
import { petDisplayName } from "../lib/pet";
import { petCardImage } from "../lib/pet-battle-anim";
import { clientPetBreedingBlocker } from "../lib/pet-breeding";
import { petVisualVariantClass } from "../lib/pet-visual-variant";
import { ultraPetTraits } from "../data/pet-config";
import type { Character } from "../types/character";
import type { PetOrigin, PetRarity } from "../types/pet";

const RARITY_ORDER: Record<PetRarity, number> = { standard: 0, rare: 1, legendary: 2, mythic: 3 };

export function PetCollectionGallery({ character, sharedImages }: { character: Character; sharedImages: Record<string, string> }) {
    const [search, setSearch] = useState("");
    const [element, setElement] = useState("all");
    const [rarity, setRarity] = useState("all");
    const [origin, setOrigin] = useState("all");
    const [uses, setUses] = useState("all");
    const [sort, setSort] = useState("rarity");

    const pets = useMemo(() => character.pets.filter((pet) => {
        const query = search.trim().toLowerCase();
        if (query && !`${pet.name} ${pet.nickname ?? ""} ${pet.trait ?? ""}`.toLowerCase().includes(query)) return false;
        if (element !== "all" && pet.element !== element) return false;
        if (rarity !== "all" && pet.rarity !== rarity) return false;
        if (origin !== "all" && (pet.origin ?? "legacy") !== origin) return false;
        const remaining = Number(pet.breedingUsesRemaining ?? 0);
        if (uses === "available" && remaining <= 0) return false;
        if (uses === "spent" && remaining > 0) return false;
        return true;
    }).sort((a, b) => {
        if (sort === "name") return petDisplayName(a).localeCompare(petDisplayName(b));
        if (sort === "level") return b.level - a.level;
        if (sort === "uses") return Number(b.breedingUsesRemaining ?? 0) - Number(a.breedingUsesRemaining ?? 0);
        return RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity] || petDisplayName(a).localeCompare(petDisplayName(b));
    }), [character.pets, element, origin, rarity, search, sort, uses]);

    const origins: Array<PetOrigin | "legacy"> = ["starter", "wild", "bred", "event", "admin", "legacy"];
    return (
        <section className="pet-collection" aria-labelledby="pet-collection-title">
            <div className="pet-home-section-heading">
                <div><span className="pet-home-kicker">Living archive</span><h2 id="pet-collection-title">Companion Collection</h2></div>
                <strong>{pets.length} / {character.pets.length}</strong>
            </div>
            <div className="pet-collection-filters" aria-label="Filter companion collection">
                <label className="pet-search"><span>Search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, nickname, trait…" /></label>
                <label><span>Element</span><select value={element} onChange={(event) => setElement(event.target.value)}><option value="all">All</option>{["Fire", "Water", "Wind", "Lightning", "Earth"].map((value) => <option key={value}>{value}</option>)}</select></label>
                <label><span>Rarity</span><select value={rarity} onChange={(event) => setRarity(event.target.value)}><option value="all">All</option>{Object.keys(RARITY_ORDER).map((value) => <option key={value}>{value}</option>)}</select></label>
                <label><span>Origin</span><select value={origin} onChange={(event) => setOrigin(event.target.value)}><option value="all">All</option>{origins.map((value) => <option key={value}>{value}</option>)}</select></label>
                <label><span>Uses</span><select value={uses} onChange={(event) => setUses(event.target.value)}><option value="all">All</option><option value="available">Available</option><option value="spent">Spent</option></select></label>
                <label><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="rarity">Rarity</option><option value="name">Name</option><option value="level">Level</option><option value="uses">Breeding uses</option></select></label>
            </div>
            {pets.length ? <div className="pet-collection-grid">
                {pets.map((pet) => {
                    const image = petCardImage(pet, sharedImages);
                    const blocker = clientPetBreedingBlocker(character, pet);
                    return <article key={pet.id} className={`pet-collection-card rarity-${pet.rarity} ${petVisualVariantClass(pet)}`}>
                        <div className="pet-collection-portrait">{image ? <img src={image} alt="" /> : <span>{pet.name.slice(0, 2).toUpperCase()}</span>}<em>{pet.element ?? "None"}</em></div>
                        <div className="pet-collection-copy"><h3>{petDisplayName(pet)}</h3><p>{pet.rarity} · Lv {pet.level} · {pet.origin ?? "legacy"}</p></div>
                        <dl><div><dt>Trait</dt><dd>{pet.trait ?? "—"}</dd></div><div><dt>Generation</dt><dd>{pet.generation ?? 0}</dd></div><div><dt>Breeding</dt><dd>{pet.breedingUsesRemaining ?? 0}/{pet.breedingUsesMax ?? 0}</dd></div></dl>
                        {pet.paletteVariantId && <span className="chromatic-ribbon">Chromatic</span>}
                        {pet.trait && ultraPetTraits.includes(pet.trait) && <span className="apex-trait-ribbon">Apex · {pet.trait}</span>}
                        <span className={`pet-eligibility ${blocker ? "blocked" : "ready"}`}>{blocker ?? "Barn ready"}</span>
                    </article>;
                })}
            </div> : <div className="pet-home-empty"><strong>No companions match these seals.</strong><span>Clear a filter to reveal the rest of your collection.</span></div>}
        </section>
    );
}
