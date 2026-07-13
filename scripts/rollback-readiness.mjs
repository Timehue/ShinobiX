import { readFile } from 'node:fs/promises';
import { validateRollbackReadiness } from './rollback-readiness-lib.mjs';

const [schemaSql, railwayText, packageText] = await Promise.all([
    readFile('supabase-schema.sql', 'utf8'),
    readFile('railway.json', 'utf8'),
    readFile('package.json', 'utf8'),
]);
const verdict = validateRollbackReadiness({ schemaSql, railway: JSON.parse(railwayText), packageJson: JSON.parse(packageText) });
console.log(JSON.stringify(verdict, null, 2));
if (!verdict.ok) process.exitCode = 1;
