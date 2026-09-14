/**
 * Runtime atlas routing for an already-approved combat model. The generated
 * bank deliberately mirrors `/pet-models/**.glb` beneath
 * `/pet-models/warfront-impostors/**.webp`; keeping this tiny derivation apart
 * from the 159-entry QA metadata manifest saves the default battle from parsing
 * frame/provenance data it never consumes. A missing file still trips the
 * stage's authored-rig fallback.
 */
export function warfrontImpostorAtlasUrl(sourceUrl: string): string | null {
    const clean = sourceUrl.split("?", 1)[0].replace(/\\/gu, "/");
    const marker = clean.indexOf("/pet-models/");
    if (marker < 0) return null;
    const sourcePath = clean.slice(marker);
    if (!sourcePath.toLowerCase().endsWith(".glb")) return null;
    return `/pet-models/warfront-impostors/${sourcePath.slice("/pet-models/".length, -4)}.webp`;
}
