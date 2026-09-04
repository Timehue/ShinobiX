import type { DuelEvent } from "./pet-duel-sim";
import type { PetSfxKind } from "./pet-sfx";
import type { WarfrontAttackCue } from "./pet-warfront-attack-causality";

export type WarfrontCoreElement = "Water" | "Fire" | "Wind" | "Earth";
export type WarfrontSpectacleShape = "ripple" | "flare" | "crescent" | "fault";

export type WarfrontElementSignature = Readonly<{
    element: WarfrontCoreElement;
    primary: string;
    highlight: string;
    shape: WarfrontSpectacleShape;
    travelBend: number;
    audioTell: PetSfxKind;
    audioContact: PetSfxKind;
    tellRate: number;
    contactRate: number;
}>;

export const WARFRONT_ELEMENT_SIGNATURES: Readonly<Record<WarfrontCoreElement, WarfrontElementSignature>> = Object.freeze({
    Water: { element: "Water", primary: "#45cfff", highlight: "#d9fbff", shape: "ripple", travelBend: 0.12, audioTell: "shield", audioContact: "hit", tellRate: 1.08, contactRate: 1.12 },
    Fire: { element: "Fire", primary: "#ff6238", highlight: "#ffd36a", shape: "flare", travelBend: -0.06, audioTell: "debuff", audioContact: "crit", tellRate: 1.08, contactRate: 1.08 },
    Wind: { element: "Wind", primary: "#75f1c5", highlight: "#effff8", shape: "crescent", travelBend: 0.2, audioTell: "dodge", audioContact: "hit", tellRate: 1.14, contactRate: 1.16 },
    Earth: { element: "Earth", primary: "#d9a45e", highlight: "#f3dfad", shape: "fault", travelBend: -0.1, audioTell: "command", audioContact: "crit", tellRate: 0.88, contactRate: 0.9 },
});

export function warfrontCoreElement(value: string | null | undefined): WarfrontCoreElement {
    if (value === "Fire" || value === "Wind" || value === "Earth") return value;
    return "Water";
}

export function warfrontElementSignature(value: string | null | undefined): WarfrontElementSignature {
    return WARFRONT_ELEMENT_SIGNATURES[warfrontCoreElement(value)];
}

/** The visible result is deliberately short: enough to confirm damage without
 * leaving residue under the next attack sentence. */
export const WARFRONT_SPECTACLE_RESULT_TICKS = 9;
export const WARFRONT_SPECTACLE_OVERLAP_CAP = 4;
export const WARFRONT_SPECTACLE_PARTICLE_CAP_DESKTOP = 16;
export const WARFRONT_SPECTACLE_PARTICLE_CAP_MOBILE = 8;
export const WARFRONT_HERO_ELEMENT: WarfrontCoreElement = "Fire";
export const WARFRONT_HERO_FLARE_MIN_PX = 48;
export const WARFRONT_HERO_TRAVEL_CORE_PX = 12;
export const WARFRONT_HERO_TRAVEL_PLUME_PX = 24;
/** A visible hero bolt must already read as a directed attack sentence on its
 * first travel frame, rather than as a detached spark near the attacker. */
export const WARFRONT_HERO_TRAVEL_MIN_SPAN_FRACTION = 1 / 3;
/** Contact keeps a short remnant of the same travel axis. This is a length,
 * not another effect layer, and fades on the existing result clock. */
export const WARFRONT_HERO_AXIS_TAIL_PX = 28;
export const WARFRONT_HERO_IMPACT_MIN_PX = 44;
export const WARFRONT_HERO_IMPACT_HOLD_TICKS = 2;
/** Damage text keeps its established third tick even though the white-hot
 * contact core now clears with the two-tick hit punctuation. */
