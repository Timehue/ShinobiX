import { readFile } from 'node:fs/promises';
import { reconcileModelCost } from '../api/avatar-model/_cost-reconciliation.js';

async function main() {
    const [file, mode, ...extra] = process.argv.slice(2);
    if (!file || file.startsWith('--') || (mode !== undefined && mode !== '--apply') || extra.length)
        throw new Error('Usage: node --import tsx scripts/reconcile-avatar-cost.ts statement.json [--apply]');
    const statement = JSON.parse(await readFile(file, 'utf8'));
    console.log(JSON.stringify(await reconcileModelCost(statement, mode === '--apply')));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
