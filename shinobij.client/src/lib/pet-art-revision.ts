/** Refresh only Raijin's replaced portrait and pose sprites in existing saves. */
export const RAIJIN_ART_REVISION = "20260923-reference-pose-v2";

export function versionPetArtUrl(url: string): string {
    const pathname = url.split("?", 1)[0];
    if (!/^\/pet-(?:poses|evos)\/starter-lightning-l(?:-[a-z]+)*\.webp$/u.test(pathname)) return url;
    return `${pathname}?v=${RAIJIN_ART_REVISION}`;
}
