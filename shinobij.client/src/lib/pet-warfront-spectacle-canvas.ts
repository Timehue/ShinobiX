import {
    WARFRONT_HERO_AXIS_TAIL_PX,
    WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_X,
    WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_Y,
    WARFRONT_HERO_FLARE_MIN_PX,
    WARFRONT_HERO_TRAVEL_CORE_PX,
    WARFRONT_HERO_TRAVEL_PLUME_PX,
    warfrontHeroAxisTailStrength,
    warfrontHeroTravelSpanFraction,
    type WarfrontElementSignature,
} from "./pet-warfront-spectacle";

const TAU = Math.PI * 2;

function diamond(context: CanvasRenderingContext2D, radius: number): void {
    context.beginPath();
    context.moveTo(0, -radius);
    context.lineTo(radius, 0);
    context.lineTo(0, radius);
    context.lineTo(-radius, 0);
    context.closePath();
}

function curvedPoint(
    ox: number, oy: number, tx: number, ty: number, bend: number, progress: number,
): readonly [number, number] {
    const dx = tx - ox;
    const dy = ty - oy;
    const length = Math.max(1, Math.hypot(dx, dy));
    const cx = (ox + tx) * 0.5 - dy / length * length * bend;
    const cy = (oy + ty) * 0.5 + dx / length * length * bend;
    const inv = 1 - progress;
    return [
        inv * inv * ox + 2 * inv * progress * cx + progress * progress * tx,
        inv * inv * oy + 2 * inv * progress * cy + progress * progress * ty,
    ];
}

export function drawWarfrontElementTell(
    context: CanvasRenderingContext2D,
    signature: WarfrontElementSignature,
    x: number,
    y: number,
    radius: number,
    strength: number,
    seed: number,
): void {
    if (strength <= 0) return;
    const pulse = 0.84 + Math.sin(seed * 0.7 + strength * Math.PI) * 0.08;
    context.save();
    context.translate(x, y);
    context.strokeStyle = signature.primary;
    context.fillStyle = signature.highlight;
    context.lineCap = "round";
    context.lineWidth = Math.max(1, radius * 0.07);
    context.globalAlpha = 0.22 + strength * 0.58;
    if (signature.shape === "ripple") {
        for (const scale of [0.64, 1] as const) {
            context.beginPath();
            context.ellipse(0, radius * 0.18, radius * scale * pulse, radius * scale * 0.3, 0, 0, TAU);
            context.stroke();
        }
    } else if (signature.shape === "flare") {
        context.rotate(-0.08 + seed * 0.03);
        for (const side of [-1, 0, 1] as const) {
            context.beginPath();
            context.moveTo(side * radius * 0.18, radius * 0.42);
            context.quadraticCurveTo(side * radius * 0.42, -radius * 0.08, side * radius * 0.12, -radius * (0.72 + 0.12 * strength));
            context.quadraticCurveTo(0, -radius * 0.28, side * radius * 0.18, radius * 0.42);
            context.stroke();
        }
    } else if (signature.shape === "crescent") {
        context.rotate(seed * 0.21 + strength * 0.7);
        for (const flip of [0, Math.PI] as const) {
            context.beginPath();
            context.arc(0, 0, radius * (0.75 + strength * 0.12), flip - 1.08, flip + 1.08);
            context.stroke();
        }
    } else {
        context.rotate(Math.PI / 4);
        diamond(context, radius * pulse);
        context.stroke();
        context.globalAlpha *= 0.62;
        diamond(context, radius * 0.58);
        context.stroke();
    }
    context.restore();
}

/** A short moving tracer owns direction. It never becomes a full source-target
 * ribbon, so overlapping attacks cannot stripe the whole board. */
