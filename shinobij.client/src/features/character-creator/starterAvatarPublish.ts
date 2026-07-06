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
    const avatarDataUrl = await starterAvatarDataUrl(character.avatarImage ?? "");
    if (!avatarDataUrl) return character;

    const id = `avatar:${character.name.toLowerCase()}`;
    const ok = await publishSharedImage(id, avatarDataUrl);
    if (ok) onPublished?.(id, avatarDataUrl);
    return ok ? { ...character, avatarImage: avatarDataUrl } : character;
}
