import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Vite loads `shinobij.client/vite.config.ts` through Node once
// `configLoader: 'native'` becomes the default, and Node's ESM resolver has no
// extension guessing. Every relative specifier the config pulls in therefore
// needs an explicit extension, or the config stops loading on that upgrade.
// Vite already warns about this at build time; this gate turns the warning into
// a failure so the fix cannot silently regress.
//
// Deliberately NOT asserted here: the companion "ESM syntax in a file loaded as
// CommonJS" warning for the `shared/*.ts` modules. The repository root is a
// CommonJS package scope on purpose — `tsc -p tsconfig.cpanel.json` emits the
// CJS `dist/server.js` + `dist/api/**` that Railway runs, and those `require()`
// the emitted `dist/shared/*.js`. Marking `shared/` as ESM fails that build with
// TS1479, so the warning stands until the whole root scope migrates.

const CLIENT_DIR = fileURLToPath(new URL('../shinobij.client/', import.meta.url));

/**
 * Every Vite config, not just the main one. `vite.config.perf.mts` imported
 * `./vite.config` extensionless and carried the identical latent break — it is
 * loaded by the same Vite config loader via `build:warfront-e2e`, so the same
 * upgrade would take it out too. Scanning the directory means a NEW vite config
 * is covered the day it is added rather than the day someone remembers.
 *
 * Playwright configs are deliberately out of scope: `playwright.*.config.ts`
 * import `./e2e-ports` extensionless, but Playwright resolves its own config
 * through its own transpiler, not Vite's config loader, so they are neither
 * warned about today nor affected by this Vite change. Adding extensions there
 * would risk seven e2e suites for no gain.
 */
function viteConfigPaths() {
    return readdirSync(CLIENT_DIR)
        .filter((name) => /^vite\.config(\..+)?\.(ts|mts|cts|js|mjs|cjs)$/.test(name))
        .sort();
}

/** Static `from '...'` specifiers plus dynamic `import('...')` calls. */
const RELATIVE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.[^'"]*)['"]/g;

/**
 * A specifier is resolvable only if it ends in a real module extension. Testing
 * for "the basename contains a dot" is NOT good enough and silently missed a
 * live offender: `./vite.config` has a dot inside the FILENAME, so the loose
 * check read `.config` as an extension and passed a specifier that Vite warns
 * about. Match the extension set explicitly instead.
 */
const MODULE_EXTENSION = /\.(?:[cm]?tsx?|[cm]?jsx?|json|css)$/;

export function extensionlessRelativeImports(source) {
    const offenders = [];
    for (const [, specifier] of source.matchAll(RELATIVE_SPECIFIER)) {
        const basename = specifier.slice(specifier.lastIndexOf('/') + 1);
        if (!MODULE_EXTENSION.test(basename)) offenders.push(specifier);
    }
    return offenders;
}

test('the extensionless-import detector flags bare specifiers and accepts explicit ones', () => {
    assert.deepEqual(
        extensionlessRelativeImports(`
            import { a } from './src/lib/player-auth-policy';
            import { b } from '../shared/shrines';
            const c = await import('./dev-session-auth');
        `),
        ['./src/lib/player-auth-policy', '../shared/shrines', './dev-session-auth'],
    );

    // Regression: a dot INSIDE the filename is not an extension. This exact
    // specifier shipped in vite.config.perf.mts, Vite warned about it, and a
    // "basename contains a dot" check waved it through.
    assert.deepEqual(
        extensionlessRelativeImports(`import base from "./vite.config";`),
        ['./vite.config'],
    );
    assert.deepEqual(extensionlessRelativeImports(`import base from "./vite.config.ts";`), []);
    assert.deepEqual(extensionlessRelativeImports(`import x from "./a.config.mts";`), []);

    assert.deepEqual(
        extensionlessRelativeImports(`
            import { a } from './src/lib/player-auth-policy.ts';
            import { b } from '../shared/shrines.ts';
            import plugin from '@vitejs/plugin-react';
            import fs from 'fs';
            const c = await import('./dev-session-auth.ts');
        `),
        [],
    );
});

test('every Vite config imports its relative modules with an explicit extension', () => {
    const configs = viteConfigPaths();

    // Guard the scan itself: a rename that made the pattern match nothing would
    // otherwise turn this whole gate into a silent pass.
    assert.ok(
        configs.includes('vite.config.ts'),
        `expected to find vite.config.ts in shinobij.client/, saw: ${configs.join(', ') || '(nothing)'}`,
    );

    const offenders = configs.flatMap((name) =>
        extensionlessRelativeImports(readFileSync(CLIENT_DIR + name, 'utf8')).map(
            (specifier) => `${name} -> ${specifier}`,
        ),
    );

    assert.deepEqual(
        offenders,
        [],
        `these Vite configs import relative modules without a file extension: ${offenders.join('; ')}. `
            + "Add the extension (e.g. './dev-session-auth.ts') so the config still loads under "
            + "Vite's native config loader.",
    );
});
