import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(clientRoot, 'dist');
const requestedName = process.argv[2] ?? '.playwright-dist-4173';

if (!/^\.playwright-dist-[a-z0-9_-]+$/i.test(requestedName)) {
    throw new Error(`Unsafe Playwright preview directory: ${requestedName}`);
}

const targetRoot = join(clientRoot, requestedName);
const stagingRoot = `${targetRoot}.staging-${process.pid}`;

function copyTree(source, target) {
    const stat = statSync(source);
    if (stat.isDirectory()) {
        mkdirSync(target, { recursive: true });
        for (const entry of readdirSync(source)) copyTree(join(source, entry), join(target, entry));
        return;
    }

    // Clone-on-write avoids duplicating hundreds of MB where the filesystem
    // supports it; Node falls back to a normal copy on other platforms.
    copyFileSync(source, target, constants.COPYFILE_FICLONE);
}

function validateSnapshot(root) {
    const indexPath = join(root, 'index.html');
    const assetsPath = join(root, 'assets');
    if (!existsSync(indexPath) || !existsSync(assetsPath)) return false;

    const html = readFileSync(indexPath, 'utf8');
    const localReferences = [...html.matchAll(/(?:src|href)="\/([^"?#]+)(?:[?#][^"]*)?"/g)]
        .map((match) => match[1]);
    return localReferences.length > 0
        && localReferences.every((relativePath) => existsSync(join(root, ...relativePath.split('/'))));
}

if (!validateSnapshot(sourceRoot)) {
    throw new Error('Build the client before running Playwright: dist is missing or incomplete.');
}

rmSync(stagingRoot, { recursive: true, force: true });
copyTree(sourceRoot, stagingRoot);

if (!validateSnapshot(stagingRoot)) {
    rmSync(stagingRoot, { recursive: true, force: true });
    throw new Error('The Playwright preview snapshot was incomplete; rebuild the client and retry.');
}

rmSync(targetRoot, { recursive: true, force: true });
renameSync(stagingRoot, targetRoot);
console.log(`[e2e] Isolated preview snapshot ready: ${requestedName}`);
