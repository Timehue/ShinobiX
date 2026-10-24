/*
 * The occupation tax a daily route assessed on the server (2026-10 rebalance,
 * I-11). The agenda, map-control and bank routes now assess the day's tax
 * before their own write, so a client that never calls /api/village/tax is
 * still taxed. Each reply echoes what the assessment did as `villageTax`, with
 * the same contract as lib/village-tax-api.ts: adopt `ryo` / `bankRyo` when it
 * was applied, and the save version its day stamp produced in any case.
 */

import type { Character } from "../types/character";

export interface VillageTaxEcho {
    /** true only when ryo was actually debited. */
    applied: boolean;
    taxed: number;
    toBurn: number;
    toTreasury: number;
    /** Balances AFTER the debit. */
    ryo: number;
    bankRyo: number;
    /** The save version the assessment's write produced. */
    _saveVersion?: number;
}

/** The echo in a route's reply, or null when the reply carries none. Pure. */
export function readVillageTaxEcho(body: unknown): VillageTaxEcho | null {
    const raw = (body as { villageTax?: unknown } | null | undefined)?.villageTax as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== "object") return null;
    const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const version = Number(raw._saveVersion);
    return {
        applied: raw.applied === true,
        taxed: num(raw.taxed),
        toBurn: num(raw.toBurn),
        toTreasury: num(raw.toTreasury),
        ryo: num(raw.ryo),
        bankRyo: num(raw.bankRyo),
        ...(Number.isSafeInteger(version) && version > 0 ? { _saveVersion: version } : {}),
    };
}

/** The character with an applied tax's post-debit balances. Pure. */
export function characterWithVillageTax<T extends Pick<Character, "ryo" | "bankRyo">>(character: T, echo: VillageTaxEcho): T {
    return echo.applied ? { ...character, ryo: echo.ryo, bankRyo: echo.bankRyo } : character;
}

/** The notice for an applied tax, or null. */
export function villageTaxNotice(echo: VillageTaxEcho | null): string | null {
    if (!echo?.applied || echo.taxed <= 0) return null;
    return `Occupation tax: −${echo.taxed.toLocaleString()} ryo (half burned, half to the village treasury).`;
}
