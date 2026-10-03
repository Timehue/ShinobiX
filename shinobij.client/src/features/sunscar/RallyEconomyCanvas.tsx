import { memo, useEffect, useRef, type RefObject } from 'react';
import { rallySection, rallyTrack } from '../../../../shared/sunscar/rally-tracks';
import { rallyOrder } from '../../../../shared/sunscar/rally-simulation';
import type { RallyState } from '../../../../shared/sunscar/rally-types';
import type { Pet } from '../../types/pet';
import { petVisualId } from '../../data/pet-evolutions';
import { rallyEconomyFinishSlot, rallyEconomyProjection } from './rally-economy-projection';
import { rallyEconomyPose, rallyEconomyRunFrame } from './rally-economy-pose';
import { rallyEconomyLabels, type RallyLabel, type RallyLabelRect } from './rally-economy-labels';

const ELEMENT_COLOR = { Fire: '#ff9559', Water: '#8fd6ff', Wind: '#a5efbe', Lightning: '#ffe986', Earth: '#d1b4ff' };
type Sprite = { source: CanvasImageSource; width: number; height: number; close?: () => void };
// Grounded artwork must bypass previously cached floating poses.
const spriteUrl = (pet: Pet) => `/pet-rally/${petVisualId(pet)}.webp?v=2`;

