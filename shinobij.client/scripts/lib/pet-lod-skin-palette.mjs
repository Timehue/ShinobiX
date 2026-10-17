/** Keep legacy LOD metrics unchanged. Larger rigs may omit unused joints from
 * the simplifier's error channels, while delivery retains the complete skin. */
export function petLodSkinPalette(jointCount, jointIds, weights) {
    if (!Number.isInteger(jointCount) || jointCount < 1 || jointCount > 256) throw Error('Unsupported Warfront joint count');
    if (jointIds.length !== weights.length || jointIds.length % 4) throw Error('Invalid Warfront influence streams');
    const active = new Set();
    for (let i = 0; i < jointIds.length; i++) {
        const joint = jointIds[i], weight = weights[i];
        if (!Number.isInteger(joint) || joint < 0 || joint >= jointCount || !Number.isFinite(weight) || weight < 0) throw Error('Invalid Warfront skin influence');
        if (weight > 0) active.add(joint);
    }
    const palette = jointCount <= 29 ? Array.from({ length: jointCount }, (_, i) => i) : [...active].sort((a, b) => a - b);
    if (!palette.length || palette.length > 32) throw Error(`Unsupported Warfront active joint count ${palette.length}`);
    return palette;
}

/** Reserve every active skin identity before adding optional static error channels.
 * These channels guide simplification only; all delivered attributes are retained. */
export function petLodSkinMetricLayout(palette) {
    if (!palette.length || palette.length > 32) throw Error('Unsupported Warfront skin metric layout');
    const includeNormals = palette.length <= 29;
    const includeUvs = palette.length <= 27;
    const skinOffset = (includeNormals ? 3 : 0) + (includeUvs ? 2 : 0);
    return {includeNormals, includeUvs, skinOffset, attributeStride: skinOffset + palette.length,
        attributeWeights: [...(includeNormals ? [0.5, 0.5, 0.5] : []), ...(includeUvs ? [0.25, 0.25] : []), ...new Array(palette.length).fill(1)]};
}
