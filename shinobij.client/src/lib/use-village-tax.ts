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
 * The server writes the post-tax balance to the stored save, and a generic save
 * can never change ryo, so adopting it here only keeps the display in step.
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
    // App passes onServerVersion as an inline arrow (new every render). With it
    // in the deps, the next re-render cancelled the in-flight settlement and
    // the settledFor guard blocked a retry, so the debit was never shown.
    const callbacksRef = useRef({ onServerVersion, notify });
    useEffect(() => { callbacksRef.current = { onServerVersion, notify }; }, [onServerVersion, notify]);

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
            const { onServerVersion, notify } = callbacksRef.current;
            onServerVersion?.(result._saveVersion);
            notify?.(
                `Occupation tax: −${result.taxed.toLocaleString()} ryo. `
                + `Your village holds ${result.rateSectors} sector${result.rateSectors === 1 ? "" : "s"}; `
                + `territory beyond eight creates this rate, and the Treasury Vault can reduce it.`,
            );
        })();

        return () => { cancelled = true; };
    }, [character?.name, setCharacter]);
}
