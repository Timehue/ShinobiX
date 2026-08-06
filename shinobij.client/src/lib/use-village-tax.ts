import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { Character } from "../types/character";
import { settleVillageTax } from "./village-tax-api";

/*
 * Settle the daily village tax once per session (§6.4).
 *
 * The rate falls as your village holds more sectors: a village at its full 8 pays
 * nothing, a conquered one pays the most. Half of what is collected is destroyed
 * (the anti-inflation sink) and half goes to the village treasury.
 *
 * Ryo is client-owned in the save ledger, so the debit has to be ADOPTED here —
 * otherwise the next autosave would re-assert the pre-tax balance and undo it.
 * The server is idempotent per UTC day, so this call is free on repeat.
 */
export function useVillageTax(
    character: Character | null,
    setCharacter: Dispatch<SetStateAction<Character | null>>,
    onServerVersion?: (version: number | undefined) => void,
    notify?: (message: string) => void,
): void {
    // One settlement attempt per player per mount. The server is the real guard;
    // this just avoids a redundant round-trip on every re-render.
    const settledFor = useRef<string>("");

    useEffect(() => {
        const name = character?.name;
        if (!name || settledFor.current === name) return;
        settledFor.current = name;
        let cancelled = false;

        void (async () => {
            const result = await settleVillageTax(name);
            if (cancelled || !result?.applied) return;
            // Adopt the authoritative post-debit balances.
            setCharacter((prev) => (prev ? { ...prev, ryo: result.ryo, bankRyo: result.bankRyo } : prev));
            onServerVersion?.(result._saveVersion);
            notify?.(
                `Village tax: −${result.taxed.toLocaleString()} ryo. `
                + `Your village holds ${result.rateSectors} sector${result.rateSectors === 1 ? "" : "s"} — `
                + `retake ground to lower the rate.`,
            );
        })();

        return () => { cancelled = true; };
    }, [character?.name, setCharacter, onServerVersion, notify]);
}
