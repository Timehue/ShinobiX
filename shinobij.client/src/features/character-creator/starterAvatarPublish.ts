import type { Character } from "../../types/character";
import { compactImage, publishSharedImage } from "../../lib/shared-images";
import { isPresetAvatar } from "../../lib/entitlements";

/**
 * Does this creator choice stay on its static path instead of adopting the
 * published base64 copy? MUST imply `isPresetAvatar` — the save clamp reverts
 * any avatar it doesn't recognise as a preset, so a path we keep but the server
 * doesn't allowlist would be stripped right back out on the first save.
 * `starterAvatarPublish.test.ts` guards that implication.
 */
export function keepsPresetPath(chosen: string): boolean {
    return isPresetAvatar(chosen);
}

async function starterAvatarDataUrl(src: string): Promise<string | null> {
    if (!src) return null;
    if (src.startsWith("data:image")) return compactImage(src, 512, 200);
    return null;
}

export async function publishStarterAvatarForCharacter(
    character: Character,
    onPublished?: (id: string, image: string) => void,
): Promise<Character> {
    const chosen = character.avatarImage ?? "";
    // Presets are static, public client assets. Keep the allowlisted path and
    // skip the shared-image POST entirely: account creation runs before the
    // first save exists, so the authoritative supporter upload gate correctly
    // rejects that request. Peers still render the character's preset fallback.
    if (keepsPresetPath(chosen)) return character;

    const avatarDataUrl = await starterAvatarDataUrl(chosen);
    if (!avatarDataUrl) return character;

    const id = `avatar:${character.name.toLowerCase()}`;
    const ok = await publishSharedImage(id, avatarDataUrl);
    if (ok) onPublished?.(id, avatarDataUrl);
    if (!ok) return character;

    return { ...character, avatarImage: avatarDataUrl };
}
