import { readFile, writeFile } from 'node:fs/promises';
const directory = new URL(`../../.tmp/${process.env.PET_HEAP_DIR || 'pet-retention-before'}/`, import.meta.url);
const last = Number(process.env.PET_HEAP_LAST || 12);
function summarize(snapshot) {
    const { meta } = snapshot.snapshot, { nodes, edges, strings } = snapshot;
    const nf = meta.node_fields, ef = meta.edge_fields, stride = nf.length, edgeStride = ef.length;
    const types = meta.node_types[nf.indexOf('type')], edgeTypes = meta.edge_types[ef.indexOf('type')];
    const groups = {}, kinds = {}, resources = {}, browserObjects = {};
    let edge = 0;
    for (let node = 0; node < nodes.length; node += stride) {
        const type = types[nodes[node + nf.indexOf('type')]], name = strings[nodes[node + nf.indexOf('name')]];
        const bytes = nodes[node + nf.indexOf('self_size')], id = nodes[node + nf.indexOf('id')], key = `${type}: ${name}`;
        groups[key] ??= { count: 0, bytes: 0 }; groups[key].count++; groups[key].bytes += bytes;
        kinds[type] = (kinds[type] ?? 0) + bytes;
        if (type === 'object' && ['HTMLCanvasElement', 'WebGL2RenderingContext'].includes(name)) (browserObjects[name] ??= []).push(id);
        for (let count = nodes[node + nf.indexOf('edge_count')]; count > 0; count--, edge += edgeStride) {
            if (edgeTypes[edges[edge + ef.indexOf('type')]] !== 'property') continue;
            const property = strings[edges[edge + ef.indexOf('name_or_index')]];
            if (['isWebGLRenderer', 'isScene', 'isTexture', 'isMaterial', 'isBufferGeometry', 'isSkinnedMesh'].includes(property)) {
                (resources[property] ??= []).push(id);
            }
        }
    }
    return { groups, kinds, resources, browserObjects };
}
const before = summarize(JSON.parse(await readFile(new URL('cycle-1.heapsnapshot', directory), 'utf8')));
const after = summarize(JSON.parse(await readFile(new URL(`cycle-${last}.heapsnapshot`, directory), 'utf8')));
const resourceCounts = Object.fromEntries([...new Set([...Object.keys(before.resources), ...Object.keys(after.resources)])].map(key => [key, {
    before: before.resources[key]?.length ?? 0, after: after.resources[key]?.length ?? 0,
    survivingIds: (after.resources[key] ?? []).filter(id => before.resources[key]?.includes(id)).length,
}]));
const report = { cycles: [1, last], resourceCounts, browserObjects: { before: before.browserObjects, after: after.browserObjects },
    bytesByKind: { before: before.kinds, after: after.kinds },
    largestGrowth: Object.entries(after.groups).map(([name, value]) => ({ name, countBefore: before.groups[name]?.count ?? 0,
        countAfter: value.count, bytesDelta: value.bytes - (before.groups[name]?.bytes ?? 0) })).sort((a, b) => b.bytesDelta - a.bytesDelta).slice(0, 25) };
await writeFile(new URL('heap-analysis.json', directory), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ resourceCounts, browserObjects: report.browserObjects, largestGrowth: report.largestGrowth.slice(0, 6) }, null, 2));
