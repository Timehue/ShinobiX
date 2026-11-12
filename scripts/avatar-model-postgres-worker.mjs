// IPC-only fixture for the real-Postgres admission race. Never a public route.
import { createServer } from 'node:http';

const database = new URL(process.env.DATABASE_URL ?? '');
if (!process.send || process.env.SHINOBIX_QA_DISPOSABLE_PG !== '1'
    || !['127.0.0.1', 'localhost'].includes(database.hostname)
    || !/^\/pgit_model_admission_[a-f0-9]+$/.test(database.pathname)) {
    throw new Error('A newly allocated local model-admission test database is required.');
}
delete process.env.SHINOBIX_QA_MEMORY_KV;
const { closeStoragePool } = await import('../api/_storage.js');
const { issuePlayerToken } = await import('../api/_auth.js');
const { issueModelRead } = await import('../api/avatar-model/_admission.js');
const { removePlayerModel } = await import('../api/avatar-model/_removal.js');
const { sweepDeletedModelOwners } = await import('../api/avatar-model/_account-erasure.js');
const { pushOfflineNotice } = await import('../api/player/_offline-notices.js');
const handler = (await import('../api/avatar-model/jobs.js')).default;
const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/api/avatar-model/jobs') { res.writeHead(404).end(); return; }
    let raw = '';
    for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 1024) { res.writeHead(413).end(); return; }
    }
    req.body = JSON.parse(raw);
    req.query = {};
    res.status = code => { res.statusCode = code; return res; };
    res.json = body => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return res; };
    try { await handler(req, res); }
    catch { res.status(500).json({ error: 'fixture-handler-failed' }); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
process.send({ ready: true, port: server.address().port });
process.on('message', async ({ id, command, input }) => {
    try {
        if (!/^pgmodel[a-f0-9]+$/.test(input.slug)) throw new Error('Invalid fixture owner');
        let value;
        if (command === 'token') value = issuePlayerToken(input.slug);
        else if (command === 'read') value = await issueModelRead({
            slug: input.slug, sourceSha256: input.source, masterSha256: 'd'.repeat(64),
            pipelineVersion: 'pg-admission-fixture', kitVersion: 'pg-admission-fixture',
            path: 'A', summary: 'Completed fixture portrait read', revision: 0, expiresAt: Date.now() + 300_000,
        });
        else if (command === 'remove') value = await removePlayerModel(input, 'admin:full');
        else if (command === 'erase') value = await sweepDeletedModelOwners();
        else if (command === 'notice') await pushOfflineNotice(input.slug, {
            kind: 'bounty-placed', by: 'Fixture', sector: 0, at: Date.now(), amount: 100, total: 100,
        });
        else throw new Error('Unknown fixture command');
        process.send({ id, value });
    } catch { process.send({ id, error: 'fixture-command-failed' }); }
});
process.on('disconnect', async () => {
    server.closeAllConnections(); server.close();
    await closeStoragePool();
    process.exit(0);
});