export const WARFRONT_HERO_DAMAGE_HOLD_TICKS = 3;
export const WARFRONT_HERO_BURST_PX = 68;
export const WARFRONT_HERO_BURST_HOLD_TICKS = 2;
export const WARFRONT_HERO_CONTACT_TARGET_WIDTHS = 1.65;
export const WARFRONT_HERO_CONTACT_MIN_TARGET_WIDTHS = 1.5;
export const WARFRONT_HERO_CONTACT_MAX_TARGET_WIDTHS = 1.8;
/** Runtime derivative of the authored 1254px source kept beside it for
 * provenance. Both renderers use this exact decoded asset and hotspot. */
export const WARFRONT_HERO_FIRE_IMPACT_SPRITE_URL = "/assets/warfront/kage-fire-impact-burst-v1-512.png";
export const WARFRONT_HERO_FIRE_IMPACT_SPRITE_SOURCE_PX = 512;
export const WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_X = 0.6;
export const WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_Y = 0.5;
export const WARFRONT_HERO_FIRE_IMPACT_SPRITE_ASYMMETRY = "incoming-tail-left";
export const WARFRONT_HERO_FIRE_IMPACT_SPRITE_LEFT_RIGHT_REACH_RATIO = 1.5;
export const WARFRONT_HERO_CONTACT_LAYER_COUNT = 3;
export const WARFRONT_HERO_RESIDUE_LAYER_COUNT = 3;
export const WARFRONT_HERO_FIRE_CONTACT_LAYERS = Object.freeze([
    "incoming-axis-tail",
    "authored-asymmetric-fire-impact-sprite",
    "ember-smoke-scorch-residue",
] as const);
export const WARFRONT_HERO_FIRE_RESIDUE_LAYERS = Object.freeze([
    "scorch",
    "smoke",
    "embers",
] as const);
export const WARFRONT_HERO_FIRE_VFX_GRAMMAR = "fire-material-v4";
export const WARFRONT_HERO_FIRE_SHAPES = Object.freeze({
    windup: "licking-flame-cone",
    travel: "tapered-ember-bolt",
    contact: "authored-asymmetric-fire-impact-sprite",
    result: "smoke-ember-scorch",
} as const);

export type WarfrontSpectaclePhase = {
    visible: boolean;
    tell: number;
    travel: number;
    contact: number;
    result: number;
};

export type WarfrontHeroStage = "idle" | "windup" | "travel" | "contact" | "result";

export function warfrontHeroFireShape(stage: WarfrontHeroStage): string {
    return stage === "idle" ? "" : WARFRONT_HERO_FIRE_SHAPES[stage];
}

export const createWarfrontSpectaclePhase = (): WarfrontSpectaclePhase => ({
    visible: false,
    tell: 0,
    travel: 0,
    contact: 0,
    result: 0,
});

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function warfrontHeroTravelSpanFraction(progress: number): number {
    const visibleProgress = clamp01(progress);
    return visibleProgress > 0
        ? Math.max(WARFRONT_HERO_TRAVEL_MIN_SPAN_FRACTION, visibleProgress)
        : 0;
}

export function warfrontHeroAxisTailStrength(contact: number, result: number): number {
    return clamp01(Math.max(contact, result));
}

/** The contact silhouette is authored from the target's painted footprint,
 * not from viewport/device constants. The clamp is intentionally part of the
 * public contract so both renderers and release capture measure the same hit. */
export function warfrontHeroContactWidthPx(
    targetWidthPx: number,
    requestedTargetWidths = WARFRONT_HERO_CONTACT_TARGET_WIDTHS,
): number {
    const targetWidths = Math.max(
        WARFRONT_HERO_CONTACT_MIN_TARGET_WIDTHS,
        Math.min(WARFRONT_HERO_CONTACT_MAX_TARGET_WIDTHS, requestedTargetWidths),
    );
    return Math.max(1, targetWidthPx) * targetWidths;
}

