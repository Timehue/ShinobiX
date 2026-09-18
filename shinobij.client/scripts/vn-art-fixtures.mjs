import { readFile } from 'node:fs/promises';
const audit = JSON.parse(await readFile(new URL('../../docs/art-audit/live-art-recheck.json', import.meta.url), 'utf8'));
const hashes = new Map(audit.rows.map(row => [row.id, row.sha256]));
export function legacyVnFixture(id) {
    const hash = hashes.get(id);
    if (!hash) throw new Error(`Unreviewed fixture: ${id}`);
    return readFile(new URL(`../e2e/fixtures/vn-identity-audit/${hash}.webp`, import.meta.url));
}
export const replacementVnFixture = () => legacyVnFixture('vn:story-frostfang-village-85-7:page:0');
