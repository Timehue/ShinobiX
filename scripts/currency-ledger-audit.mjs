/*
 * Compatibility entrypoint for the former currency-only scanner.
 *
 * Currency truth is now certified inside data-integrity-scan.mjs so ledger
 * state is evaluated alongside the authoritative save, forged definitions,
 * strict-ledger candidates, and canonical content under one target guard.
 * Keep this shim so existing operator commands continue to work without
 * retaining a second, less-safe backfill implementation.
 */
const backfillIndex = process.argv.indexOf('--backfill');
if (backfillIndex >= 0) process.argv.splice(backfillIndex, 1, '--repair');
await import('./data-integrity-scan.mjs');
