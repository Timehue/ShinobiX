import { reportError } from "./sentry";

/**
 * Report a fitted world figure that has given up and left the portrait pin in
 * its place. Without this, a browser that can never show figures, or an art
 * host that keeps failing, looks exactly like a healthy session.
 *
 * Only Sentry's error message survives its beforeSend scrub, so the reason and
 * stage are spelled out there. Nothing identifying goes in: no URLs, no asset
 * ids, no player names. Each distinct message is sent once per page session,
 * so a crowded sector of failing figures is one event, not dozens, and healthy
 * players never load the Sentry SDK at all.
 */

export type SectorModelStage = "manifest" | "facing" | "page";

const reported = new Set<string>();

/** The first browser feature fitted figures need that this browser lacks. */
export function missingSectorModelFeature(scope: Record<string, unknown> = globalThis as Record<string, unknown>): string | undefined {
    if (typeof scope.DecompressionStream !== "function") return "DecompressionStream";
    if (typeof scope.Worker !== "function") return "Worker";
    if (typeof scope.WebAssembly !== "object" || scope.WebAssembly === null) return "WebAssembly";
    const subtle = (scope.crypto as { subtle?: { digest?: unknown } } | undefined)?.subtle;
    if (typeof subtle?.digest !== "function") return "crypto.subtle";
    return undefined;
}

function describe(error: unknown): string {
    if (!(error instanceof Error)) return "";
    // A stable, short cause: the type and our own fixed message, never a URL.
    const message = error.message.replace(/https?:\/\/\S+/g, "[url]").slice(0, 80);
    return ` (${error.name}: ${message})`;
}

function send(message: string, report: (error: unknown) => void) {
    if (reported.has(message)) return;
    reported.add(message);
    const error = new Error(message);
    error.name = "SectorModelFallback";
    report(error);
}

export function reportSectorModelUnsupported(feature: string, report: (error: unknown) => void = reportError) {
    send(`Sector model unsupported: missing ${feature}`, report);
}

export function reportSectorModelUnavailable(stage: SectorModelStage, playerMade: boolean, error?: unknown,
    report: (error: unknown) => void = reportError) {
    send(`Sector model unavailable at ${stage} for a ${playerMade ? "player-made" : "roster"} model${describe(error)}`, report);
}

/** For tests only. */
export function resetSectorModelHealthForTests() { reported.clear(); }
