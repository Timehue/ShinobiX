export type RallyLabelRect = { x: number; y: number; width: number; height: number };
export type RallyLabel = {
    id: string; width: number; height: number;
    anchor: { x: number; y: number }; body: RallyLabelRect; preferredY: number;
};
export type PlacedRallyLabel = RallyLabel & RallyLabelRect;

function intersects(a: RallyLabelRect, b: RallyLabelRect, gap = 2) {
    return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
        && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

/** At most four nameplates, with a fixed 35-candidate search per companion. */
export function rallyEconomyLabels(labels: RallyLabel[], blocked: RallyLabelRect[], width: number, height: number): PlacedRallyLabel[] {
    const placed: PlacedRallyLabel[] = [];
    for (const label of labels.slice(0, 4)) {
        if (label.width > width - 8 || label.height > height - 8) continue;
        const preferredX = label.anchor.x - label.width / 2;
        const xs = [preferredX, label.body.x - label.width - 6, label.body.x + label.body.width + 6, 4, width - label.width - 4];
        const ys = [label.preferredY, label.body.y + label.body.height + 4, label.body.y - label.height - 4,
            label.preferredY + label.height + 4, label.preferredY - label.height - 4, height - label.height - 4, 4];
        let best: PlacedRallyLabel | undefined, distance = Infinity;
        for (const x of xs) for (const y of ys) {
            // Check the final clamped box, including the camera's course edges.
            const candidate = { width: label.width, height: label.height,
                x: Math.max(4, Math.min(width - label.width - 4, x)), y: Math.max(4, Math.min(height - label.height - 4, y)) };
            if (blocked.some(rect => intersects(candidate, rect)) || placed.some(rect => intersects(candidate, rect))) continue;
            const score = (candidate.x - preferredX) ** 2 + (candidate.y - label.preferredY) ** 2;
            if (score < distance) { best = { ...label, ...candidate }; distance = score; }
        }
        if (best) placed.push(best);
    }
    return placed;
}
