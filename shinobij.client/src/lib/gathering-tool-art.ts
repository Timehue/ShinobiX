/** One artwork source for shop cards, inventory, loadouts and gathering panels. */
export function gatheringToolArtwork(id: string): string {
    if (id === 'tool-basic-fishing-pole') return '/items/tool-basic-fishing-kunai-v1.webp';
    if (id === 'tool-golden-fishing-pole') return '/items/tool-golden-fishing-kunai-v1.webp';
    return `/items/${id}.svg${id === 'tool-basic-pickaxe' || id === 'tool-golden-pickaxe' ? '?v=veinbreaking-2' : ''}`;
}
