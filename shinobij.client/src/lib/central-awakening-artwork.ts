const AWAKENING_ARTWORK = [
    "/assets/awakening-stone-cinematic-v1.webp",
    "/assets/awakening-seal-v1.webp",
    "/assets/awakening-element-fire-v1.webp",
    "/assets/awakening-element-water-v1.webp",
    "/assets/awakening-element-wind-v1.webp",
    "/assets/awakening-element-earth-v1.webp",
    "/assets/awakening-element-lightning-v1.webp",
];

let artworkPrimed = false;

export function primeCentralAwakeningArtwork(): void {
    if (artworkPrimed || typeof Image === "undefined") return;
    artworkPrimed = true;
    AWAKENING_ARTWORK.forEach((path) => {
        const image = new Image();
        image.decoding = "async";
        image.src = path;
    });
}
