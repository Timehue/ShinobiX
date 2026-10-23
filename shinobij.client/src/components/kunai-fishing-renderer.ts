import { KUNAI_HAUL_MS, KUNAI_RETURN_MS, kunaiFish, kunaiFlightMs, kunaiShoal, scoreKunaiFishing, type KunaiThrow } from '../../../shared/kunai-fishing';
import { clamp01, smooth, mix, kunaiRestPose, kunaiThrowPose, kunaiReturnPose, hauledFishPose, outmatchedFishPose, attachedKunaiPose, weaponRing, kunaiWindupMs, fishSpineMotion, type KunaiPose } from './kunai-fishing-motion';

export type FishArt = { image: HTMLImageElement; shadow?: HTMLCanvasElement };
export type GearArt = { hands: HTMLImageElement[]; kunai: HTMLImageElement[] };

/** Twenty overlapping skin strips bend around a traveling spine wave; the head stays steady. */
function fish(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, angle: number, index: number, phase: number, art: FishArt | undefined, agitation: number, reduced: boolean) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    const image = art?.image;
    if (!image?.complete || !image.naturalWidth) {
        ctx.fillStyle = '#a5c2b8'; ctx.beginPath(); ctx.ellipse(0, 0, size * .34, size * .11, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return;
    }
    const height = size * image.naturalHeight / image.naturalWidth;
    const shadow = art?.shadow;
    if (shadow) {
        ctx.save(); ctx.globalAlpha *= .3; ctx.drawImage(shadow, -size * .5 + 2, -height * .5 + 7, size, height); ctx.restore();
    }
    const amplitude = reduced ? 0 : size * (.042 + agitation * .033);
    const wave = (s: number) => Math.sin(phase - s * 5.2 + index * 1.7) * (1 - s) ** 2 * amplitude;
    for (let n = 0; n < 20; n++) {
        const start = n / 20, end = (n + 1) / 20, middle = (start + end) * .5;
        const slope = (wave(middle + .002) - wave(middle - .002)) / (.004 * size);
        const sx = start * image.naturalWidth, sw = Math.min(image.naturalWidth - sx, image.naturalWidth / 20 + 2);
        ctx.save(); ctx.translate((middle - .5) * size, wave(middle)); ctx.rotate(Math.atan(slope));
        ctx.drawImage(image, sx, 0, sw, image.naturalHeight, -size / 40, -height * .5, sw / image.naturalWidth * size, height); ctx.restore();
    }
    if (!reduced) {
        ctx.strokeStyle = '#d5e8da2b'; ctx.lineWidth = .7;
        for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(-size * .45, side * height * .18); ctx.quadraticCurveTo(-size * .65, side * height * .33, -size * .82, side * height * .26); ctx.stroke(); }
    }
    ctx.restore();
}

