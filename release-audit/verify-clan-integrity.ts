import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.PORT = '0';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
process.env.ADMIN_PASSWORD = randomBytes(16).toString('hex');
process.env.DISABLE_SCHEDULED_JOBS = '1';
process.env.DISABLE_REALTIME = '1';
process.env.DISABLE_SNAPSHOT_CRON = '1';
process.env.SENTRY_DSN = '';

type Json = Record<string, any>;

async function main() {
    const [{ kv }, { issuePlayerToken }, serverModule] = await Promise.all([
        import('../api/_storage.js'),
        import('../api/_auth.js'),
        import('../server.js'),
    ]);
    const server = serverModule.server;
    try {
        if (!server.listening) await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('server did not bind');
        const base = `http://127.0.0.1:${address.port}`;

        const actor = 'auditmember';
        const founder = 'auditfounder';
        const clan = 'AuditClan';
        const third = 'auditthird';
        const rival = 'RivalClan';
        const character = (name: string, clanFounder = false) => ({
            name,
            clan,
            clanFounder,
            village: 'Stormveil Village',
            level: 40,
            hp: 100,
            maxHp: 100,
            inventory: [],
            itemStacks: [],
        });

        await Promise.all([
            // Deliberately seed a stale/forged local founder flag. Authority
            // must come from the locked clan record, never this character bit.
            kv.set(`save:${actor}`, { character: character(actor, true), _saveVersion: 1 }),
            kv.set(`save:${founder}`, { character: character(founder, true), _saveVersion: 1 }),
            kv.set(`save:${third}`, { character: character(third), _saveVersion: 1 }),
            kv.set('save:clan-auditclan', {
                name: clan,
                village: 'Stormveil Village',
                founderName: founder,
                createdAt: Date.now() - 86_400_000,
                members: [
                    { name: founder, role: 'leader', isFounder: true },
                    { name: actor, role: 'member' },
                    { name: third, role: 'member' },
                    ...Array.from({ length: 7 }, (_, index) => ({ name: `auditmember${index + 4}`, role: 'member' })),
                ],
                roleOverrides: {},
                treasury: {
                    ryo: 0,
                    fateShards: 0,
                    boneCharms: 0,
                    auraStones: 0,
                    mythicSeals: 0,
                    warSupply: 0,
                    items: [{ itemId: 'territory-control-scroll', count: 75 }],
                },
            }),
            kv.set('save:clan-rivalclan', {
                name: rival,
                village: 'Leaf Village',
                founderName: 'rivalfounder',
                createdAt: Date.now() - 86_400_000,
                members: [{ name: 'rivalfounder', isFounder: true }],
                treasury: { items: [] },
                xp: 0,
                level: 1,
            }),
            kv.set('world:territory:40', {
                sector: 40,
                controlScore: 0,
                hp: 20_000,
                terrainBuffStat: 'bukijutsuOffense',
                guards: [],
                warSupply: 0,
                updatedAt: Date.now() - 1_000,
            }),
            kv.set('clan-war:auditclan-vs-rivalclan', {
                id: 'auditclan-vs-rivalclan',
                clans: [clan, rival],
                villages: { [clan]: 'Stormveil Village', [rival]: 'Leaf Village' },
                hp: { [clan]: 1_000, [rival]: 1_000 },
                startedAt: Date.now() - 60_000,
                updatedAt: Date.now() - 60_000,
                declaredBy: founder,
                pendingChallenges: [],
                completedChallenges: [],
            }),
        ]);

        const actorToken = issuePlayerToken(actor);
        const founderToken = issuePlayerToken(founder);
        if (!actorToken || !founderToken) throw new Error('tokens not issued');

        async function request(path: string, method: string, token: string, asName: string, body?: unknown) {
            const response = await fetch(`${base}${path}`, {
                method,
                headers: {
                    'content-type': 'application/json',
                    'x-player-token': token,
                    'x-player-name': asName,
                },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            return {
                status: response.status,
                body: await response.json().catch(() => ({})) as Json,
            };
        }

        const exploitAttempt = await request('/api/world-state', 'POST', actorToken, actor, {
            kind: 'territory',
            territory: {
                sector: 40,
                controlScore: 1_000,
                hp: 20_000,
                ownerClan: clan,
                ownerVillage: 'Stormveil Village',
                terrainBuffStat: 'ninjutsuOffense',
                guards: [],
                warSupply: 0,
                updatedAt: Date.now(),
            },
        });
        const territoryAfterExploit = await kv.get<Json>('world:territory:40');

        const memberAssignment = await request('/api/clan/territory/assign-scrolls', 'POST', actorToken, actor, {
            playerName: actor,
            clan,
            sector: 40,
            count: 75,
            weather: 'rain',
            terrainBuffStat: 'ninjutsuOffense',
            requestId: randomUUID(),
        });
        const clanAfterMemberAssignment = await kv.get<Json>('save:clan-auditclan');

        const assignmentRequestId = randomUUID();
        const assignmentBody = {
            playerName: founder,
            clan,
            sector: 40,
            count: 75,
            weather: 'rain',
            terrainBuffStat: 'ninjutsuOffense',
            requestId: assignmentRequestId,
        };
        const assignment = await request('/api/clan/territory/assign-scrolls', 'POST', founderToken, founder, assignmentBody);
        const assignmentReplay = await request('/api/clan/territory/assign-scrolls', 'POST', founderToken, founder, assignmentBody);
        const clanAfterTerritory = await kv.get<Json>('save:clan-auditclan');
        const territoryAfterAssignment = await kv.get<Json>('world:territory:40');

        const deletion = await request('/api/save/clan-auditclan', 'DELETE', founderToken, founder);
        const clanAfterDelete = await kv.get<Json>('save:clan-auditclan');
        const memberAfterDelete = await kv.get<Json>(`save:${actor}`);
        const founderAfterDelete = await kv.get<Json>(`save:${founder}`);
        const thirdAfterDelete = await kv.get<Json>(`save:${third}`);
        const territoryAfterDelete = await kv.get<Json>('world:territory:40');
        const warAfterDelete = await kv.get<Json>('clan-war:auditclan-vs-rivalclan');

        const result = {
            territory: {
                ordinaryMember: actor,
                ordinaryMemberHadStaleFounderFlag: true,
                founder,
                clanScrollsBefore: 75,
                exploitStatus: exploitAttempt.status,
                exploitResponse: exploitAttempt.body,
                stateAfterExploit: territoryAfterExploit,
                ordinaryMemberAssignmentStatus: memberAssignment.status,
                ordinaryMemberAssignmentResponse: memberAssignment.body,
                assignmentStatus: assignment.status,
                assignmentResponse: assignment.body,
                replayStatus: assignmentReplay.status,
                replayResponse: assignmentReplay.body,
                ownerClan: territoryAfterAssignment?.ownerClan,
                controlScore: territoryAfterAssignment?.controlScore,
                clanScrollItemsAfter: clanAfterTerritory?.treasury?.items ?? null,
            },
            deletion: {
                status: deletion.status,
                response: deletion.body,
                clanRecordAfter: clanAfterDelete,
                ordinaryMemberClanAfter: memberAfterDelete?.character?.clan ?? null,
                founderClanAfter: founderAfterDelete?.character?.clan ?? null,
                thirdMemberClanAfter: thirdAfterDelete?.character?.clan ?? null,
                territoryAfter: territoryAfterDelete,
                warAfter: warAfterDelete,
            },
        };
        console.log(JSON.stringify(result, null, 2));

        const exploitBlocked = exploitAttempt.status === 403
            && territoryAfterExploit?.ownerClan === undefined
            && territoryAfterExploit?.controlScore === 0
            && memberAssignment.status === 403
            && clanAfterMemberAssignment?.treasury?.items?.[0]?.count === 75;
        const assignmentWorks = assignment.status === 200
            && assignment.body.territory?.ownerClan === clan
            && assignment.body.territory?.controlScore === 75_000
            && assignmentReplay.status === 200
            && assignmentReplay.body.replayed === true
            && Array.isArray(clanAfterTerritory?.treasury?.items)
            && clanAfterTerritory.treasury.items.length === 0;
        const deletionWorks = deletion.status === 200
            && clanAfterDelete === null
            && memberAfterDelete?.character?.clan == null
            && founderAfterDelete?.character?.clan == null
            && thirdAfterDelete?.character?.clan == null
            && territoryAfterDelete?.ownerClan === undefined
            && territoryAfterDelete?.controlScore === 0
            && warAfterDelete?.endedAt
            && warAfterDelete?.winnerClan === rival;
        if (!exploitBlocked || !assignmentWorks || !deletionWorks) process.exitCode = 1;
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

void main();
