import { KAMA_BASE_Y, KAMA_CLEAN, KAMA_GUST_WARNING_MS, KAMA_SETTLE_MS, kamaGustStrength, kamaStalkPose, type KamaCut, type KamaField, type KamaStalkResult, type KamaStroke } from '../../../shared/kama-reaping';

/**
 * Kama Reaping canvas. Everything is drawn from the shared scorer's poses, so
 * what the player sees is what the server scores: the field is always 3:2
 * (the CSS keeps it so), a stalk pivots on its root at KAMA_BASE_Y, and one
 * height unit is one percent of the field's height.
 */
export type KamaArt = { backdrop: HTMLImageElement; plant: HTMLImageElement; trace?: HTMLImageElement };
export type KamaTrail = { x1: number; y1: number; x2: number; y2: number };
export type KamaView = {
    field: KamaField; at: number; strokes: readonly KamaStroke[]; stalks: readonly KamaStalkResult[];
    /** The in-progress drag, in field percent. */
    trail?: KamaTrail | null;
    /** Guide-line mode: the line's height and the stalk it will cut. */
    guide?: { y: number; stalk: number } | null;
    reduced: boolean;
    /** Which stalk is drawn with the trace plant (forest/shadow meadows above level 1). */
    traceStalk?: number;
};

const CUT_LABEL: Record<KamaCut, string> = { clean: 'Clean', rough: 'Rough', wasted: 'Wasted', tear: 'Torn roots' };
const CUT_COLOUR: Record<KamaCut, string> = { clean: '#f6dc8a', rough: '#e9e1c8', wasted: '#c8c2b0', tear: '#f08f7c' };
const FALL_MS = KAMA_SETTLE_MS, TAG_MS = 1300, TRAIL_MS = 420;

function ready(image: HTMLImageElement | undefined): image is HTMLImageElement {
    return Boolean(image && image.complete && image.naturalWidth > 0);
}

