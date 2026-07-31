import type { Character } from "../../types/character";
import { compactImage, publishSharedImage } from "../../lib/shared-images";

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error("Could not read starter avatar."));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
    });
}

/**
 * Does this creator choice stay on its static path instead of adopting the
 * published base64 copy? MUST imply `isPresetAvatar` — the save clamp reverts
 * any avatar it doesn't recognise as a preset, so a path we keep but the server
 * doesn't allowlist would be stripped right back out on the first save.
 * `starterAvatarPublish.test.ts` guards that implication.
 */
export function keepsPresetPath(chosen: string): boolean {
    return chosen.startsWith("/starter-avatar-");
}

async function starterAvatarDataUrl(src: string): Promise<string | null> {
    if (!src) return null;
    if (src.startsWith("data:image")) return compactImage(src, 512, 200);
    if (!src.startsWith("/starter-avatar-")) return null;

    const response = await fetch(src, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Starter avatar fetch failed: ${response.status}`);
    const dataUrl = await blobToDataUrl(await response.blob());
    return compactImage(dataUrl, 512, 200);
}

export async function publishStarterAvatarForCharacter(
    character: Character,
    onPublished?: (id: string, image: string) => void,
): Promise<Character> {
    const chosen = character.avatarImage ?? "";
    const avatarDataUrl = await starterAvatarDataUrl(chosen);
    if (!avatarDataUrl) return character;

    const id = `avatar:${character.name.toLowerCase()}`;
    const ok = await publishSharedImage(id, avatarDataUrl);
    if (ok) onPublished?.(id, avatarDataUrl);
    if (!ok) return character;

    // The shared bucket gets the data URL either way — that is how OTHER players
    // resolve this portrait by name. But when the player picked a STARTER
    // avatar, keep the preset PATH on the character rather than swapping in the
    // base64 copy. The preset is a static file that ships with the client, so it
    // paints instantly from the bundle/CDN with no /api/img round-trip, no
    // Postgres read, and no dependency on the shared-image manifest landing.
    // Swapping in the data URL used to route the default avatar — the one nearly
    // every player has — through the image API, and the save clamp then stripped
    // it (it is not an exact preset string), so a default-avatar player fell back
    // to initials whenever that fetch was slow or failed.
    if (keepsPresetPath(chosen)) return character;
    return { ...character, avatarImage: avatarDataUrl };
}
