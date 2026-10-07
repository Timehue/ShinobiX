import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const sources = JSON.parse(await fs.readFile('output/connected-world/floor-sources.json', 'utf8'));
const tasks = JSON.parse(await fs.readFile('output/connected-world/tasks.json', 'utf8'));
const layouts = JSON.parse(await fs.readFile('output/connected-world/layouts.json', 'utf8'));
const entries = Array.isArray(sources) ? sources.map(entry => [entry.sector, entry]) : Object.entries(sources);
for (const [sector, entry] of entries) {
    const task = tasks.find(t => t.id === Number(sector));
    if (!task) throw new Error(`Unknown sector ${sector}`);
    const layoutSha = createHash('sha256').update(JSON.stringify(layouts[task.artKey])).digest('hex');
    try {
        const previous = JSON.parse(await fs.readFile(`output/connected-world/s${task.artKey}-provenance.json`, 'utf8'));
        // Earlier 200 KiB encodings are already valid under the handoff's
        // 250 KiB hard cap. Retain them instead of increasing their payload.
        if (previous.source === entry.path && previous.prompt === entry.prompt && previous.layoutSha256 === layoutSha
            && previous.bytes <= 250 * 1024 && [200 * 1024, 250 * 1024].includes(previous.budgetBytes)) {
            await fs.access(previous.output);
            continue;
        }
    } catch { /* A missing candidate needs encoding. */ }
    const promptPath = 'output/connected-world/s' + task.artKey + '-source-prompt.txt';
    await fs.writeFile(promptPath, entry.prompt);
    const p = spawnSync(process.execPath, ['scripts/prepare-sector-art.mjs', sector, entry.path, promptPath,
        ...(entry.referenceManifest ? [entry.referenceManifest] : [])], { encoding: 'utf8' });
    if (p.status !== 0) throw new Error(p.stderr);
    console.log(p.stdout.trim());
}
