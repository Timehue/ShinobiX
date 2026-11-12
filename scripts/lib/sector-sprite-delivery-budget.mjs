export const SECTOR_SPRITE_DELIVERY_LIMIT = 80 * 1024;

/** Keep the sprite bootstrap separate from unrelated runtime asset growth. */
export function measureSectorSpriteDelivery(files, sizeOf) {
    const kinds = [
        /^assets\/sector-model-pins-[\w-]+\.json$/,
        /^assets\/sector-pose-[a-f0-9]{20}\.wasm\.gz$/,
        /^assets\/sector-pose\.worker-[\w-]+\.js$/,
    ];
    const selected = kinds.map(pattern => {
        const matches = files.filter(file => pattern.test(file));
        if (matches.length !== 1) throw Error('Expected one sprite delivery object for ' + pattern);
        return matches[0];
    });
    const sizes = selected.map(file => sizeOf(file));
    if (!sizes.every(size => Number.isSafeInteger(size) && size > 0)) throw Error('Invalid sprite delivery size');
    const bytes = sizes.reduce((sum, size) => sum + size, 0);
    if (bytes > SECTOR_SPRITE_DELIVERY_LIMIT) throw Error(`Sprite bootstrap uses ${bytes} B; ceiling is ${SECTOR_SPRITE_DELIVERY_LIMIT} B`);
    return { files: selected, bytes };
}
