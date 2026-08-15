import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rootPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const clientPackage = JSON.parse(readFileSync(new URL('../shinobij.client/package.json', import.meta.url), 'utf8'));

test('test:ci preserves the complete root test runner while bypassing only the local install hook', () => {
    assert.equal(rootPackage.scripts['test:ci'], rootPackage.scripts.test);
    assert.equal(rootPackage.scripts.pretest, 'npm ci --prefix shinobij.client');
    assert.equal(rootPackage.scripts['pretest:ci'], undefined);
    assert.match(rootPackage.scripts['test:ci'], /scripts\/run-tests\.mjs/);
});

test('split build entry points retain the complete developer and release build', () => {
    assert.equal(rootPackage.scripts['build:server'], 'tsc -p tsconfig.cpanel.json');
    assert.match(rootPackage.scripts['build:client'], /scripts\/build-client\.mjs/);
    assert.equal(
        rootPackage.scripts.build,
        'npm run build:server && npm run build:client && npm run verify:dist && npm run sizecheck',
    );
    assert.equal(
        clientPackage.scripts.build,
        'npm run check:story-content && tsc -b && vite build',
    );
});