export function warfrontSpectaclePhaseInto(
    cue: WarfrontAttackCue,
    tick: number,
    out: WarfrontSpectaclePhase,
): WarfrontSpectaclePhase {
    const lead = Math.max(1, cue.contactTick - cue.tellTick);
    const contactAge = tick - cue.contactTick;
    out.tell = tick < cue.tellTick || tick > cue.contactTick
        ? 0
        : Math.sin(clamp01((tick - cue.tellTick + 1) / lead) * Math.PI * 0.5);
    out.travel = tick < cue.contactTick - 5 || tick > cue.contactTick + 2
        ? 0
        : tick <= cue.contactTick
            ? clamp01((tick - (cue.contactTick - 5)) / 5)
            : 1 - clamp01(contactAge / 2);
    out.contact = contactAge < 0 || contactAge > 2 ? 0 : 1 - clamp01(contactAge / 2);
    out.result = contactAge <= 0 || contactAge > WARFRONT_SPECTACLE_RESULT_TICKS
        ? 0
        : 1 - clamp01(contactAge / WARFRONT_SPECTACLE_RESULT_TICKS);
    out.visible = out.tell > 0 || out.travel > 0 || out.contact > 0 || out.result > 0;
    return out;
}

export function warfrontHeroStage(phase: Readonly<WarfrontSpectaclePhase>): WarfrontHeroStage {
    if (phase.contact > 0) return "contact";
    if (phase.result > 0) return "result";
    if (phase.travel > 0) return "travel";
    if (phase.tell > 0) return "windup";
    return "idle";
}

/** The white-hot contact core and petal/ring layer share the same two-tick
 * punctuation. Its result tail still belongs to the shared nine-tick clock. */
export function warfrontHeroImpactHold(cue: Pick<WarfrontAttackCue, "contactTick">, tick: number): number {
    return tick >= cue.contactTick && tick < cue.contactTick + WARFRONT_HERO_IMPACT_HOLD_TICKS ? 1 : 0;
}

/** The larger flame-petal silhouette only punctuates the first two ticks. */
export function warfrontHeroBurstHold(cue: Pick<WarfrontAttackCue, "contactTick">, tick: number): number {
    return tick >= cue.contactTick && tick < cue.contactTick + WARFRONT_HERO_BURST_HOLD_TICKS ? 1 : 0;
}

/** Preserve the established legibility window for the authoritative damage
 * number without extending either contact VFX layer. */
export function warfrontHeroDamageHold(cue: Pick<WarfrontAttackCue, "contactTick">, tick: number): number {
    return tick >= cue.contactTick && tick < cue.contactTick + WARFRONT_HERO_DAMAGE_HOLD_TICKS ? 1 : 0;
}

export function warfrontSpectaclePriority(cue: WarfrontAttackCue, tick: number): number {
    const contactAge = Math.abs(tick - cue.contactTick);
    if (contactAge <= 2) return 400 - contactAge + (cue.lethal ? 40 : 0) + Math.min(3, cue.hits);
    if (tick < cue.contactTick) return 300 - contactAge;
    if (tick <= cue.contactTick + WARFRONT_SPECTACLE_RESULT_TICKS) return 200 - contactAge + (cue.lethal ? 20 : 0);
    return Number.NEGATIVE_INFINITY;
}

export function warfrontSpectacleParticleBudget(viewportMin: number, activeCues: number): number {
    const cap = viewportMin <= 720 ? WARFRONT_SPECTACLE_PARTICLE_CAP_MOBILE : WARFRONT_SPECTACLE_PARTICLE_CAP_DESKTOP;
    if (activeCues <= 0) return 0;
    return Math.max(1, Math.floor(cap / Math.min(WARFRONT_SPECTACLE_OVERLAP_CAP, activeCues)));
}

/** Release capture sentence: prefer a nonlethal player Fire strike with the
 * largest quiet window around contact, then retain deterministic event order. */