function blade(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, scale: number, golden: boolean, image?: HTMLImageElement) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.scale(scale, scale);
    ctx.shadowColor = '#00141c88'; ctx.shadowBlur = 7; ctx.shadowOffsetY = 3;
    if (image?.complete && image.naturalWidth) { const height = 70 * image.naturalHeight / image.naturalWidth; ctx.drawImage(image, -35, -height / 2, 70, height); ctx.restore(); return; }
    ctx.strokeStyle = '#d9c496'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(-28, 0, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#263239'; ctx.fillRect(-24, -4, 19, 8);
    ctx.strokeStyle = '#bca475'; ctx.lineWidth = 1.5;
    for (let n = -22; n < -6; n += 4) { ctx.beginPath(); ctx.moveTo(n, -4); ctx.lineTo(n + 3, 4); ctx.stroke(); }
    ctx.fillStyle = golden ? '#eed28d' : '#cbd9db'; ctx.beginPath(); ctx.moveTo(-6, -11); ctx.lineTo(35, 0); ctx.lineTo(-6, 11); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = golden ? '#a47a38' : '#738d96'; ctx.beginPath(); ctx.moveTo(-6, 11); ctx.lineTo(35, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
    ctx.restore();
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, age: number, hit: boolean, unit: number, reduced: boolean) {
    if (age < 0 || age > 900) return;
    const t = reduced ? .45 : age / 900;
    ctx.save(); ctx.globalAlpha = (1 - t) * .75; ctx.strokeStyle = hit ? '#f4dc9c' : '#dae9d5'; ctx.lineWidth = 1.5;
    for (let n = 0; n < 2; n++) { ctx.beginPath(); ctx.ellipse(x, y, (12 + t * 60 + n * 9) * unit, (7 + t * 35 + n * 6) * unit, 0, 0, Math.PI * 2); ctx.stroke(); }
    if (!reduced) for (let n = 0; n < 9; n++) {
        const a = n * 2.4, r = (8 + t * 65) * unit;
        ctx.fillStyle = '#e1eee0'; ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * r, y + Math.sin(a) * r * .55 - Math.sin(t * Math.PI) * 24 * unit, 2 * unit, 4 * unit, a, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
}


export function drawKunaiFishing(ctx: CanvasRenderingContext2D, width: number, height: number, image: HTMLImageElement,
    seed: number, at: number, shots: KunaiThrow[], aim: { x: number; y: number }, golden: boolean, reduced: boolean, art: FishArt[] = [], skillLevel?: number, gear?: GearArt) {
    const state = scoreKunaiFishing(seed, shots, at, true, skillLevel)!;
    const shoal = skillLevel != null ? kunaiShoal(skillLevel) : undefined;
    const w = width, h = height, unit = Math.max(.55, Math.min(1, w / 700));
    ctx.clearRect(0, 0, w, h);
    if (image.complete && image.naturalWidth) {
        const ratio = Math.max(w / image.naturalWidth, h / image.naturalHeight);
        ctx.drawImage(image, (w - image.naturalWidth * ratio) / 2, h - image.naturalHeight * ratio, image.naturalWidth * ratio, image.naturalHeight * ratio);
    } else {
        const water = ctx.createLinearGradient(0, 0, w, h); water.addColorStop(0, '#265858'); water.addColorStop(.5, '#113c48'); water.addColorStop(1, '#1c5053'); ctx.fillStyle = water; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#554c3d'; ctx.fillRect(0, h * .88, w, h * .12);
    }
    const shade = ctx.createLinearGradient(0, 0, 0, h); shade.addColorStop(0, '#071c2530'); shade.addColorStop(.7, '#0b293000'); shade.addColorStop(1, '#07101880'); ctx.fillStyle = shade; ctx.fillRect(0, 0, w, h);
    if (!reduced) {
        ctx.strokeStyle = '#c5e2c215'; ctx.lineWidth = 1;
        for (let n = 0; n < 12; n++) {
            const x = ((n * .137 + at / 180000) % 1) * w, y = (.15 + (n * .173 % .57)) * h;
            ctx.beginPath(); ctx.ellipse(x, y, (14 + n % 4 * 9) * unit, 3 * unit, -.2, 0, Math.PI); ctx.stroke();
        }
    }
    const struck = state.hit !== -1 && at >= state.impactAt;
    const hauling = struck && !state.blocked, resisting = struck && state.blocked;
    const last = shots.at(-1), age = last ? at - last.at : 0;
    const flight = last ? kunaiFlightMs(last) : 0, haulAge = struck ? at - state.impactAt : 0;
    const rest = kunaiRestPose(w, h, aim, unit);
    let caught: KunaiPose | undefined, caughtStart: KunaiPose | undefined;
    const labels: { x: number; y: number; text: string; locked: boolean; width: number }[] = [];
    for (let index = 0; index < 3; index++) {
        const point = kunaiFish(seed, index, at, state.misses), next = kunaiFish(seed, index, at + 40, state.misses);
        let pose = { x: point.x / 100 * w, y: point.y / 100 * h, angle: Math.atan2((next.y - point.y) * h, (next.x - point.x) * w) };
        if (hauling && index === state.hit && last) {
            pose = hauledFishPose(seed, index, last, haulAge, w, h, state.misses); caught = pose;
            caughtStart = hauledFishPose(seed, index, last, 0, w, h, state.misses);
        }
        if (resisting && index === state.hit && last) pose = outmatchedFishPose(seed, index, last, haulAge, w, h, state.misses);
        const motion = fishSpineMotion(index, at, state.misses, struck && index === state.hit ? state.impactAt : undefined);
        ctx.globalAlpha = hauling && index !== state.hit ? mix(.93, .75, smooth(haulAge / 260)) : .93;
        if (resisting && index === state.hit) ctx.globalAlpha *= 1 - smooth((haulAge - 500) / 700);
        const species = shoal?.[index], size = Math.max(48, Math.min(120, w * .15)) * (species?.size ?? 1);
        fish(ctx, pose.x, pose.y, size, pose.angle, index, motion.phase, art[species?.art ?? index], motion.agitation, reduced);
        if (species && !(struck && index === state.hit)) {
            ctx.font = `${w < 480 ? 9 : 10}px system-ui`;
            const locked = species.level > skillLevel!, text = `${species.label} · Lv${species.level}`, width = ctx.measureText(text).width + (locked ? 23 : 16);
            let y = pose.y + Math.abs(Math.sin(pose.angle)) * size * .45 + 18;
            if (y > h * .82) y = pose.y - Math.abs(Math.sin(pose.angle)) * size * .45 - 22;
            const x = Math.max(width / 2 + 4, Math.min(w - width / 2 - 4, pose.x));
            for (const other of labels) if (Math.abs(other.x - x) < (other.width + width) / 2 + 3 && Math.abs(other.y - y) < 21) y += y > h * .6 ? -22 : 22;
            labels.push({ x, y: Math.max(44, Math.min(h - 24, y)), text, locked, width });
        }
    }
    ctx.globalAlpha = 1;
    let pose = rest;
    if (last && age < flight) pose = kunaiThrowPose(w, h, last, age, unit, reduced);
    else if (last && caught && caughtStart) pose = attachedKunaiPose(w, h, last, caught, caughtStart, haulAge, unit, reduced);
    else if (last && resisting) pose = kunaiReturnPose(w, h, last, Math.max(0, haulAge - 300) / (KUNAI_HAUL_MS - 300) * KUNAI_RETURN_MS, unit, reduced);
    else if (last && age < flight + KUNAI_RETURN_MS) pose = kunaiReturnPose(w, h, last, age - flight, unit, reduced);
    const reel = { x: w * .5 - 21.4 * unit, y: h - 25.3 * unit }, end = weaponRing(pose, unit);
    const retrieving = struck || state.phase === 'returning';
    const paid = last && age >= kunaiWindupMs(last) && age < flight;
    const slack = retrieving ? mix(13, 2, smooth((hauling ? haulAge : age - flight) / 160)) : paid ? (10 + Math.sin(clamp01(age / flight) * Math.PI) * 14) : 14;
    ctx.strokeStyle = '#071e287a'; ctx.lineWidth = 3 * unit; ctx.beginPath(); ctx.moveTo(reel.x, reel.y);
    ctx.bezierCurveTo(mix(reel.x, end.x, .3) - 6 * unit, mix(reel.y, end.y, .3) + slack * unit,
        mix(reel.x, end.x, .7) + 3 * unit, mix(reel.y, end.y, .7) + slack * unit, end.x, end.y); ctx.stroke();
    ctx.strokeStyle = '#c8c6ac'; ctx.lineWidth = 1.2 * unit; ctx.stroke();
    if (last) for (const shot of shots) ring(ctx, shot.x / 100 * w, shot.y / 100 * h, at - shot.at - kunaiFlightMs(shot), shot === last && state.hit !== -1, unit, reduced);
    // Anticipation, follow-through and reeling all settle back into the same wrist positions.
    let handX = 0, handY = 0;
    if (!reduced && last && age < flight) {
        const wind = kunaiWindupMs(last);
        if (age < wind) { handX = pose.x - rest.x; handY = pose.y - rest.y; }
        else { const reach = Math.sin(Math.PI * clamp01((age - wind) / 280)); handX = 11 * unit * (1 - smooth((age - wind) / 160)); handY = 12 * unit * (1 - smooth((age - wind) / 160)) - reach * 27 * unit; }
    }
    const reelAge = struck ? haulAge : last ? age - flight : 0;
    const duration = struck ? KUNAI_HAUL_MS : KUNAI_RETURN_MS;
    const reelEnvelope = reduced || !retrieving ? 0 : smooth(reelAge / 150) * smooth((duration - reelAge) / 150);
    const held = Math.hypot(pose.x - rest.x, pose.y - rest.y) < 16 * unit;
    const drawBlade = () => blade(ctx, pose.x, pose.y, pose.angle, unit * .7, golden, gear?.kunai[golden ? 1 : 0]);
    if (held) drawBlade();
    const open = reduced || !last ? 0 : smooth((age - kunaiWindupMs(last)) / 70) * (1 - smooth((age - flight - 100) / 180));
    for (const side of [-1, 1]) {
        const tug = Math.sin(reelAge / 110 + side) * reelEnvelope * 3 * unit;
        ctx.save(); ctx.translate(w * .5 + side * 31 * unit + (side === 1 ? handX : 0), h + 38 * unit + (side === 1 ? handY : 0) + tug); ctx.rotate(side * -.15);
        const hand = gear?.hands[side === -1 ? 0 : 1], release = gear?.hands[2];
        if (hand?.complete && hand.naturalWidth) {
            ctx.save(); ctx.globalAlpha = side === -1 ? 1 : 1 - open; ctx.drawImage(hand, -39.375 * unit, -126 * unit, 78.75 * unit, 126 * unit); ctx.restore();
            if (side === 1 && release?.complete && release.naturalWidth && open > 0) { ctx.save(); ctx.globalAlpha = open; ctx.drawImage(release, -39.375 * unit, -126 * unit, 78.75 * unit, 126 * unit); ctx.restore(); }
        }
        if (side === -1) {
            const metal = ctx.createLinearGradient(-10 * unit, -76 * unit, 10 * unit, -52 * unit);
            metal.addColorStop(0, golden ? '#cbb174' : '#a6b4b1'); metal.addColorStop(.3, '#52605e'); metal.addColorStop(.7, '#263334'); metal.addColorStop(1, golden ? '#8b744b' : '#697977');
            ctx.fillStyle = metal; ctx.strokeStyle = '#182523'; ctx.lineWidth = 1.2 * unit;
            ctx.beginPath(); ctx.ellipse(0, -64 * unit, 10 * unit, 12 * unit, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#253230'; ctx.beginPath(); ctx.arc(0, -64 * unit, 8 * unit, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#b8ad90'; ctx.lineWidth = .9 * unit; ctx.beginPath();
            for (let n = 0; n <= 100; n++) { const a = n / 100 * Math.PI * 8, r = (2 + n / 100 * 5.5) * unit; const x = Math.cos(a) * r, y = -64 * unit + Math.sin(a) * r; if (!n) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
            ctx.fillStyle = '#bcc4b4'; ctx.beginPath(); ctx.arc(-5 * unit, -72 * unit, unit, 0, Math.PI * 2); ctx.arc(5 * unit, -56 * unit, unit, 0, Math.PI * 2); ctx.fill();
            const turn = reduced || !retrieving ? 0 : reelAge / 75;
            ctx.strokeStyle = '#f0d8a8'; ctx.beginPath(); ctx.moveTo(Math.cos(turn) * 3 * unit, -64 * unit + Math.sin(turn) * 3 * unit); ctx.lineTo(Math.cos(turn) * 9 * unit, -64 * unit + Math.sin(turn) * 9 * unit); ctx.stroke();
        }
        ctx.restore();
    }
    if (!held) drawBlade();
    if (state.phase === 'aiming') {
        const ax = aim.x / 100 * w, ay = aim.y / 100 * h;
        ctx.save(); ctx.strokeStyle = '#f2d598'; ctx.lineWidth = 1.5; ctx.shadowColor = '#071923'; ctx.shadowBlur = 4;
        ctx.setLineDash([2, 7]); ctx.globalAlpha = .35; ctx.beginPath(); ctx.moveTo(rest.x, rest.y - 25 * unit); ctx.lineTo(ax, ay); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = .95;
        ctx.beginPath(); ctx.arc(ax, ay, 15 * unit, 0, Math.PI * 2); ctx.stroke();
        for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(ax + side * 20 * unit, ay); ctx.lineTo(ax + side * 10 * unit, ay); ctx.moveTo(ax, ay + side * 20 * unit); ctx.lineTo(ax, ay + side * 10 * unit); ctx.stroke(); }
        ctx.restore();
    }
    if (hauling) ring(ctx, w * .49, h * .88, haulAge - 900, true, unit, reduced);
    ctx.font = `${w < 480 ? 9 : 10}px system-ui`;
    for (const label of labels) {
        const left = label.x - label.width / 2, top = label.y - 8;
        ctx.fillStyle = label.locked ? '#321e20ed' : '#102e2deb'; ctx.strokeStyle = label.locked ? '#dc9b88' : '#a6cbb4'; ctx.lineWidth = .7;
        ctx.beginPath(); ctx.roundRect(left, top, label.width, 18, 4); ctx.fill(); ctx.stroke();
        ctx.fillStyle = label.locked ? '#ffe3d6' : '#e8f3df'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(label.text, left + (label.locked ? 17 : 8), label.y + 1);
        if (label.locked) { ctx.strokeStyle = '#edc4b4'; ctx.lineWidth = 1; ctx.strokeRect(left + 6, top + 8, 6, 5); ctx.beginPath(); ctx.arc(left + 9, top + 8, 2.5, Math.PI, Math.PI * 2); ctx.stroke(); }
    }
}
