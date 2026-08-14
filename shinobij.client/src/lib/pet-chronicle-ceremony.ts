import { getChronicleCard } from "./chronicle-duel";

export type PetChronicleWitness = {
    cardId: string;
    petId: string;
    petName: string;
    element: string;
    wins: number;
};

export type PetChronicleCeremonyReceipt = {
    cardIds: string[];
    grantedCardIds: string[];
    witnesses: PetChronicleWitness[];
};

export type PetChronicleProgress = {
    sourceReceipt: string;
    petId: string;
    petName: string;
    cardId: string;
    wins: number;
    threshold: number;
    deedRecorded: boolean;
    cardPressed: boolean;
};

export type PetChronicleProgressReceipt = {
    entries: PetChronicleProgress[];
};

export type PetChronicleSettlementPayload = {
    chronicleCards?: unknown;
    witnessedPets?: unknown;
    livingWitnessProgress?: unknown;
};

function uniqueStrings(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0))];
}

/**
 * Normalize the server-owned witness receipt for presentation. This helper
 * never grants or derives an entitlement: no receipt fields means no ceremony.
 */
export function petChronicleCeremonyFromSettlement(
    payload: PetChronicleSettlementPayload,
): PetChronicleCeremonyReceipt | null {
    const grantedCardIds = uniqueStrings(payload.chronicleCards);
    const witnesses = Array.isArray(payload.witnessedPets)
        ? payload.witnessedPets.flatMap((entry): PetChronicleWitness[] => {
            if (!entry || typeof entry !== "object") return [];
            const candidate = entry as Record<string, unknown>;
            const cardId = typeof candidate.cardId === "string" ? candidate.cardId.trim() : "";
            const petId = typeof candidate.petId === "string" ? candidate.petId.trim() : "";
            if (!cardId || !petId) return [];
            const petName = typeof candidate.petName === "string" && candidate.petName.trim()
                ? candidate.petName.trim()
                : "Companion";
            return [{
                cardId,
                petId,
                petName,
                element: typeof candidate.element === "string" ? candidate.element : "",
                wins: Math.max(0, Math.floor(Number(candidate.wins) || 0)),
            }];
        })
        : [];
    const cardIds = [...new Set([...grantedCardIds, ...witnesses.map((witness) => witness.cardId)])];
    return cardIds.length || witnesses.length ? { cardIds, grantedCardIds, witnesses } : null;
}

/**
 * Read only the server-authored progress receipt. The UI never derives a win
 * count from local pet state, so stale saves cannot fabricate or regress it.
 */
export function petChronicleProgressFromSettlement(
    payload: PetChronicleSettlementPayload,
): PetChronicleProgressReceipt | null {
    if (!Array.isArray(payload.livingWitnessProgress)) return null;
    const entries = payload.livingWitnessProgress.flatMap((entry): PetChronicleProgress[] => {
        if (!entry || typeof entry !== "object") return [];
        const candidate = entry as Record<string, unknown>;
        const sourceReceipt = typeof candidate.sourceReceipt === "string" ? candidate.sourceReceipt.trim() : "";
        const petId = typeof candidate.petId === "string" ? candidate.petId.trim() : "";
        const petName = typeof candidate.petName === "string" ? candidate.petName.trim() : "";
        const cardId = typeof candidate.cardId === "string" ? candidate.cardId.trim() : "";
        const wins = Number(candidate.wins);
        const threshold = Number(candidate.threshold);
        if (!sourceReceipt || !petId || !cardId
            || !Number.isSafeInteger(wins) || wins < 1 || wins > 1_000_000
            || !Number.isSafeInteger(threshold) || threshold < 1 || threshold > 1_000) return [];
        return [{
            sourceReceipt,
            petId,
            petName: petName || "Companion",
            cardId,
            wins,
            threshold,
            deedRecorded: candidate.deedRecorded === true,
            cardPressed: candidate.cardPressed === true,
        }];
    });
    const unique = [...new Map(entries.map((entry) => [`${entry.sourceReceipt}\0${entry.petId}`, entry])).values()];
    return unique.length ? { entries: unique } : null;
}

export function petChronicleProgressCopy(entry: PetChronicleProgress): {
    label: string;
    status: string;
    detail: string;
    announcement: string;
} {
    const visibleWins = Math.min(entry.wins, entry.threshold);
    const label = `Living Witness ${visibleWins}/${entry.threshold}`;
    const status = entry.cardPressed
        ? "Chronicle card pressed"
        : entry.deedRecorded
            ? "Deed recorded · Card Hall pressing awaits"
            : entry.wins >= entry.threshold
                ? "Living Witness record complete"
                : "Arena deed witnessed";
    const detail = entry.cardPressed
        ? `${entry.petName}'s freely earned arena record is now pressed into the Living Chronicle.`
        : entry.deedRecorded
            ? `${entry.petName}'s deed is sealed. Its card will be pressed when your Card Hall record opens.`
            : entry.wins >= entry.threshold
                ? `${entry.petName}'s freely earned arena record has reached the Living Chronicle's threshold.`
                : `${entry.petName}'s freely earned arena victory strengthens a record the Living Chronicle can preserve.`;
    return { label, status, detail, announcement: `${label}. ${status}. ${detail}` };
}

function joinNames(names: string[]): string {
    if (names.length < 2) return names[0] ?? "Your companion";
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

export function petChronicleCeremonyCopy(receipt: PetChronicleCeremonyReceipt): {
    title: string;
    witnessLine: string;
    recordLine: string;
    announcement: string;
} {
    const names = [...new Set(receipt.witnesses.map((witness) => witness.petName))];
    const petNames = joinNames(names);
    const highestWinCount = Math.max(0, ...receipt.witnesses.map((witness) => witness.wins));
    const cardNames = receipt.cardIds.map((id) => getChronicleCard(id)?.name ?? id);
    const cards = joinNames(cardNames);
    const witnessedDeed = highestWinCount > 0
        ? `${petNames} stood beside you through ${highestWinCount} hard-won arena victories.`
        : `${petNames} carried the memory of this arena deed.`;
    const recordLine = receipt.grantedCardIds.length
        ? `The deed was witnessed by your companion and recorded by Ihara. ${cards} ${cardNames.length === 1 ? "is" : "are"} now in your Card Hall collection.`
        : "The deed was witnessed by your companion and recorded by Ihara. Its Chronicle card will be pressed when your Card Hall record is open.";
    const title = receipt.witnesses.length === 1 ? "A Living Witness Rises" : "Living Witnesses Rise";
    return {
        title,
        witnessLine: witnessedDeed,
        recordLine,
        announcement: `${title}. ${witnessedDeed} ${recordLine}`,
    };
}
