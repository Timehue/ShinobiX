/*
 * Narrow lazy boundary for the Sentry browser SDK.
 *
 * Dynamically importing the package namespace retains every public export.
 * Re-exporting only the three APIs the game uses lets Rollup tree-shake the
 * error-only chunk while sentry.ts keeps it off the healthy startup path.
 */
export { captureException, init, setUser } from "@sentry/react";
