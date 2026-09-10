import { moveAccentFamily } from "./showdown-vfx-map";
import { showdownActionTargetId } from "./showdown-contact-vfx";

/** A primary silhouette, not a palette/rotation variant. Every value is an
 * independently staged geometry in PetShowdownTechniques. Utilities keep their
 * mechanic geometry; they never inherit a damage move's elemental set-piece. */
export const HERO_TECHNIQUES = ["jet", "comet", "blade", "storm", "eruption"] as const;
export type HeroTechnique = typeof HERO_TECHNIQUES[number];
export interface PresentationMove {
    name: string;
    kind: string;
    element: string;
    signature: boolean;
    cls?: string;
}
export interface MovePresentation {
    hero: HeroTechnique | null;
    grammar: string;
    /** The storm covers every landed enemy hit, including signature splash. */
    area?: boolean;
}

// The wire distinguishes the signature with `super`, including Gale Slash,
// which is both a regular technique and a signature in the actual catalog.
export const movePresentationKey = (name: string, signature: boolean) => `${signature ? 1 : 0}:${name}`;

export function showdownTechniqueHitIds(presentation: MovePresentation | undefined, event: {
    targetId?: string; targets: readonly { id: string; damage: number; splash?: boolean }[];
}): string[] {
    if (!presentation?.hero) return [];
    const primary = showdownActionTargetId(event);
    return event.targets.filter(t => t.damage > 0 && (presentation.area || (!t.splash && t.id === primary))).map(t => t.id);
}

function preferredHero(move: PresentationMove): HeroTechnique {
    if (move.signature) return "storm";
    if (move.kind === "crush") return "eruption";
    if (/blizzard|earthquake|thunder$|tempest$/i.test(move.name)) return "storm";
    if (/slash|blade|talon|lash|rake|fang/i.test(move.name) || move.cls === "physical") return "blade";
    if (move.element === "Earth") return "comet";
    if (move.element === "Wind") return "blade";
    return "jet";
}

/** Resolve the WHOLE loadout once. Reserve the signature's hero silhouette
 * first, then allocate different geometry to same-kind regular attacks. Power,
 * equipped gear, instance id and slot position cannot reshuffle the artwork. */
export function buildMovePresentations(moves: readonly PresentationMove[]): ReadonlyMap<string, MovePresentation> {
    const result = new Map<string, MovePresentation>();
    const used = new Set<string>();
    const ordered = [...moves].sort((a, b) => Number(b.signature) - Number(a.signature)
        || movePresentationKey(a.name, a.signature).localeCompare(movePresentationKey(b.name, b.signature), "en"));
    for (const move of ordered) {
        const key = movePresentationKey(move.name, move.signature);
        const elementalAttack = move.element !== "None" && (move.kind === "damage" || (move.kind === "crush" && move.element === "Earth"));
        const preferred = preferredHero(move);
        let hero: HeroTechnique | null = elementalAttack ? preferred : null;
        let grammar = hero ? `hero:${hero}` : `accent:${moveAccentFamily(move.kind) ?? move.kind}`;
        if (used.has(grammar)) {
            hero = [preferred, ...HERO_TECHNIQUES].find(candidate => !used.has(`hero:${candidate}`)) ?? null;
            // Current sealed kits have at most six moves and only damage
            // repeats. Refuse an unrepresentable future kit in roster checks.
            if (!hero) throw new Error(`No distinct move presentation remains for ${move.name}`);
            grammar = `hero:${hero}`;
        }
        used.add(grammar);
        result.set(key, { hero, grammar,
            ...(hero === "storm" && move.signature && move.element !== "None" ? { area: true } : {}) });
    }
    return result;
}

/** Unknown historical replay moves retain a deterministic, meaningful visual. */
export function resolveMovePresentation(moves: ReadonlyMap<string, MovePresentation> | undefined, event: {
    moveName: string; moveKind: string; element: string; super: boolean; delivery?: string;
}): MovePresentation {
    return moves?.get(movePresentationKey(event.moveName, event.super))
        ?? buildMovePresentations([{ name: event.moveName, kind: event.moveKind, element: event.element, signature: event.super,
            cls: event.delivery === "melee" ? "physical" : undefined }]).values().next().value!;
}

export function techniqueEnvelope(progress: number): number {
    return Math.max(0, Math.min(1, progress / 0.12, (1 - progress) / 0.32));
}

/** Contact is authoritative: a storm never blossoms on a dodge or full block. */
export function techniquePhase(progress: number, release: number, contact: number, end: number, outcome: "hit" | "block" | "miss") {
    if (progress < release || progress >= end) return null;
    const after = (progress - contact) / (end - contact);
    const hit = after >= 0 && outcome === "hit";
    if (after >= 0 && !hit) return null;
    const age = (progress - release) / (end - release);
    return { travel: Math.min(1, Math.max(0, (progress - release) / Math.max(.001, contact - release))), after, hit, age,
        fade: techniqueEnvelope(age), impactFade: hit ? techniqueEnvelope(after) : 0 };
}
