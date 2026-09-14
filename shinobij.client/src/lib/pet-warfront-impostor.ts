import { WARFRONT_IMPOSTOR_MANIFEST } from "../generated/pet-warfront-impostor-manifest";

export type WarfrontImpostorEntry = (typeof WARFRONT_IMPOSTOR_MANIFEST)[keyof typeof WARFRONT_IMPOSTOR_MANIFEST];

function sourcePath(url: string): string {
    const path = url.split("?", 1)[0].replace(/\\/gu, "/");
    const marker = path.indexOf("/pet-models/");
    return marker >= 0 ? path.slice(marker) : path;
}

/** Exact-source lookup only. Missing generated art deliberately returns null so
 * the renderer can retain the real skinned model as its fail-safe. */
export function warfrontImpostorEntry(sourceUrl: string): WarfrontImpostorEntry | null {
    const key = sourcePath(sourceUrl) as keyof typeof WARFRONT_IMPOSTOR_MANIFEST;
    return WARFRONT_IMPOSTOR_MANIFEST[key] ?? null;
}
