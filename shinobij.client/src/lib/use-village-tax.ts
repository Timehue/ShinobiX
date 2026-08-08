import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { Character } from "../types/character";
import { settleVillageTax } from "./village-tax-api";

/*
 * Settle the daily village tax once per session (§6.4).
 *
 * The first eight home sectors are untaxed. Holding territory beyond those eight
 * creates a bounded occupation tax; half is destroyed (the anti-inflation sink)
 * and half goes to the village treasury.
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
                `Occupation tax: −${result.taxed.toLocaleString()} ryo. `
                + `Your village holds ${result.rateSectors} sector${result.rateSectors === 1 ? "" : "s"}; `
                + `territory beyond eight creates this rate, and the Treasury Vault can reduce it.`,
            );
        })();

        return () => { cancelled = true; };
    }, [character?.name, setCharacter, onServerVersion, notify]);
}
