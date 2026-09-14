/** Fit every corner of the board, including standing models, in perspective.
 * Fitting a flat rectangle at the look point underestimates the near corners;
 * cropping the phone bounds compounds that error and hides deployed pets. */
export function warfrontCameraFrame(width: number, height: number, halfX: number, halfZ: number) {
    const aspect = Math.max(0.1, width / Math.max(1, height));
    const portrait = height > width;
    const fov = portrait ? 50 : 40;
    const elevation = portrait ? 1.06 : 0.84;
    // Preserve blue-left/red-right on phones as well as desktop.
    const viewX = 0;
    const viewZ = 1;
    const cosPitch = 1 / Math.sqrt(1 + elevation * elevation);
    const sinPitch = elevation * cosPitch;
    const lookY = 1;
    const tanV = Math.tan(fov * Math.PI / 360) * 0.94;
    const tanH = tanV * aspect;
    let distance = 1;
    for (const x of [-halfX, halfX]) {
        for (const z of [-halfZ, halfZ]) {
            for (const y of [0, 3.4]) {
                const along = x * viewX + z * viewZ;
                const right = -viewZ * x + viewX * z;
                const up = (y - lookY) * cosPitch - along * sinPitch;
                const depth = along * cosPitch + (y - lookY) * sinPitch;
                distance = Math.max(distance, depth + Math.abs(right) / tanH, depth + Math.abs(up) / tanV);
            }
        }
    }
    return {
        fov,
        position: [viewX * distance * cosPitch, lookY + distance * sinPitch, viewZ * distance * cosPitch] as [number, number, number],
        target: [0, lookY, 0] as [number, number, number],
        far: Math.max(100, distance + halfX + halfZ + 10),
    };
}

/** Canvas fallback fits the same complete board with room for sprite heads,
 * tails, health rails, and contact motion. Width/height are the stage below HUD. */
export function warfrontCanvasFrame(width: number, height: number, halfX: number, halfZ: number) {
    const actorSize = Math.max(54, Math.min(height > width ? 128 : 140, Math.min(width, height) * 0.22 * 1.16));
    const side = actorSize * 0.65 + 10;
    const top = actorSize * 0.95 + 16;
    const bottom = actorSize * 0.3 + 10;
    return {
        centerX: width * 0.5,
        centerY: (top + height - bottom) * 0.5,
        xScale: Math.max(1, width - side * 2) / (halfX * 2),
        zScale: Math.max(1, height - top - bottom) / (halfZ * 2),
        actorSize,
    };
}
