/** Run only during the operator-controlled bounty refund cutover. Default: inspect. */
const args = new Set(process.argv.slice(2));
if ([...args].some(arg => !['--apply', '--writers-stopped'].includes(arg))) throw new Error('Usage: migrate-bounty-refund-escrow.mts [--apply --writers-stopped]');
if (args.has('--apply') && (!args.has('--writers-stopped') || process.env.BOUNTY_OWNER_REFUNDS_ENABLED === '1')) {
    throw new Error('Stop application writers and disable BOUNTY_OWNER_REFUNDS_ENABLED before applying the migration');
}
const { kv } = await import('../api/_storage.js');
const { BOUNTY_KEY } = await import('../api/pvp/_bounty.js');
const { inspectLegacyBountyRefunds, migrateLegacyBountyRefunds, pendingBountyOwnerRefunds } = await import('../api/pvp/_bounty-deleted-target.js');
const inspected = inspectLegacyBountyRefunds(await kv.get(BOUNTY_KEY));
console.log(JSON.stringify({ mode: args.has('--apply') ? 'apply' : 'inspect', legacyRefunds: inspected.legacyRefunds, blockers: inspected.blockers }));
if (inspected.blockers.length) process.exitCode = 1;
else if (args.has('--apply')) console.log(JSON.stringify({ migrated: await migrateLegacyBountyRefunds() }));
console.log(JSON.stringify({ pendingEscrowKeys: await pendingBountyOwnerRefunds() }));
