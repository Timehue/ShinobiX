export type ShowdownContactOutcome = "hit" | "block" | "miss";

interface ContactTarget { damage: number; guarded: boolean; heal?: number; applied?: string }

/** The engine omits dodged targets. A present zero-damage target without a
 * rider is a shield absorption, even when the pet was not holding Guard. */
export function showdownContactOutcome(target: ContactTarget | undefined): ShowdownContactOutcome {
    if (!target || target.applied === "failed") return "miss";
    if (target.guarded || target.applied === "protect") return "block";
    return target.damage > 0 || (target.heal ?? 0) > 0 || !!target.applied ? "hit" : "block";
}

/** Impact paint and the mechanic accent must show what actually landed.
 * Protect prevents on-hit riders, so a blocked burn must not paint flames. */
export function showdownContactEffectKind(moveKind: string, target: ContactTarget | undefined): string | null {
    if (!target) return null;
    const outcome = showdownContactOutcome(target);
    if (outcome === "miss") return null;
    if (outcome === "block" && target.damage === 0 && !(target.heal ?? 0)) return "protect";
    return moveKind;
}

/** Release/arrival sit outside the silhouettes, instead of inside the models.
 * Compress the offsets for very close endpoints so a shot cannot reverse. */
export function showdownProjectilePath(fromX: number, fromZ: number, toX: number, toZ: number, attackerRadius: number, defenderRadius: number) {
    const dx = toX - fromX, dz = toZ - fromZ;
    const distance = Math.hypot(dx, dz);
    const start = Math.max(0, attackerRadius) + 0.12, end = Math.max(0, defenderRadius) + 0.12;
    const scale = Math.min(1, Math.max(0, distance - 0.1) / (start + end));
    const ux = distance ? dx / distance : 0, uz = distance ? dz / distance : 1;
    return {
        fromX: fromX + ux * start * scale, fromZ: fromZ + uz * start * scale,
        toX: toX - ux * end * scale, toZ: toZ - uz * end * scale,
        dx: ux, dz: uz,
    };
}