export function drawWarfrontElementTravel(
    context: CanvasRenderingContext2D,
    signature: WarfrontElementSignature,
    ox: number,
    oy: number,
    tx: number,
    ty: number,
    progress: number,
    strength: number,
    seed: number,
): void {
    if (strength <= 0 || progress <= 0) return;
    const tail = Math.max(0, progress - (signature.shape === "crescent" ? 0.3 : 0.2));
    context.save();
    context.strokeStyle = signature.primary;
    context.fillStyle = signature.highlight;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.globalAlpha = 0.28 + strength * 0.62;
    context.lineWidth = signature.shape === "fault" ? 2.8 : signature.shape === "flare" ? 2.2 : 1.7;
    context.beginPath();
    for (let step = 0; step <= 5; step++) {
        const p = tail + (progress - tail) * step / 5;
        const [x, y] = curvedPoint(ox, oy, tx, ty, signature.travelBend, p);
        if (step === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
    }
    context.stroke();
    const [headX, headY] = curvedPoint(ox, oy, tx, ty, signature.travelBend, progress);
    const before = curvedPoint(ox, oy, tx, ty, signature.travelBend, Math.max(0, progress - 0.02));
    const angle = Math.atan2(headY - before[1], headX - before[0]);
    context.translate(headX, headY);
    context.rotate(angle);
    if (signature.shape === "ripple") {
        context.beginPath(); context.arc(0, 0, 3.2, 0, TAU); context.fill();
        context.beginPath(); context.arc(-7, 0, 2, 0, TAU); context.stroke();
    } else if (signature.shape === "flare") {
        context.beginPath(); context.moveTo(6, 0); context.lineTo(-5, -4); context.lineTo(-2, 0); context.lineTo(-5, 4); context.closePath(); context.fill();
    } else if (signature.shape === "crescent") {
        context.beginPath(); context.arc(0, 0, 7, -1.15, 1.15); context.stroke();
    } else {
        context.rotate(Math.PI / 4 + seed * 0.04); diamond(context, 4.5); context.fill();
    }
    context.restore();
}

/** A filled, owner-local flame cone whose side licks stay visible around the
 * actor silhouette on the 412px route. Strength changes luminance, never its
 * locked 48px footprint. */
export function drawWarfrontHeroFireFlare(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    strength: number,
): void {
    if (strength <= 0) return;
    const half = WARFRONT_HERO_FLARE_MIN_PX * 0.5;
    context.save();
    context.translate(x, y);
    context.globalAlpha = 0.62 + Math.min(1, strength) * 0.34;
    context.shadowColor = "rgba(255, 61, 18, .94)";
    context.shadowBlur = 10;
    const crown = context.createLinearGradient(0, half, 0, -half);
    crown.addColorStop(0, "rgba(142, 34, 17, .88)");
    crown.addColorStop(0.42, "rgba(255, 79, 20, .96)");
    crown.addColorStop(0.74, "rgba(255, 165, 45, .98)");
    crown.addColorStop(1, "rgba(255, 239, 173, 1)");
    context.fillStyle = crown;
    context.beginPath();
    context.moveTo(-half, half * 0.76);
    context.bezierCurveTo(-half * 1.02, half * 0.24, -half * 0.96, -half * 0.26, -half * 0.64, -half * 0.7);
    context.bezierCurveTo(-half * 0.68, -half * 0.18, -half * 0.44, half * 0.05, -half * 0.32, half * 0.3);
    context.bezierCurveTo(-half * 0.38, -half * 0.16, -half * 0.2, -half * 0.72, -half * 0.02, -half);
    context.bezierCurveTo(half * 0.16, -half * 0.58, half * 0.1, -half * 0.08, half * 0.24, half * 0.2);
    context.bezierCurveTo(half * 0.3, -half * 0.22, half * 0.56, -half * 0.64, half * 0.74, -half * 0.82);
    context.bezierCurveTo(half * 0.72, -half * 0.18, half * 1.02, half * 0.22, half, half * 0.74);
    context.quadraticCurveTo(0, half, -half, half * 0.76);
    context.closePath();
    context.fill();
    context.strokeStyle = "rgba(255, 116, 31, .98)";
    context.lineWidth = 2.4;
    context.stroke();
    context.globalCompositeOperation = "lighter";
    context.shadowBlur = 5;
    context.fillStyle = "rgba(255, 237, 165, .9)";
    for (const [offset, height, lean] of [[-0.48, 0.7, -0.12], [0, 0.86, 0.06], [0.5, 0.64, 0.13]] as const) {
        context.beginPath();
        context.moveTo(half * (offset - 0.17), half * 0.72);
        context.bezierCurveTo(
            half * (offset - 0.25), half * 0.24,
            half * (offset + lean - 0.08), -half * height * 0.52,
            half * (offset + lean), -half * height,
        );
        context.bezierCurveTo(
            half * (offset + lean + 0.12), -half * height * 0.36,
            half * (offset + 0.26), half * 0.26,
            half * (offset + 0.18), half * 0.72,
        );
        context.closePath();
        context.fill();
    }
    context.fillStyle = "rgba(255, 125, 31, .92)";
    for (const [ex, ey, size] of [[-0.82, -0.12, 1.7], [0.86, 0.08, 1.4], [-0.66, -0.55, 1.2]] as const) {
        context.beginPath();
        context.arc(ex * half, ey * half, size, 0, TAU);
        context.fill();
    }
    context.restore();
}

/** The hero bolt grows continuously from its owner to the live head. Its outer
 * flame tapers from a narrow source to the locked 12px core while a 24px lick
 * and three detached embers make motion legible without widening the board. */
export function drawWarfrontHeroFireCorridor(
    context: CanvasRenderingContext2D,
    ox: number,
    oy: number,
    tx: number,
    ty: number,
    progress: number,
    strength: number,
): void {
    if (progress <= 0 || strength <= 0) return;
    const end = warfrontHeroTravelSpanFraction(progress);
    const points = Array.from({ length: 19 }, (_, step) => {
        const p = end * step / 18;
        const point = curvedPoint(ox, oy, tx, ty, 0, p);
        const previous = curvedPoint(ox, oy, tx, ty, 0, Math.max(0, p - end / 36));
        const next = curvedPoint(ox, oy, tx, ty, 0, Math.min(end, p + end / 36));
        const tangentX = next[0] - previous[0];
        const tangentY = next[1] - previous[1];
        const tangentLength = Math.max(0.001, Math.hypot(tangentX, tangentY));
        return {
            x: point[0],
            y: point[1],
            nx: -tangentY / tangentLength,
            ny: tangentX / tangentLength,
            fraction: step / 18,
        };
    });
    const gradient = context.createLinearGradient(ox, oy, tx, ty);
    gradient.addColorStop(0, "rgba(139, 39, 20, .38)");
    gradient.addColorStop(Math.max(0.08, end * 0.64), "rgba(255, 84, 23, .84)");
    gradient.addColorStop(1, "rgba(255, 185, 65, .98)");
    context.save();
    context.globalCompositeOperation = "lighter";
    context.globalAlpha = 0.58 + Math.min(1, strength) * 0.4;
    context.shadowColor = "rgba(255, 66, 20, .88)";
    context.shadowBlur = 8;
    context.fillStyle = gradient;
    context.beginPath();
    for (let index = 0; index < points.length; index++) {
        const point = points[index];
        const lick = Math.sin(index * 1.9) * 0.7 * point.fraction;
        const halfWidth = 1.2 + point.fraction * (WARFRONT_HERO_TRAVEL_CORE_PX * 0.5 - 1.2) + lick;
        const x = point.x + point.nx * halfWidth;
        const y = point.y + point.ny * halfWidth;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
    }
    for (let index = points.length - 1; index >= 0; index--) {
        const point = points[index];
        const lick = Math.cos(index * 1.6) * 0.65 * point.fraction;
        const halfWidth = 1.2 + point.fraction * (WARFRONT_HERO_TRAVEL_CORE_PX * 0.5 - 1.2) + lick;
        context.lineTo(point.x - point.nx * halfWidth, point.y - point.ny * halfWidth);
    }
    context.closePath();
    context.fill();
    context.strokeStyle = "rgba(255, 231, 151, .94)";
    context.lineWidth = 2.1;
    context.beginPath();
    for (let index = 0; index < points.length; index++) {
        const point = points[index];
        const hotOffset = Math.sin(index * 1.35) * 0.55 * point.fraction;
        if (index === 0) context.moveTo(point.x + point.nx * hotOffset, point.y + point.ny * hotOffset);
        else context.lineTo(point.x + point.nx * hotOffset, point.y + point.ny * hotOffset);
    }
    context.stroke();
    const [headX, headY] = curvedPoint(ox, oy, tx, ty, 0, end);
    const before = curvedPoint(ox, oy, tx, ty, 0, Math.max(0, end - 0.025));
    const angle = Math.atan2(headY - before[1], headX - before[0]);
    context.translate(headX, headY);
    context.rotate(angle);
    const plume = context.createLinearGradient(-WARFRONT_HERO_TRAVEL_PLUME_PX, 0, 0, 0);
    plume.addColorStop(0, "rgba(255, 55, 20, 0)");
    plume.addColorStop(0.45, "rgba(255, 76, 20, .88)");
    plume.addColorStop(1, "rgba(255, 196, 71, .98)");
    context.fillStyle = plume;
    const plumeLength = WARFRONT_HERO_TRAVEL_PLUME_PX;
    context.beginPath();
    context.moveTo(2, 0);
    context.bezierCurveTo(-plumeLength * 0.18, -8, -plumeLength * 0.34, -7, -plumeLength * 0.48, -3);
    context.bezierCurveTo(-plumeLength * 0.58, -7, -plumeLength * 0.78, -5, -plumeLength, -1);
    context.bezierCurveTo(-plumeLength * 0.7, 0, -plumeLength * 0.6, 3, -plumeLength * 0.72, 6);
    context.bezierCurveTo(-plumeLength * 0.34, 5, -plumeLength * 0.14, 7, 2, 0);
    context.closePath();
    context.fill();
    context.fillStyle = "rgba(255, 110, 28, .86)";
    for (let ember = 0; ember < 3; ember++) {
        const back = plumeLength * (0.38 + ember * 0.24);
        const side = (ember % 2 === 0 ? -1 : 1) * (3.5 + ember);
        context.save();
        context.translate(-back, side);
        context.rotate(0.42 + ember * 0.31);
        const size = 2.4 - ember * 0.4;
        context.fillRect(-size, -size * 0.42, size * 2, size * 0.84);
        context.restore();
    }
    context.shadowBlur = 9;
    context.fillStyle = "#fff4ce";
    context.beginPath();
    context.arc(0, 0, WARFRONT_HERO_TRAVEL_CORE_PX * 0.5, 0, TAU);
    context.fill();
    context.restore();
}

export function drawWarfrontHeroFireImpact(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    contactWidthPx: number,
    contact: number,
    burst: number,
    result: number,
    seed: number,
    impactSprite: CanvasImageSource,
    incomingAngle = 0,
): void {
    const strength = Math.max(contact, burst, result);
    if (strength <= 0) return;
    context.save();
    context.translate(x, y);
    context.rotate(incomingAngle);
    const axisTailStrength = warfrontHeroAxisTailStrength(contact, result);
    if (axisTailStrength > 0) {
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha = 0.42 + axisTailStrength * 0.58;
        context.shadowColor = "rgba(255, 72, 20, .92)";
        context.shadowBlur = 8;
        const tail = context.createLinearGradient(-WARFRONT_HERO_AXIS_TAIL_PX, 0, 2, 0);
        tail.addColorStop(0, "rgba(255, 55, 18, 0)");
        tail.addColorStop(0.38, `rgba(255, 81, 20, ${0.58 * axisTailStrength})`);
        tail.addColorStop(0.76, `rgba(255, 187, 67, ${0.94 * axisTailStrength})`);
        tail.addColorStop(1, `rgba(255, 249, 214, ${axisTailStrength})`);
        context.fillStyle = tail;
        context.beginPath();
        context.moveTo(3, 0);
        context.bezierCurveTo(-6, -5.8, -WARFRONT_HERO_AXIS_TAIL_PX * 0.58, -4.2, -WARFRONT_HERO_AXIS_TAIL_PX, 0);
        context.bezierCurveTo(-WARFRONT_HERO_AXIS_TAIL_PX * 0.58, 4.2, -6, 5.8, 3, 0);
        context.closePath();
        context.fill();
        context.strokeStyle = `rgba(255, 244, 190, ${0.92 * axisTailStrength})`;
        context.lineWidth = 1.35;
        context.beginPath();
        context.moveTo(-WARFRONT_HERO_AXIS_TAIL_PX * 0.82, 0);
        context.lineTo(2, 0);
        context.stroke();
        context.restore();
    }
    if (result > 0) {
        const residueAge = 1 - result;
        const residueSpan = contactWidthPx * (0.84 + residueAge * 0.1);
        context.save();
        context.globalCompositeOperation = "source-over";
        const scorch = context.createRadialGradient(
            residueSpan * 0.05,
            residueSpan * 0.04,
            residueSpan * 0.03,
            residueSpan * 0.05,
            residueSpan * 0.04,
            residueSpan * 0.5,
        );
        scorch.addColorStop(0, `rgba(25, 11, 10, ${0.82 * result})`);
        scorch.addColorStop(0.48, `rgba(68, 25, 20, ${0.74 * result})`);
        scorch.addColorStop(0.76, `rgba(151, 47, 25, ${0.56 * result})`);
        scorch.addColorStop(0.91, `rgba(255, 91, 29, ${0.42 * result})`);
        scorch.addColorStop(1, "rgba(44, 14, 12, 0)");
        context.fillStyle = scorch;
        context.beginPath();
        context.ellipse(
            residueSpan * 0.04,
            residueSpan * 0.12,
            residueSpan * 0.5,
            residueSpan * 0.19,
            -0.08,
            0,
            TAU,
        );
        context.fill();
        context.strokeStyle = `rgba(255, 103, 34, ${0.68 * result})`;
        context.lineWidth = Math.max(1.8, residueSpan * 0.018);
        context.beginPath();
        context.ellipse(
            residueSpan * 0.03,
            residueSpan * 0.1,
            residueSpan * 0.38,
            residueSpan * 0.12,
            -0.08,
            -0.82,
            0.78,
        );
        context.stroke();
        context.restore();

        // Smoke rises in screen space while the scorch retains the incoming
        // strike direction. Dense charcoal bodies and warm undersides make the
        // nine-tick tail read as material rather than transparent decoration.
        context.save();
        context.rotate(-incomingAngle);
        for (let smoke = 0; smoke < 4; smoke++) {
            const drift = residueAge * residueSpan * (0.2 + smoke * 0.045);
            const smokeX = residueSpan * (-0.16 + smoke * 0.105) + Math.sin(seed * 4 + smoke) * residueSpan * 0.025;
            const smokeY = -residueSpan * (0.1 + smoke * 0.035) - drift;
            context.fillStyle = `rgba(${91 + smoke * 7}, ${77 + smoke * 6}, ${72 + smoke * 5}, ${(0.62 - smoke * 0.05) * result})`;
            context.beginPath();
            context.ellipse(
                smokeX,
                smokeY,
                residueSpan * (0.145 + smoke * 0.012),
                residueSpan * (0.095 + smoke * 0.012),
                -0.14 + smoke * 0.19,
                0,
                TAU,
            );
            context.fill();
            context.fillStyle = `rgba(205, 76, 34, ${(0.2 - smoke * 0.025) * result})`;
            context.beginPath();
            context.ellipse(
                smokeX,
                smokeY + residueSpan * 0.03,
                residueSpan * (0.09 + smoke * 0.008),
                residueSpan * 0.035,
                -0.14 + smoke * 0.19,
                0,
                TAU,
            );
            context.fill();
        }
        context.restore();
    }
    const spriteStrength = Math.max(contact, burst);
    if (spriteStrength > 0) {
        context.save();
        // The authored image contains its own white-hot core and material edge.
        // Source-over preserves its dark smoke/ember contour; additive blending
        // would collapse it back into the circular flash this replaces.
        context.globalCompositeOperation = "source-over";
        context.globalAlpha = spriteStrength;
        context.drawImage(
            impactSprite,
            -contactWidthPx * WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_X,
            -contactWidthPx * WARFRONT_HERO_FIRE_IMPACT_SPRITE_ANCHOR_Y,
            contactWidthPx,
            contactWidthPx,
        );
        context.restore();
    }
    if (result > 0) {
        const residueAge = 1 - result;
        context.globalCompositeOperation = "lighter";
        context.strokeStyle = `rgba(255, 104, 29, ${0.76 * result})`;
        context.lineWidth = Math.max(1.8, contactWidthPx * 0.015);
        context.fillStyle = `rgba(255, 151, 45, ${0.86 * result})`;
        for (let ember = 0; ember < 5; ember++) {
            const angle = -0.78 + ember * 0.39 + Math.sin(seed + ember) * 0.1;
            const travel = contactWidthPx * (0.14 + residueAge * (0.24 + ember * 0.025));
            const ex = Math.cos(angle) * travel;
            const ey = Math.sin(angle) * travel - residueAge * contactWidthPx * 0.22;
            context.save();
            context.translate(ex, ey);
            context.rotate(angle);
            context.beginPath();
            const emberSize = Math.max(2.6, contactWidthPx * (0.028 - ember * 0.0015));
            context.moveTo(emberSize, 0);
            context.lineTo(-emberSize * 0.65, -emberSize * 0.44);
            context.lineTo(-emberSize * 0.3, emberSize * 0.47);
            context.closePath();
            context.fill();
            context.restore();
        }
    }
    context.restore();
}

export function drawWarfrontHeroHealthFeedback(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    hpBefore: number,
    hpAfter: number,
    maxHp: number,
    teamColor: string,
    strength: number,
): void {
    if (strength <= 0 || maxHp <= 0) return;
    const before = Math.max(0, Math.min(1, hpBefore / maxHp));
    const after = Math.max(0, Math.min(before, hpAfter / maxHp));
    const loss = Math.max(0, before - after);
    const width = 48;
    const height = 5;
    context.save();
    context.translate(Math.round(x - width * 0.5), Math.round(y));
    context.globalAlpha = 0.42 + strength * 0.58;
    context.fillStyle = "rgba(2, 7, 10, .9)";
    context.fillRect(-2, -2, width + 4, height + 4);
    context.fillStyle = teamColor;
    context.fillRect(0, 0, width * after, height);
    context.fillStyle = "#ffba55";
    context.fillRect(width * after, 0, Math.max(2, width * loss), height);
    context.fillStyle = "#fff0c2";
    context.font = "700 11px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "bottom";
    context.shadowColor = "#050809";
    context.shadowBlur = 3;
    context.fillText(`−${Math.max(1, Math.round(hpBefore - hpAfter))}`, width * 0.5, -4);
    context.restore();
}

export function drawWarfrontElementResult(
    context: CanvasRenderingContext2D,
    signature: WarfrontElementSignature,
    x: number,
    y: number,
    radius: number,
    contact: number,
    result: number,
    particleBudget: number,
    seed: number,
): void {
    const strength = Math.max(contact, result);
    if (strength <= 0) return;
    const expansion = 0.55 + (1 - strength) * 0.65;
    context.save();
    context.translate(x, y);
    context.strokeStyle = signature.primary;
    context.fillStyle = signature.highlight;
    context.lineCap = "round";
    context.lineWidth = Math.max(1, radius * 0.065);
    context.globalAlpha = 0.18 + strength * 0.72;
    if (signature.shape === "ripple") {
        context.beginPath(); context.ellipse(0, 2, radius * expansion, radius * expansion * 0.38, 0, 0, TAU); context.stroke();
        context.globalAlpha *= 0.65;
        context.beginPath(); context.ellipse(0, 2, radius * expansion * 0.58, radius * expansion * 0.22, 0, 0, TAU); context.stroke();
    } else if (signature.shape === "flare") {
        const rays = 6;
        context.beginPath();
        for (let ray = 0; ray < rays; ray++) {
            const angle = seed + ray / rays * TAU;
            context.moveTo(Math.cos(angle) * radius * 0.16, Math.sin(angle) * radius * 0.16);
            context.lineTo(Math.cos(angle) * radius * (0.55 + expansion * 0.3), Math.sin(angle) * radius * (0.55 + expansion * 0.3));
        }
        context.stroke();
        context.globalAlpha *= 0.72;
        context.beginPath(); context.arc(0, 0, radius * 0.18 * strength, 0, TAU); context.fill();
    } else if (signature.shape === "crescent") {
        context.rotate(seed * 0.17 + (1 - strength) * 0.8);
        context.beginPath(); context.arc(0, 0, radius * expansion, -1.2, 1.2); context.stroke();
        context.rotate(Math.PI);
        context.beginPath(); context.arc(0, 0, radius * expansion * 0.78, -1.05, 1.05); context.stroke();
    } else {
        context.rotate(Math.PI / 4);
        diamond(context, radius * expansion * 0.72); context.stroke();
        context.beginPath(); context.moveTo(-radius * 0.65, 0); context.lineTo(radius * 0.65, 0); context.moveTo(0, -radius * 0.65); context.lineTo(0, radius * 0.65); context.stroke();
    }
    context.globalAlpha = result * 0.58;
    const particles = Math.max(0, Math.min(4, particleBudget));
    for (let index = 0; index < particles; index++) {
        const angle = seed * 0.83 + index / Math.max(1, particles) * TAU;
        const travel = radius * (0.3 + (1 - result) * (signature.shape === "flare" ? 1.05 : 0.8));
        const px = Math.cos(angle) * travel;
        const py = Math.sin(angle) * travel - (signature.shape === "flare" ? (1 - result) * radius * 0.7 : 0);
        context.save();
        context.translate(px, py);
        context.rotate(angle + (1 - result) * 2.4);
        if (signature.shape === "ripple") { context.beginPath(); context.ellipse(0, 0, 1.8, 4.2, 0, 0, TAU); context.fill(); }
        else if (signature.shape === "flare") { context.fillRect(-1.2, -4, 2.4, 8); }
        else if (signature.shape === "crescent") { context.beginPath(); context.arc(0, 0, 4, -1, 1); context.stroke(); }
        else { diamond(context, 3.2); context.fill(); }
        context.restore();
    }
    context.restore();
}