/** Bounded 1x, 30fps raster renderer: no WebGL, GLBs, shadows or Three imports. */
export default memo(function RallyEconomyCanvas({ state, onReady, onPresentationFrame, reducedMotion, frameloop }: {
    state: RefObject<RallyState>; onReady: (id: string) => void; onPresentationFrame: (delta: number) => void; reducedMotion: boolean; frameloop: 'always' | 'demand';
}) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const sprites = useRef<Map<string, Sprite>>(new Map());
    const revision = useRef(0);
    const invalidate = useRef<(() => void) | null>(null);
    useEffect(() => {
        let cancelled = false;
        const spriteBank = sprites.current;
        const images: HTMLImageElement[] = [];
        const load = (url: string) => {
            if (images.some(image => image.getAttribute('src') === url)) return;
            const image = new Image(); images.push(image);
            image.onload = async () => {
                // Four rear-view run frames and two ready poses share one square
                // cell size and ground anchor. Side-facing combat art cannot
                // represent this camera's forward course direction.
                if (!image.naturalHeight || image.naturalWidth !== image.naturalHeight * 6) return;
                let sprite: Sprite = { source: image, width: image.naturalWidth, height: image.naturalHeight };
                // Keep small decoded sprites after loading, including on high-DPI phones.
                if (typeof createImageBitmap === 'function') {
                    try {
                        const ratio = Math.min(1, 128 / sprite.height);
                        const bitmap = await createImageBitmap(image, { resizeWidth: Math.max(1, Math.round(sprite.width * ratio)), resizeHeight: Math.max(1, Math.round(sprite.height * ratio)) });
                        sprite = { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
                    } catch { /* Safari/older WebViews can use the decoded image. */ }
                }
                if (cancelled) { sprite.close?.(); return; }
                spriteBank.set(url, sprite); revision.current++; invalidate.current?.();
                if (sprite.source !== image) image.removeAttribute('src');
            };
            image.src = url;
        };
        for (const racer of state.current.racers) {
            load(spriteUrl(racer.pet as unknown as Pet));
            // Images are optional presentation. A stand-in can race immediately.
            onReady(racer.id);
        }
        return () => {
            cancelled = true;
            for (const image of images) { image.onload = null; image.removeAttribute('src'); }
            for (const sprite of spriteBank.values()) sprite.close?.();
            spriteBank.clear();
        };
    }, [state, onReady]);
    useEffect(() => {
        const surface = canvas.current, context = surface?.getContext('2d', { alpha: false });
        if (!surface || !context) throw new Error('The battery saver course could not create its drawing surface.');
        let frame = 0, lastDraw = -Infinity, lastTime = 0, frameCount = 0, observedRevision = -1;
        let width = 0, height = 0;
        const labelMetrics = new Map<string, number>();
        const annotationMetrics = new Map<string, RallyLabelRect>();
        const textBounds = (text: string, x: number, y: number, font: number) => {
            const key = `${context.font}:${text}`;
            if (!annotationMetrics.has(key)) {
                const metrics = context.measureText(text);
                const left = Math.max(font * .65, metrics.width / 2, metrics.actualBoundingBoxLeft || 0), right = Math.max(font * .65, metrics.width / 2, metrics.actualBoundingBoxRight || 0);
                const ascent = Math.max(font, metrics.actualBoundingBoxAscent || 0), descent = Math.max(font * .3, metrics.actualBoundingBoxDescent || 0);
                annotationMetrics.set(key, { x: -left - 1, y: -ascent - 1, width: left + right + 2, height: ascent + descent + 2 });
            }
            const bounds = annotationMetrics.get(key)!;
            return { ...bounds, x: x + bounds.x, y: y + bounds.y };
        };
        const resize = () => {
            const box = surface.getBoundingClientRect();
            const factor = Math.min(1, 960 / Math.max(1, box.width));
            width = Math.max(1, Math.round(box.width * factor)); height = Math.max(1, Math.round(box.height * factor));
            surface.width = width; surface.height = height; lastDraw = -Infinity;
        };
        const observer = new ResizeObserver(resize); observer.observe(surface); resize();
        const draw = (time: number) => {
            const race = state.current, player = race.racers[0], track = rallyTrack(race.trackId);
            const origin = race.finished ? track.length : player.distance;
            const project = (distance: number, lane = 0) => rallyEconomyProjection(track, origin, distance, lane, width, height);
            const polygon = (points: number[][], color: string) => {
                context.fillStyle = color; context.beginPath(); context.moveTo(points[0][0], points[0][1]);
                for (let i = 1; i < points.length; i++) context.lineTo(points[i][0], points[i][1]);
                context.closePath(); context.fill();
            };
            context.fillStyle = track.palette.sky; context.fillRect(0, 0, width, height);
            context.fillStyle = track.palette.rock;
            context.beginPath(); context.moveTo(0, height * .27);
            for (let i = 0; i <= 10; i++) context.lineTo(width * i / 10, height * (.17 + Math.sin(i * 1.9) * .06));
            context.lineTo(width, height * .35); context.lineTo(0, height * .35); context.fill();
            context.fillStyle = track.palette.sand; context.fillRect(0, height * .27, width, height);
            // Twenty-three short road strips follow the real bends and section widths.
            for (let gap = 125; gap > -12; gap -= 6) {
                const at = origin + gap, near = project(at - 6), far = project(at);
                const section = rallySection(track, at), half = section.width * .5;
                polygon([[far.x - half * far.unit * far.scale, far.y], [far.x + half * far.unit * far.scale, far.y],
                    [near.x + half * near.unit * near.scale, near.y], [near.x - half * near.unit * near.scale, near.y]],
                section.terrain === 'stone' || section.terrain === 'alley' ? '#8b7966' : section.terrain === 'deep-sand' ? '#b8894e' : '#c69a67');
                for (const lane of [-.5, .5]) {
                    const a = project(at, lane), b = project(at - 3, lane);
                    context.strokeStyle = '#ffe2a580'; context.lineWidth = Math.max(1, near.scale * 2);
                    context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
                }
            }
            const labels: (RallyLabel & { text: string; font: number })[] = [], blocked: RallyLabelRect[] = [];
            const line = project(track.length);
            if (line.visible) {
                const half = rallySection(track, track.length).width * line.unit * line.scale / 2;
                for (let i = 0; i < 12; i++) { context.fillStyle = i % 2 ? '#fff0d1' : '#342820'; context.fillRect(line.x - half + i * half / 6, line.y, half / 6 + 1, Math.max(3, 8 * line.scale)); }
                const font = Math.max(12, Math.round(22 * line.scale));
                context.font = `bold ${font}px system-ui`; context.textAlign = 'center'; context.fillStyle = '#fff2d5'; context.fillText('FINISH', line.x, line.y - 12);
                blocked.push({ x: line.x - half, y: line.y, width: half * 2, height: Math.max(3, 8 * line.scale) }, textBounds('FINISH', line.x, line.y - 12, font));
            }
            // Render far to near so hazards/companions occlude in course order.
            const finishOrder = race.finished ? rallyOrder(race) : null;
            const finishSlots = race.racers.map(racer => finishOrder ? rallyEconomyFinishSlot(finishOrder.findIndex(entry => entry.id === racer.id)) : null);
            const items = [
                ...track.obstacles.map(obstacle => ({ distance: obstacle.at, obstacle, racer: null })),
                ...race.racers.map((racer, index) => ({ distance: finishSlots[index] ? track.length + finishSlots[index]!.distance : racer.distance, obstacle: null, racer, index })),
            ].sort((a, b) => b.distance - a.distance);
            for (const item of items) {
                const lane = item.obstacle?.lane ?? (race.finished ? finishSlots['index' in item ? item.index : 0]!.lane : item.racer!.lane);
                const p = project(item.distance, lane); if (!p.visible) continue;
                const size = Math.max(7, p.unit * 1.5 * p.scale);
                if (item.obstacle) {
                    const obstacle = item.obstacle, shortcut = obstacle.kind === 'shortcut' || obstacle.kind === 'ramp';
                    context.fillStyle = shortcut ? '#529c78' : obstacle.height <= 1.6 ? '#cf9c45' : '#b35c55';
                    const obstacleRect = { x: p.x - size * .55, y: p.y - (shortcut ? 3 : size * .5), width: size * 1.1, height: shortcut ? Math.max(5, size * .25) : size * .5 };
                    context.fillRect(obstacleRect.x, obstacleRect.y, obstacleRect.width, obstacleRect.height);
                    const cue = shortcut ? '↑' : obstacle.height <= 1.6 ? '⌃' : '×', font = Math.max(10, Math.round(size * .35));
                    context.font = `bold ${font}px system-ui`; context.textAlign = 'center'; context.fillStyle = '#fff1d3';
                    context.fillText(cue, p.x, p.y - size * .65);
                    blocked.push(obstacleRect, textBounds(cue, p.x, p.y - size * .65, font));
                    continue;
                }
                const racer = item.racer!;
                // Distance keeps the stride continuous while speed changes.
                const running = racer.speed > 1 && racer.finishTick === null;
                const sprite = sprites.current.get(spriteUrl(racer.pet as unknown as Pet));
                const spriteFrame = running && !reducedMotion ? rallyEconomyRunFrame(racer.distance) : race.finished ? 5 : 4;
                const lift = racer.finishTick === null ? racer.jump * p.unit * p.scale * .7 : 0;
                const pose = rallyEconomyPose({ groundY: p.y, spriteHeight: size * 1.6, jumpLift: lift,
                    motion: racer.finishTick === null ? racer.motion : 'ready', landingTicks: racer.landing, reducedMotion });
                // A compact contact shadow stays on the road during jumps.
                context.globalAlpha = .36 * pose.shadowOpacity; context.fillStyle = '#382c25';
                context.beginPath(); context.ellipse(p.x, p.y + 1, size * .42 * pose.shadowScale, size * .09 * pose.shadowScale, 0, 0, Math.PI * 2); context.fill();
                context.globalAlpha = 1;
                if (racer.id === 'player' || racer.techniqueTicks > 0) {
                    context.strokeStyle = racer.id === 'player' ? '#fff0a6' : ELEMENT_COLOR[racer.pet.element]; context.lineWidth = 2;
                    context.beginPath(); context.ellipse(p.x, p.y, size * .65, size * .2, 0, 0, Math.PI * 2); context.stroke();
                }
                if (sprite) {
                    context.drawImage(sprite.source, spriteFrame * sprite.height, 0, sprite.height, sprite.height,
                        p.x - pose.width / 2, pose.top, pose.width, pose.height);
                } else {
                    context.fillStyle = ELEMENT_COLOR[racer.pet.element]; context.beginPath(); context.arc(p.x, pose.contactY - size * .4, size * .4, 0, Math.PI * 2); context.fill();
                }
                const body = { x: p.x - pose.width / 2, y: pose.top, width: pose.width, height: pose.height };
                blocked.push(body);
                if (racer.id === 'player' && body.x < width && body.x + body.width > 0 && body.y < height && body.y + body.height > 0) {
                    const text = 'YOU', font = Math.max(10, Math.min(14, Math.round(size * .22)));
                    context.font = `${font}px system-ui`;
                    const key = `${font}:${text}`;
                    if (!labelMetrics.has(key)) labelMetrics.set(key, context.measureText(text).width);
                    labels.unshift({ id: racer.id, text, font, width: Math.min(width - 8, labelMetrics.get(key)! + 10), height: font + 8,
                        anchor: { x: p.x, y: p.y }, body, preferredY: p.y + size * .2 });
                }
            }
            for (const shot of race.shots) {
                const p = project(shot.distance, shot.lane); if (!p.visible) continue;
                context.fillStyle = ELEMENT_COLOR[shot.element]; context.beginPath(); context.arc(p.x, p.y - 9 * p.scale, Math.max(3, 7 * p.scale), 0, Math.PI * 2); context.fill();
                const radius = Math.max(3, 7 * p.scale);
                blocked.push({ x: p.x - radius, y: p.y - 9 * p.scale - radius, width: radius * 2, height: radius * 2 });
            }
            // Keep one player marker clear of the pets and course hazards.
            const nameplates = rallyEconomyLabels(labels, blocked, width, height);
            context.save();
            context.textAlign = 'center'; context.textBaseline = 'top';
            for (const label of nameplates) {
                const descriptor = labels.find(entry => entry.id === label.id)!;
                context.fillStyle = '#241c16e8'; context.fillRect(label.x, label.y, label.width, label.height);
                context.font = `${descriptor.font}px system-ui`; context.fillStyle = '#fff0a6';
                context.fillText(descriptor.text, label.x + label.width / 2, label.y + 4, label.width - 8);
            }
            context.restore();
            frameCount++;
            if (import.meta.env.MODE === 'sunscar-modes-qa') {
                (window as Window & { sunscarRallyQa?: unknown }).sunscarRallyQa = { state: structuredClone(race), quality: 'economy', geometry: 0, textures: 0, calls: 0, triangles: 0,
                    frameCount, pixelRatio: 1, fps: lastTime ? 1000 / (time - lastTime) : 0, spriteCount: sprites.current.size,
                    labels: nameplates, labelBlockers: blocked };
            }
            onPresentationFrame(lastTime ? (time - lastTime) / 1000 : 0);
            lastTime = time;
        };
        const loop = (time: number) => {
            // Demand mode sleeps after painting; image arrivals/resize need one frame.
            if (frameloop === 'always' && time - lastDraw >= 1000 / 30 - 1 || lastDraw === -Infinity || observedRevision !== revision.current) {
                draw(time); lastDraw = time; observedRevision = revision.current;
            }
            if (frameloop === 'always') frame = requestAnimationFrame(loop);
        };
        const repaint = () => { if (frameloop === 'demand') { cancelAnimationFrame(frame); frame = requestAnimationFrame(loop); } };
        invalidate.current = repaint;
        const resizeObserver = new ResizeObserver(repaint); resizeObserver.observe(surface);
        frame = requestAnimationFrame(loop);
        return () => {
            cancelAnimationFrame(frame); observer.disconnect(); resizeObserver.disconnect(); invalidate.current = null;
            if (import.meta.env.MODE === 'sunscar-modes-qa') delete (window as Window & { sunscarRallyQa?: unknown }).sunscarRallyQa;
        };
    }, [state, onPresentationFrame, reducedMotion, frameloop]);
    return <div className="rally-economy-surface"><canvas ref={canvas} aria-label="Pet Rally course in battery saver graphics" style={{ display: 'block', width: '100%', height: '100%' }} /></div>;
});
