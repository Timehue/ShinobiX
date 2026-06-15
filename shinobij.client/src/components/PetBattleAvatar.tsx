import { type Pet } from "../App";
import { petDisplayName } from "../lib/pet";
import { ROLE_META, derivePetRole } from "../lib/pet-roles";
import { petCollarVisual, petTraitDescriptions } from "../data/pet-config";
import { petBattleSprite, petBattleLayers, petBattleSheet, petAvatarStateClass } from "../lib/pet-battle-anim";
import type { PetVisualState } from "../types/pet-battle";

export function PetBattleAvatar({ pet, side, active, hit, status, sharedImages = {}, visualState = "idle" }: { pet: Pet; side: "player" | "enemy"; active: boolean; hit?: boolean; status?: { poisoned?: number; atkBuff?: boolean; defBuff?: boolean }; sharedImages?: Record<string, string>; visualState?: PetVisualState }) {
    // Sprite mode, most-dimensional first:
    //   spriteSheet     — a baked animation strip (petsheet:<id>), played via a
    //                     CSS steps() loop (Phase C — the AI-3D-baked slot);
    //   layeredParallax — depth-sliced far/mid/near layers (petlayers:<id>:*),
    //                     drawn as a parallax stack (Phase B 2.5D billboard);
    //   fullBodySprite  — a single transparent full-body PNG (petbody:<id>);
    //   circleFallback  — the legacy clipped portrait orb.
    // All modes share the same directional pose classes.
    const sheet = petBattleSheet(pet, sharedImages);
    const layers = sheet ? null : petBattleLayers(pet, sharedImages);
    const { mode, src } = petBattleSprite(pet, sharedImages);
    const modeClass = sheet ? " pet-sprite-sheet"
        : layers ? " pet-sprite-layered"
        : mode === "fullBodySprite" ? " pet-sprite-fullbody"
        : " pet-sprite-circle-fallback";
    const poseClass = ` ${petAvatarStateClass(visualState, side)}`;
    // Glow collar equipped → wrap the pet in a colored aura during battle.
    // Prismatic collars cycle through the rainbow instead of a single color.
    const collarVisual = petCollarVisual(pet.loadout?.collar);
    const collarClass = collarVisual ? (collarVisual.prismatic ? " pet-collar-prismatic" : " pet-collar-glow") : "";
    return (
        <div
            className={`pet-battle-avatar pet-sprite ${side}${active ? " active" : ""}${hit ? " hit" : ""}${status?.poisoned ? " poisoned" : ""}${collarClass}${modeClass}${poseClass}`}
            style={collarVisual ? { ["--collar-glow" as string]: collarVisual.glow } : undefined}
        >
            {sheet ? (
                // Overflow window shows one frame; the strip (N× wide) is stepped
                // across by CSS. The window carries the enemy mirror so the frame
                // animation composes inside it. --frames drives the step count.
                <span className="pet-sprite-sheet-window" aria-hidden="false">
                    <img className="pet-sprite-sheet-strip" src={sheet.src} alt={pet.name} style={{ ["--frames" as string]: sheet.frames }} />
                </span>
            ) : layers ? (
                // Inner wrapper carries the enemy mirror so the per-layer
                // parallax transforms compose cleanly inside it. near layer is
                // last (front-most) and carries the alt text + drop shadow.
                <span className="pet-sprite-layers" aria-hidden="false">
                    <img className="pet-sprite-layer far" src={layers.far} alt="" />
                    <img className="pet-sprite-layer mid" src={layers.mid} alt="" />
                    <img className="pet-sprite-layer near" src={layers.near} alt={pet.name} />
                </span>
            ) : src ? <img src={src} alt={pet.name} /> : <span>{pet.name.slice(0, 2).toUpperCase()}</span>}
            {collarVisual?.prismatic && <span className="pet-collar-sparkles" aria-hidden="true" />}
        </div>
    );
}

export function PetArenaCard({ owner, pet, sharedImages = {} }: { owner: string; pet: Pet; sharedImages?: Record<string, string> }) {
    const petBaseId = pet.id.replace(/-\d{10,}$/, '');
    const img = sharedImages['pet:' + pet.id] || sharedImages['pet:' + petBaseId] || pet.image || '';
    // Native combat role (backfilled on load; derive as a fallback). Shown as a
    // colored badge so a player can read a pet's role + sub-role at a glance.
    const { role, subRole } = pet.role && pet.subRole ? { role: pet.role, subRole: pet.subRole } : derivePetRole(pet);
    const rm = ROLE_META[role];
    return (
        <div className="pet-arena-card">
            <div className="pet-arena-avatar">
                {img ? <img src={img} alt={petDisplayName(pet)} /> : <span>{petDisplayName(pet).slice(0, 2).toUpperCase()}</span>}
            </div>
            <div>
                <strong>{petDisplayName(pet)}</strong>
                {rm && (
                    <span
                        className="pet-role-badge"
                        title={`${rm.label} (${subRole}) — native combat role`}
                        style={{ marginLeft: 8, padding: "1px 7px", borderRadius: 999, border: `1px solid ${rm.color}`, color: rm.color, fontSize: "0.72em", fontWeight: 600, whiteSpace: "nowrap" }}
                    >
                        {rm.icon} {rm.label} · {subRole}
                    </span>
                )}
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