export function drawKamaReaping(ctx: CanvasRenderingContext2D, width: number, height: number, art: KamaArt, view: KamaView) {
    const px = (x: number) => x / 100 * width, py = (y: number) => y / 100 * height;
    ctx.clearRect(0, 0, width, height);
    if (ready(art.backdrop)) ctx.drawImage(art.backdrop, 0, 0, width, height);
    else { ctx.fillStyle = '#5b6b3a'; ctx.fillRect(0, 0, width, height); }

    const gust = kamaGustStrength(view.field, view.at), coming = kamaGustStrength(view.field, view.at + KAMA_GUST_WARNING_MS);
    if (!view.reduced && Math.max(gust, coming) > .08) drawWind(ctx, width, height, view.at, Math.max(gust, coming * .6));

    view.field.stalks.forEach((stalk, index) => {
        const sprite = index === view.traceStalk && ready(art.trace) ? art.trace : art.plant;
        const pose = kamaStalkPose(view.field, index, view.at), result = view.stalks[index] ?? {};
        const tall = py(stalk.height);
        const wide = ready(sprite) ? sprite.naturalWidth * tall / sprite.naturalHeight : tall * .35;
        ctx.save();
        ctx.translate(px(stalk.x), py(KAMA_BASE_Y));
        ctx.rotate(pose.angle);
        // Soft contact shadow at the root.
        ctx.fillStyle = 'rgba(16, 12, 6, .35)';
        ctx.beginPath(); ctx.ellipse(0, 2, wide * .32, tall * .025, 0, 0, Math.PI * 2); ctx.fill();
        const cutY = result.cut ? -(result.height ?? 0) * tall : -Infinity;
        // The rooted part: whole stalk, or the stump below the cut.
        ctx.save();
        ctx.beginPath(); ctx.rect(-wide, Math.max(cutY, -tall * 1.05), wide * 2, tall * 1.1 + Math.min(0, -cutY));
        ctx.clip();
        if (ready(sprite)) ctx.drawImage(sprite, -wide / 2, -tall, wide, tall);
        ctx.restore();
        if (!result.cut) drawBand(ctx, wide, tall, stalk.band, gust);
        ctx.restore();
        // The cut top tips over and falls away, then is gone.
        if (result.cut && result.at !== undefined && ready(sprite)) {
            const since = view.at - result.at;
            if (!view.reduced && since >= 0 && since < FALL_MS) {
                const t = since / FALL_MS, cut = result.height ?? 0;
                ctx.save();
                ctx.globalAlpha = 1 - t;
                ctx.translate(px(stalk.x), py(KAMA_BASE_Y));
                ctx.rotate(pose.angle);
                ctx.translate(wide * .25 * t, -cut * tall + tall * .9 * t * t);
                ctx.rotate((pose.angle >= 0 ? 1 : -1) * t * 1.1);
                ctx.translate(0, cut * tall);
                ctx.beginPath(); ctx.rect(-wide, -tall * 1.05, wide * 2, tall * 1.05 - cut * tall); ctx.clip();
                ctx.drawImage(sprite, -wide / 2, -tall, wide, tall);
                ctx.restore();
            }
            if (since >= 0 && since < TAG_MS) {
                const base = pose.base, tip = pose.tip, u = result.height ?? 0;
                const x = px(base.x + (tip.x - base.x) * u), y = py(base.y + (tip.y - base.y) * u) - (view.reduced ? 0 : since / TAG_MS * 26);
                ctx.save();
                ctx.globalAlpha = view.reduced ? 1 : 1 - since / TAG_MS;
                ctx.font = `600 ${Math.max(11, Math.round(height / 26))}px Georgia, serif`;
                ctx.textAlign = 'center';
                ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(12, 14, 10, .85)';
                ctx.strokeText(CUT_LABEL[result.cut], x, y - 8);
                ctx.fillStyle = CUT_COLOUR[result.cut];
                ctx.fillText(CUT_LABEL[result.cut], x, y - 8);
                ctx.restore();
            }
        }
        if (view.guide?.stalk === index && !result.cut) {
            ctx.save();
            ctx.fillStyle = '#f2d892';
            const bx = px(stalk.x), by = py(KAMA_BASE_Y) + 10;
            ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - 7, by + 9); ctx.lineTo(bx + 7, by + 9); ctx.closePath(); ctx.fill();
            ctx.restore();
        }
    });

    if (view.guide) line(ctx, 'rgba(246, 226, 160, .8)', 1.5, px(4), py(view.guide.y), px(96), py(view.guide.y), 1, [7, 6]);
    // Finished strokes flash as a blade arc; the live drag shows where it will cut.
    for (const stroke of view.strokes) {
        const since = view.at - stroke.at, alpha = view.reduced ? .9 : 1 - since / TRAIL_MS;
        if (since >= 0 && since < TRAIL_MS) for (const [style, width] of [['rgba(255, 236, 180, .55)', 9], ['#fffaf0', 2.5]] as const)
            line(ctx, style, width, px(stroke.x1), py(stroke.y1), px(stroke.x2), py(stroke.y2), alpha);
    }
    if (view.trail) line(ctx, 'rgba(255, 244, 214, .55)', 2, px(view.trail.x1), py(view.trail.y1), px(view.trail.x2), py(view.trail.y2), 1, [4, 5]);
}

/** One straight stroke: the guide line, a blade flash layer, or the live drag. */
function line(ctx: CanvasRenderingContext2D, style: string, width: number, x1: number, y1: number, x2: number, y2: number, alpha: number, dash: number[] = []) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha); ctx.lineCap = 'round'; ctx.setLineDash(dash);
    ctx.strokeStyle = style; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
}

/** The cut band: a gold tick across the stalk, wide as the clean window. */
function drawBand(ctx: CanvasRenderingContext2D, wide: number, tall: number, band: number, gust: number) {
    const y = -band * tall, span = Math.max(10, wide * .42), clean = KAMA_CLEAN * tall;
    ctx.save();
    ctx.globalAlpha = .95 - gust * .45;
    ctx.fillStyle = 'rgba(246, 214, 120, .18)';
    ctx.fillRect(-span, y - clean, span * 2, clean * 2);
    ctx.strokeStyle = '#f4d47c'; ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(255, 220, 130, .8)'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.moveTo(-span, y); ctx.lineTo(span, y); ctx.stroke();
    ctx.restore();
}

/** Wind streaks while a gust builds or blows. Skipped with Reduce Motion. */
function drawWind(ctx: CanvasRenderingContext2D, width: number, height: number, at: number, strength: number) {
    ctx.save();
    ctx.strokeStyle = `rgba(255, 252, 238, ${(.1 + strength * .22).toFixed(3)})`;
    ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
        const lane = (i * 0.137 + .05) % 1, speed = .35 + (i % 3) * .12;
        const x = ((at * speed / 1000 + i * .29) % 1.3 - .15) * width, y = (.18 + lane * .62) * height;
        const length = (.06 + strength * .1) * width;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + length * .5, y - 4, x + length, y + 1); ctx.stroke();
    }
    ctx.restore();
}
