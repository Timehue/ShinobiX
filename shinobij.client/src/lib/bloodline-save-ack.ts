import type { SavedBloodline } from "../types/combat";

type BloodlineSaveAcknowledgement = {
    savedBloodlineIds?: string[];
    savedBloodlineRanks?: Record<string, string>;
    equippedBloodlineId?: string | null;
} | null | undefined;

export function assertBloodlineSaveAcknowledged(
    acknowledgement: BloodlineSaveAcknowledgement,
    requestedBloodlines: readonly SavedBloodline[],
    equippedBloodlineId: string | undefined,
): void {
    const storedIds = acknowledgement?.savedBloodlineIds;
    if (!Array.isArray(storedIds)
        || requestedBloodlines.some((bloodline) => !storedIds.includes(bloodline.id))
        || requestedBloodlines.some((bloodline) => acknowledgement?.savedBloodlineRanks?.[bloodline.id] !== bloodline.rank)
        || acknowledgement?.equippedBloodlineId !== equippedBloodlineId) {
        throw new Error("The server did not retain this bloodline. Reopen the Awakening Stone if the forge purchase is missing.");
    }
}
