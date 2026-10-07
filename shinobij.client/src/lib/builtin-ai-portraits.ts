/** Bundled replacement for the malformed published Shadow Weaver portrait. */
export const SHADOW_WEAVER_PORTRAIT = "/portraits/builtin-ai-shadow-weaver-v2.webp";

export function bundledAiPortrait(id: string): string | undefined {
    return id === "builtin-ai-shadow-weaver" ? SHADOW_WEAVER_PORTRAIT : undefined;
}
