/** Art-only projection. The client does not need the server's authored trial kits. */
export function storyTwinArt(visual: string): string | undefined {
    return /^(tempest|glacier)-twin-(blade|seal)$/.test(visual) ? `/combat-actors/narrative/${visual}.webp` : undefined;
}