export function warfrontHeroAttackCue(cues: readonly WarfrontAttackCue[]): WarfrontAttackCue | null {
    const candidates = cues.filter((cue) => warfrontCoreElement(cue.element) === WARFRONT_HERO_ELEMENT);
    let selected: WarfrontAttackCue | null = null;
    let selectedTier = Number.NEGATIVE_INFINITY;
    let selectedIsolation = Number.NEGATIVE_INFINITY;
    for (const cue of candidates) {
        const tier = (cue.side === "player" ? 4 : 0)
            + (!cue.lethal ? 2 : 0)
            + (cue.contactTick - cue.tellTick >= 6 ? 1 : 0);
        let isolation = Number.POSITIVE_INFINITY;
        for (const other of cues) {
            if (other === cue) continue;
            isolation = Math.min(isolation, Math.abs(other.contactTick - cue.contactTick));
        }
        if (!Number.isFinite(isolation)) isolation = 999;
        if (tier > selectedTier
            || (tier === selectedTier && isolation > selectedIsolation)
            || (tier === selectedTier && isolation === selectedIsolation && selected && cue.contactTick < selected.contactTick)) {
            selected = cue;
            selectedTier = tier;
            selectedIsolation = isolation;
        }
    }
    return selected;
}

export type WarfrontAudioCue = Readonly<{
    tick: number;
    phase: "tell" | "contact" | "ultimate" | "ko";
    side: "player" | "enemy";
    element: WarfrontCoreElement;
    sfx: PetSfxKind;
    gain: number;
    playbackRate: number;
    pan: number;
    priority: number;
}>;

/** 133 ms at the authoritative 30 Hz clock: enough separation for short
 * impacts to stay articulate while a KO may still pre-empt a nearby hit. */
export const WARFRONT_AUDIO_MIN_GAP_TICKS = 4;

const audioPriority = (event: DuelEvent): number => event.type === "ko" ? 100
    : event.type === "ultimate" ? 80
        : event.type === "hit" && event.crit ? 70
            : event.type === "hit" ? 60
                : event.type === "cast" || event.type === "windup" ? 30
                    : -1;

/** One voice per authoritative tick. AOE records and simultaneous bookkeeping
 * collapse behind KO > ultimate > contact > tell, protecting the mobile mix. */
export function buildWarfrontAudioPlan(events: readonly DuelEvent[]): WarfrontAudioCue[] {
    const byTick = new Map<number, DuelEvent>();
    for (const event of events) {
        const priority = audioPriority(event);
        if (priority < 0) continue;
        const current = byTick.get(event.t);
        if (!current || priority > audioPriority(current)) byTick.set(event.t, event);
    }
    const selected: DuelEvent[] = [];
    for (const event of [...byTick.values()].sort((a, b) => a.t - b.t)) {
        const previous = selected.at(-1);
        if (!previous || event.t - previous.t >= WARFRONT_AUDIO_MIN_GAP_TICKS) {
            selected.push(event);
        } else if (audioPriority(event) > audioPriority(previous)) {
            selected[selected.length - 1] = event;
        }
    }
    return selected.map((event) => {
        const element = warfrontCoreElement(event.element);
        const signature = WARFRONT_ELEMENT_SIGNATURES[element];
        const ko = event.type === "ko";
        const ultimate = event.type === "ultimate";
        const contact = event.type === "hit";
        return {
            tick: event.t,
            phase: ko ? "ko" : ultimate ? "ultimate" : contact ? "contact" : "tell",
            side: event.side,
            element,
            sfx: ko ? "ko" : ultimate || contact ? signature.audioContact : signature.audioTell,
            gain: ko ? 0.82 : ultimate ? 0.68 : contact ? (event.crit ? 0.72 : 0.5) : 0.28,
            playbackRate: ko ? 0.94 : ultimate || contact ? signature.contactRate : signature.tellRate,
            pan: event.side === "player" ? -0.28 : 0.28,
            priority: audioPriority(event),
        };
    });
}
