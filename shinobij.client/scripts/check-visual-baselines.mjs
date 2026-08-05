import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../e2e-visual/__snapshots__/', import.meta.url));
const maxFiles = 8;
const maxBytes = 3 * 1024 * 1024;

let entries;
try {
    entries = await readdir(root, { recursive: true, withFileTypes: true });
} catch (error) {
    console.error(`Visual baseline directory is missing: ${root}`);
    process.exitCode = 1;
    entries = [];
}

const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.png'));
const paths = files.map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
const sizes = await Promise.all(paths.map(async (file) => (await stat(file)).size));
const totalBytes = sizes.reduce((total, size) => total + size, 0);

console.log(JSON.stringify({ files: files.length, totalBytes, maxFiles, maxBytes }));
if (files.length < 3 || files.length > maxFiles || totalBytes > maxBytes) process.exitCode = 1;
