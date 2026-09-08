// Read-only by default. After draining the old runtime, --apply removes the
// seven-day TTL from surviving travel obligations without changing their value.
import { loadProjectEnv } from './_load-env.mjs';
await loadProjectEnv();
const { kv, closeStoragePool } = await import('../api/_storage.js');
const { retainTravelLeases } = await import('../api/_realtime/_travel-lease-retention.js');

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--apply')) throw new Error('Usage: node --import tsx scripts/travel-lease-retention.mjs [--apply]');
const apply = args.includes('--apply');
try {
    const summary = await retainTravelLeases(kv, apply);
    console.log(JSON.stringify(summary));
    if (summary.invalid) process.exitCode = 1;
} finally {
    await closeStoragePool();
}
