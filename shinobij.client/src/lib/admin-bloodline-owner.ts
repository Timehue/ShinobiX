import type { ReviewBloodline, SavedBloodline } from "../types/combat";
import { canonicalAdminPlayerKey } from "./admin-player-save-owner";

export const ADMIN_BLOODLINE_OWNER_KEY = "admin";

export type AdminBloodlineRecord = SavedBloodline & Pick<ReviewBloodline, "ownerKey" | "ownerName" | "ownerImage">;

/**
 * Bloodline ids are only unique within one save. Admin review/editor state must
 * therefore carry the owning save key alongside the id at every selection and
 * mutation boundary.
 */
export function canonicalBloodlineOwnerKey(ownerKey: unknown): string {
    if (ownerKey === undefined || ownerKey === null || ownerKey === "") {
        return ADMIN_BLOODLINE_OWNER_KEY;
    }
    if (typeof ownerKey !== "string") return "";
    const canonical = canonicalAdminPlayerKey(ownerKey);
    return canonical === ADMIN_BLOODLINE_OWNER_KEY
        ? ADMIN_BLOODLINE_OWNER_KEY
        : canonical;
}

export function adminBloodlineOwnerId(
    bloodline: Pick<AdminBloodlineRecord, "id" | "ownerKey">,
): string {
    const ownerKey = canonicalBloodlineOwnerKey(bloodline.ownerKey);
    const bloodlineId = typeof bloodline.id === "string" ? bloodline.id.trim() : "";
    return ownerKey && bloodlineId ? `${ownerKey}:${bloodlineId}` : "";
}

export function findAdminBloodlineByOwnerId<T extends Pick<AdminBloodlineRecord, "id" | "ownerKey">>(
    bloodlines: readonly T[],
    ownerId: string,
): T | undefined {
    return bloodlines.find((bloodline) => adminBloodlineOwnerId(bloodline) === ownerId);
}

export function sameAdminBloodlineOwner(
    left: Pick<AdminBloodlineRecord, "id" | "ownerKey">,
    right: Pick<AdminBloodlineRecord, "id" | "ownerKey">,
): boolean {
    const leftId = adminBloodlineOwnerId(left);
    return Boolean(leftId) && leftId === adminBloodlineOwnerId(right);
}

/**
 * Promoting player-authored content creates a new admin-owned catalog object.
 * Reusing the player's ids would collapse two independent image/jutsu owners
 * back into the same global namespace this module exists to separate.
 */
function stableApprovalDigest(value: string): string {
    // Two independent 32-bit streams keep the generated ids compact while
    // making the source owner+id mapping stable across reloads and tabs.
    let left = 0x811c9dc5;
    let right = 0x9e3779b9;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        left = Math.imul(left ^ code, 0x01000193) >>> 0;
        right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
        right = (right ^ (right >>> 13)) >>> 0;
    }
    return `${left.toString(16).padStart(8, "0")}${right.toString(16).padStart(8, "0")}`;
}

function portableApprovalImage(image: unknown): string | undefined {
    if (typeof image !== "string" || !image.trim()) return undefined;
    // /api/img is a reference to the source owner's storage key. Carrying it
    // to a newly minted admin id would make the promoted object silently alias
    // that old key, while publishSharedImage intentionally treats it as a no-op.
    return image.startsWith("/api/img") ? undefined : image;
}

export function prepareAdminBloodlineApproval(
    bloodline: AdminBloodlineRecord,
): SavedBloodline {
    const ownerKey = canonicalBloodlineOwnerKey(bloodline.ownerKey);
    const playerOwned = ownerKey !== ADMIN_BLOODLINE_OWNER_KEY;
    const sourceOwnerId = adminBloodlineOwnerId(bloodline);
    if (!sourceOwnerId) throw new Error("Invalid bloodline owner identity.");
    const promotedBloodlineId = `bloodline-approved-${stableApprovalDigest(sourceOwnerId)}`;
    return {
        id: playerOwned ? promotedBloodlineId : bloodline.id,
        name: bloodline.name,
        rank: bloodline.rank,
        image: playerOwned
            ? portableApprovalImage(bloodline.ownerImage ?? bloodline.image)
            : bloodline.image,
        specialElement: bloodline.specialElement,
        weatherElement: bloodline.weatherElement,
        lore: bloodline.lore,
        jutsus: bloodline.jutsus.map((jutsu, index) => ({
            ...jutsu,
            id: playerOwned
                ? `jutsu-approved-${stableApprovalDigest(`${sourceOwnerId}:${jutsu.id}:${index}`)}`
                : jutsu.id,
            image: playerOwned ? portableApprovalImage(jutsu.image) : jutsu.image,
        })),
        totalPoints: bloodline.totalPoints,
    };
}
