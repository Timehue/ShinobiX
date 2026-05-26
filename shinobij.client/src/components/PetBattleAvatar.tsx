import { type Pet, petDisplayName, petTraitDescriptions } from "../App";

export function PetBattleAvatar({ pet, side, active, status, sharedImages = {} }: { pet: Pet; side: "player" | "enemy"; active: boolean; status?: { poisoned?: number; atkBuff?: boolean; defBuff?: boolean }; sharedImages?: Record<string, string> }) {
    const petBaseId = pet.id.replace(/-\d{10,}$/, '');
    const img = sharedImages['pet:' + pet.id] || sharedImages['pet:' + petBaseId] || pet.image || '';
    return (
        <div className={`pet-battle-avatar ${side}${active ? " active" : ""}${status?.poisoned ? " poisoned" : ""}`}>
            {img ? <img src={img} alt={pet.name} /> : <span>{pet.name.slice(0, 2).toUpperCase()}</span>}
        </div>
    );
}

export function PetArenaCard({ owner, pet, sharedImages = {} }: { owner: string; pet: Pet; sharedImages?: Record<string, string> }) {
    const petBaseId = pet.id.replace(/-\d{10,}$/, '');
    const img = sharedImages['pet:' + pet.id] || sharedImages['pet:' + petBaseId] || pet.image || '';
    return (
        <div className="pet-arena-card">
            <div className="pet-arena-avatar">
                {img ? <img src={img} alt={petDisplayName(pet)} /> : <span>{petDisplayName(pet).slice(0, 2).toUpperCase()}</span>}
            </div>
            <div>
                <strong>{petDisplayName(pet)}</strong>
                <p>{owner} | {pet.rarity} | Lv {pet.level}</p>
                <p>HP {pet.hp} | ATK {pet.attack} | DEF {pet.defense} | SPD {pet.speed}</p>
                {pet.trait && <p><strong>Trait:</strong> {pet.trait} — {petTraitDescriptions[pet.trait]}</p>}
                <div className="pet-arena-jutsu-list">
                    {pet.jutsus.length ? pet.jutsus.map((jutsu) => {
                        const kindColors: Record<string, string> = { damage: "#fca5a5", buff: "#86efac", heal: "#4ade80", debuff: "#f97316", dot: "#c084fc", move: "#93c5fd", barrier: "#7dd3fc", movelock: "#fbbf24" };
                        const kindIcons:  Record<string, string> = { damage: "⚔", buff: "⬆", heal: "✚", debuff: "⬇", dot: "☠", move: "➡", barrier: "◇", movelock: "⛓" };
                        const col  = kindColors[jutsu.kind] ?? "#aaa";
                        const icon = kindIcons[jutsu.kind]  ?? "✦";
                        return (
                            <span key={jutsu.name} className="pet-arena-jutsu-chip" style={{ borderColor: col, color: col }}>
                                {icon} {jutsu.name}{jutsu.power > 0 ? ` · P${jutsu.power}` : ""} · CD{jutsu.cooldown}
                            </span>
                        );
                    }) : <span style={{ color: "#555" }}>No jutsu</span>}
                </div>
            </div>
        </div>
    );
}
