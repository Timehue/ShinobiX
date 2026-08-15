import type { Character } from "../types/character";

export type OwnSaveReadAnchor = Readonly<{
    accountName: string;
    accountKey: string;
    hp: number;
    chakra: number;
    stamina: number;
}>;

/** A receipt adopter owns both the read's save version and its settled vitals. */
export type OwnSaveReadResult = "accepted" | "stale" | "foreign";
export type OwnSaveReadCommit = (
    anchor: OwnSaveReadAnchor,
    settledCharacter: Character | null | undefined,
    settledVersion: unknown,
) => Promise<OwnSaveReadResult>;

const accountKey = (name: string): string => name.trim().toLowerCase();

/** Capture the vital values visible when an owner-save request begins. */
export function captureOwnSaveRead(character: Character): OwnSaveReadAnchor {
    return {
        accountName: character.name,
        accountKey: accountKey(character.name),
        hp: character.hp,
        chakra: character.chakra,
        stamina: character.stamina,
    };
}

/**
 * Merge the durable elapsed-vital projection without replacing local work that
 * happened while the GET was in flight. Account and version admission happen in
 * the caller before this pure, functional-state merge.
 */
export function reconcileOwnSaveReadVitals(
    current: Character | null,
    anchor: OwnSaveReadAnchor,
    settled: Character | null | undefined,
): Character | null {
    if (!current || !settled
        || accountKey(current.name) !== anchor.accountKey
        || accountKey(settled.name) !== anchor.accountKey) return current;

    let next = current;
    for (const key of ["hp", "chakra", "stamina"] as const) {
        const settledValue = settled[key];
        if (current[key] !== anchor[key]
            || typeof settledValue !== "number"
            || !Number.isFinite(settledValue)
            || current[key] === settledValue) continue;
        if (next === current) next = { ...current };
        next[key] = settledValue;
    }
    return next;
}
