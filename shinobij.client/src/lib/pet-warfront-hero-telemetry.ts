import { warfrontMetric } from './pet-warfront-telemetry';
import type { WarfrontAttackCue } from './pet-warfront-attack-causality';
import { WARFRONT_HERO_FIRE_VFX_GRAMMAR, WARFRONT_HERO_FLARE_MIN_PX, WARFRONT_HERO_TRAVEL_CORE_PX, WARFRONT_HERO_TRAVEL_PLUME_PX, WARFRONT_HERO_TRAVEL_MIN_SPAN_FRACTION, WARFRONT_HERO_AXIS_TAIL_PX, WARFRONT_HERO_BURST_PX, WARFRONT_HERO_BURST_HOLD_TICKS, WARFRONT_HERO_IMPACT_MIN_PX, WARFRONT_HERO_IMPACT_HOLD_TICKS, WARFRONT_HERO_CONTACT_LAYER_COUNT, WARFRONT_HERO_FIRE_CONTACT_LAYERS, WARFRONT_HERO_CONTACT_TARGET_WIDTHS, WARFRONT_HERO_FIRE_IMPACT_SPRITE_URL, WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_X, WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_Y, WARFRONT_HERO_FIRE_IMPACT_SPRITE_ASYMMETRY, WARFRONT_HERO_FIRE_IMPACT_SPRITE_LEFT_RIGHT_REACH_RATIO, WARFRONT_SPECTACLE_RESULT_TICKS, WARFRONT_HERO_RESIDUE_LAYER_COUNT, WARFRONT_HERO_FIRE_RESIDUE_LAYERS } from './pet-warfront-spectacle';

/** Both renderer routes expose the same authored hero timing and shape. */
export function writeWarfrontHeroMetrics(canvas: HTMLCanvasElement, heroCue: WarfrontAttackCue | null): void {
    warfrontMetric(canvas, "HeroElement", heroCue ? "Fire" : "");
    warfrontMetric(canvas, "HeroActor", heroCue?.actorId ?? "");
    warfrontMetric(canvas, "HeroTarget", heroCue?.targetId ?? "");
    warfrontMetric(canvas, "HeroTellTick", heroCue ? String(heroCue.tellTick) : "");
    warfrontMetric(canvas, "HeroContactTick", heroCue ? String(heroCue.contactTick) : "");
    warfrontMetric(canvas, "HeroVfxGrammar", heroCue ? WARFRONT_HERO_FIRE_VFX_GRAMMAR : "");
    warfrontMetric(canvas, "HeroFlareMinPx", heroCue ? String(WARFRONT_HERO_FLARE_MIN_PX) : "0");
    warfrontMetric(canvas, "HeroTravelCorePx", heroCue ? String(WARFRONT_HERO_TRAVEL_CORE_PX) : "0");
    warfrontMetric(canvas, "HeroTravelPlumePx", heroCue ? String(WARFRONT_HERO_TRAVEL_PLUME_PX) : "0");
    warfrontMetric(canvas, "HeroTravelMinSpanFraction", heroCue ? WARFRONT_HERO_TRAVEL_MIN_SPAN_FRACTION.toFixed(6) : "0");
    warfrontMetric(canvas, "HeroAxisTailPx", heroCue ? String(WARFRONT_HERO_AXIS_TAIL_PX) : "0");
    warfrontMetric(canvas, "HeroBurstPx", heroCue ? String(WARFRONT_HERO_BURST_PX) : "0");
    warfrontMetric(canvas, "HeroBurstHoldTicks", heroCue ? String(WARFRONT_HERO_BURST_HOLD_TICKS) : "0");
    warfrontMetric(canvas, "HeroImpactMinPx", heroCue ? String(WARFRONT_HERO_IMPACT_MIN_PX) : "0");
    warfrontMetric(canvas, "HeroImpactHoldTicks", heroCue ? String(WARFRONT_HERO_IMPACT_HOLD_TICKS) : "0");
    warfrontMetric(canvas, "HeroContactLayer", heroCue ? "target-anchored-authored-sprite" : "");
    warfrontMetric(canvas, "HeroContactLayerCount", heroCue ? String(WARFRONT_HERO_CONTACT_LAYER_COUNT) : "0");
    warfrontMetric(canvas, "HeroContactLayers", heroCue ? WARFRONT_HERO_FIRE_CONTACT_LAYERS.join(",") : "");
    warfrontMetric(canvas, "HeroContactTargetWidths", heroCue ? String(WARFRONT_HERO_CONTACT_TARGET_WIDTHS) : "0");
    warfrontMetric(canvas, "HeroContactFrontHoldTicks", heroCue ? String(WARFRONT_HERO_BURST_HOLD_TICKS) : "0");
    warfrontMetric(canvas, "HeroImpactSpriteUrl", heroCue ? WARFRONT_HERO_FIRE_IMPACT_SPRITE_URL : "");
    warfrontMetric(canvas, "HeroImpactSpriteAnchor", `${WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_X.toFixed(6)},${WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_Y.toFixed(6)}`);
    warfrontMetric(canvas, "HeroImpactSpriteAsymmetry", WARFRONT_HERO_FIRE_IMPACT_SPRITE_ASYMMETRY);
    warfrontMetric(canvas, "HeroImpactSpriteLeftRightReachRatio", WARFRONT_HERO_FIRE_IMPACT_SPRITE_LEFT_RIGHT_REACH_RATIO.toFixed(3));
    warfrontMetric(canvas, "HeroImpactLegacyPrimitiveDraws", "0");
    warfrontMetric(canvas, "HeroResidueTicks", heroCue ? String(WARFRONT_SPECTACLE_RESULT_TICKS) : "0");
    warfrontMetric(canvas, "HeroResidueLayerCount", heroCue ? String(WARFRONT_HERO_RESIDUE_LAYER_COUNT) : "0");
    warfrontMetric(canvas, "HeroResidueLayers", heroCue ? WARFRONT_HERO_FIRE_RESIDUE_LAYERS.join(",") : "");
}
