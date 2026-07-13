import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';

const root = resolve(import.meta.dirname, '..');
const scanRoots = ['api', 'scripts', 'shinobij.client/src'];
const files = ['cpanel-dns.test.cjs', 'server-routes.test.ts'];

function collect(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) collect(absolute);
        else if (/\.test\.(?:ts|mjs|cjs)$/.test(entry.name)) files.push(relative(root, absolute).replaceAll('\\', '/'));
    }
}

for (const dir of scanRoots) collect(join(root, dir));
const uniqueFiles = [...new Set(files)].sort();
const tests = run({ cwd: root, files: uniqueFiles, concurrency: true });
tests.on('test:fail', () => { process.exitCode = 1; });
tests.compose(spec()).pipe(process.stdout);
