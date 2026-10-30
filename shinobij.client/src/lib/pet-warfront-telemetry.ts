/** Keep the replay's inspection contract without rewriting unchanged DOM
 * attributes on every frame. Shared by the 3D and Canvas2D renderers. */
export function warfrontMetric(canvas: HTMLCanvasElement, key: string, value: string | number | boolean): void {
    const name = `rite${key}`;
    const text = String(value);
    if (canvas.dataset[name] !== text) canvas.dataset[name] = text;
}

/** Each scene probe clears only the diagnostic namespace it owns. */
export function clearWarfrontMetrics(canvas: HTMLCanvasElement, owner: RegExp): void {
    for (const key of Object.keys(canvas.dataset)) {
        if (owner.test(key)) delete canvas.dataset[key];
    }
}
