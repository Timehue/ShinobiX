export type PlayerModel = { assetId: string; version: string };
export type PlayerModelSlots = [PlayerModel | null, PlayerModel | null];

export function isModelAssetId(value: unknown): value is string {
    return typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
}

export function readPlayerModelSlots(value: unknown, equipped?: unknown): PlayerModelSlots {
    if (!Array.isArray(value)) return [isPlayerModel(equipped) ? equipped : null, null];
    const first = isPlayerModel(value[0]) ? value[0] : null;
    return [first, isPlayerModel(value[1]) && value[1].assetId !== first?.assetId ? value[1] : null];
}
export type StarterWorldModel = "starter-one" | "starter-two";

export function readStarterWorldModel(choice: unknown, portrait?: unknown): StarterWorldModel | undefined {
    if (choice === "starter-one" || choice === "starter-two") return choice;
    if (typeof portrait !== "string") return undefined;
    const path = portrait.split(/[?#]/, 1)[0];
    if (path === "/starter-avatar-one.webp") return "starter-one";
    if (path === "/starter-avatar-two.webp") return "starter-two";
    return undefined;
}
export type SprintStyle = "A" | "B" | "C";
export type WorldGaitPresentation = { gait: "walk" | "run"; style: SprintStyle };

/** Only the accepted move's visual gait and style are shared with nearby players. */
export function readWorldGaitPresentation(value: unknown): WorldGaitPresentation | undefined {
    if (!value || typeof value !== "object") return undefined;
    const { gait, style } = value as Partial<WorldGaitPresentation>;
    if ((gait === "walk" || gait === "run") && (style === "A" || style === "B" || style === "C"))
        return { gait, style };
    return undefined;
}

export function isPlayerModel(value: unknown): value is PlayerModel {
    if (!value || typeof value !== "object") return false;
    const ref = value as Partial<PlayerModel>;
    return isModelAssetId(ref.assetId)
        && typeof ref.version === "string" && /^[a-f0-9]{64}$/.test(ref.version);
}
