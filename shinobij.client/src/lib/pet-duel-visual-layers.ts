export type PetDuelVisualLayers = Readonly<{
    identity: boolean;
    trails: boolean;
    impacts: boolean;
    elements: boolean;
    aftermath: boolean;
    post: boolean;
}>;

const ALL_LAYERS: PetDuelVisualLayers = Object.freeze({
    identity: true,
    trails: true,
    impacts: true,
    elements: true,
    aftermath: true,
    post: true,
});

/**
 * QA-only isolation hook. `?petLayers=identity,elements` renders only the named
 * effect families; omitting the parameter preserves the production composition.
 */
export function resolvePetDuelVisualLayers(value?: string | null): PetDuelVisualLayers {
    if (!value?.trim()) return ALL_LAYERS;
    const selected = new Set(value.toLowerCase().split(",").map((part) => part.trim()).filter(Boolean));
    return Object.freeze({
        identity: selected.has("identity"),
        trails: selected.has("trails"),
        impacts: selected.has("impacts"),
        elements: selected.has("elements"),
        aftermath: selected.has("aftermath"),
        post: selected.has("post"),
    });
}
