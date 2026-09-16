import { before, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'account-name-test-secret-at-least-32-chars';
let kv: typeof import('../_storage.js').kv;
let auth: typeof import('../_auth.js');
let passwordAuth: typeof import('../player-auth.js');
let rename: typeof import('./account-name.js').default;
let resolveLogin: typeof import('../_account-name.js').resolveAccountLogin;
before(async () => {
    ({ kv } = await import('../_storage.js'));
    auth = await import('../_auth.js');
    passwordAuth = await import('../player-auth.js') as unknown as typeof passwordAuth;
    rename = (await import('./account-name.js')).default as unknown as typeof rename;
    resolveLogin = (await import('../_account-name.js')).resolveAccountLogin;
});
let serial = 0;
async function call(handler: typeof rename, body: object, token?: string) {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader() { return res; }, status(status: number) { out.status = status; return res; }, json(body: Record<string, any>) { out.body = body; return res; }, end() { return res; } };
    await handler({ method: 'POST', body, headers: { ...(token ? { 'x-player-token': token } : {}), 'x-forwarded-for': `10.5.0.${++serial}` }, socket: { remoteAddress: `10.5.0.${serial}` } } as never, res as never);
    return out;
}
async function seed(name: string, passwordless = false) {
    await kv.set(`auth:${name.toLowerCase()}`, passwordless ? { google: { sub: name, linkedAt: 1 } } : { salt: 'qa-salt', hash: passwordAuth.hashPw('ExamplePass123', 'qa-salt') });
    const character = { name, level: 5, ryo: 321, clan: 'test-clan', pets: [], maxHp: 100, hp: 100, maxChakra: 100, chakra: 100, maxStamina: 100, stamina: 100 };
    await kv.set(`save:${name.toLowerCase()}`, { _saveVersion: 7, character, missionProgress: { original: 9 } });
    return auth.issuePlayerToken(name)!;
}

test('rename changes login and public projection without moving identity, credentials or progress', async () => {
    const token = await seed('RenameOriginal');
    const result = await call(rename, { playerName: 'RenameOriginal', accountName: 'NewShinobi' }, token);
    assert.equal(result.status, 200);
    assert.equal(result.body.character.name, 'RenameOriginal');
    assert.equal(result.body.character.accountName, 'NewShinobi');
    assert.equal(result.body.character.ryo, 321);
    assert.equal(result.body.character.clan, 'test-clan');
    assert.equal(result.body._saveVersion, 8);
    assert.deepEqual((await kv.get<any>('save:renameoriginal')).missionProgress, { original: 9 });
    assert.equal(await kv.get('save:newshinobi'), null);
    assert.equal(await auth.verifyPlayerToken(token), 'renameoriginal');
    const oldLogin = await call(passwordAuth.default, { action: 'verify', name: 'RenameOriginal', password: 'ExamplePass123' });
    assert.equal(oldLogin.body.ok, false);
    const newLogin = await call(passwordAuth.default, { action: 'verify', name: 'newshinobi', password: 'ExamplePass123' });
    assert.equal(newLogin.body.ok, true);
    assert.equal(newLogin.body.name, 'RenameOriginal');
    assert.equal(await auth.verifyPlayerToken(newLogin.body.token), 'renameoriginal');
    const registry = await kv.hgetall<any>('player:registry');
    assert.equal(registry?.renameoriginal?.accountName, 'NewShinobi');
    const retry = await call(rename, { playerName: 'RenameOriginal', accountName: 'NewShinobi' }, token);
    assert.equal(retry.body._saveVersion, 8);
});

test('registration cannot claim a renamed login; another player cannot rename its owner', async () => {
    const a = await seed('renameone');
    const b = await seed('renametwo');
    assert.equal((await call(rename, { playerName: 'renameone', accountName: 'OnlyOneAlias' }, b)).status, 401);
    assert.equal((await call(rename, { playerName: 'renameone', accountName: 'OnlyOneAlias' }, a)).status, 200);
    assert.equal((await call(rename, { playerName: 'renametwo', accountName: 'onlyonealias' }, b)).status, 409);
    assert.equal((await call(passwordAuth.default, { action: 'register', name: 'onlyonealias', password: 'ExamplePass123' })).status, 409);
    assert.equal((await call(rename, { playerName: 'renameone', accountName: 'renametwo' }, a)).status, 409);
});

test('concurrent name claims have exactly one winner', async () => {
    const a = await seed('racerone');
    const b = await seed('racertwo');
    const results = await Promise.all([
        call(rename, { playerName: 'racerone', accountName: 'RaceAlias' }, a),
        call(rename, { playerName: 'racertwo', accountName: 'RaceAlias' }, b),
    ]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
});

test('passwordless owners can rename, reserved names cannot, and uncommitted aliases cannot log in', async () => {
    const token = await seed('googleowner', true);
    for (const accountName of ['rill', 'admin-two', 'x', 'bad name']) {
        assert.ok((await call(rename, { playerName: 'googleowner', accountName }, token)).status >= 400);
    }
    await kv.set('account-name:unfinishedalias', 'googleowner');
    assert.equal(await resolveLogin('unfinishedalias'), null);
    const result = await call(rename, { playerName: 'googleowner', accountName: 'UnfinishedAlias' }, token);
    assert.equal(result.status, 200);
    assert.equal(await resolveLogin('unfinishedalias'), 'googleowner');
    assert.equal((await kv.get<any>('auth:googleowner')).google.sub, 'googleowner');
});

test('generic save sanitization cannot forge or roll back the login name', async () => {
    const { sanitizeProgression } = await import('../save/_sanitize-progression.js');
    const forged: Record<string, unknown> = { name: 'owner', accountName: 'forged' };
    sanitizeProgression(forged, { accountName: 'CommittedName' }, { ...forged }, {}, false, {});
    assert.equal(forged.accountName, 'CommittedName');
    const first: Record<string, unknown> = { name: 'owner', accountName: 'forged' };
    sanitizeProgression(first, {}, { ...first }, null, true, {});
    assert.equal(first.accountName, undefined);
});

test('recovery and password changes still work after rename', async () => {
    const token = await seed('recoverowner');
    const { issueRecoveryCode } = await import('../_recovery-code.js');
    const recoveryCode = await issueRecoveryCode('recoverowner');
    await call(rename, { playerName: 'recoverowner', accountName: 'RecoverAlias' }, token);
    const recovered = await call(passwordAuth.default, { action: 'recover', name: 'RecoverAlias', recoveryCode, newPassword: 'ChangedPass456' });
    assert.equal(recovered.body.ok, true);
    assert.equal(await auth.verifyPlayerToken(recovered.body.token), 'recoverowner');
    assert.equal(await auth.verifyPlayerToken(token), null);
    const login = await call(passwordAuth.default, { action: 'verify', name: 'RecoverAlias', password: 'ChangedPass456' });
    assert.equal(login.body.ok, true);
    const changed = await call(passwordAuth.default, { action: 'change', name: 'recoverowner', oldPassword: 'ChangedPass456', newPassword: 'LastPassword789' }, login.body.token);
    assert.equal(changed.body.ok, true);
    assert.equal((await call(passwordAuth.default, { action: 'verify', name: 'RecoverAlias', password: 'LastPassword789' })).body.ok, true);
});

test('friends and block lists store the same permanent player reference after a rename', async () => {
    const ownerToken = await seed('socialowner');
    const viewerToken = await seed('socialviewer');
    await call(rename, { playerName: 'socialowner', accountName: 'SocialAlias' }, ownerToken);
    const friends = (await import('./friends.js')).default as unknown as typeof rename;
    const blocks = (await import('./blocks.js')).default as unknown as typeof rename;
    const added = await call(friends, { playerName: 'socialviewer', targetName: 'SocialAlias', list: 'friends' }, viewerToken);
    assert.equal(added.status, 200);
    assert.deepEqual(added.body.friends, ['socialowner']);
    const blocked = await call(blocks, { target: 'SocialAlias', blocked: true }, viewerToken);
    assert.equal(blocked.status, 200);
    assert.deepEqual(blocked.body.blocked, ['socialowner']);
    const unblocked = await call(blocks, { target: 'socialowner', blocked: false }, viewerToken);
    assert.deepEqual(unblocked.body.blocked, []);
});

test('messages and transfers addressed to a new name reach the existing account', async () => {
    const targetToken = await seed('recipientowner');
    const senderToken = await seed('sendershinobi');
    const senderSave = (await kv.get<any>('save:sendershinobi'))!;
    await kv.set('save:sendershinobi', { ...senderSave, character: { ...senderSave.character, ryo: 2000 } });
    await call(rename, { playerName: 'recipientowner', accountName: 'RecipientAlias' }, targetToken);
    const messages = (await import('../messages.js')).default as unknown as typeof rename;
    const message = await call(messages, { to: 'RecipientAlias', text: 'Testing the renamed account inbox.' }, senderToken);
    assert.equal(message.status, 200);
    assert.ok((await kv.get<unknown[]>('dm:inbox:recipientowner'))?.length);
    assert.equal(await kv.get('dm:inbox:recipientalias'), null);
    const trade = (await import('./trade.js')).default as unknown as typeof rename;
    const transfer = await call(trade, { playerName: 'sendershinobi', toPlayer: 'RecipientAlias', currency: 'ryo', amount: 1000, nonce: 'qa-rename-transfer-01' }, senderToken);
    assert.equal(transfer.status, 200, JSON.stringify(transfer.body));
    assert.equal((await kv.get<any>('save:sendershinobi')).character.ryo, 1000);
    assert.equal((await kv.get<any>('save:recipientowner')).character.ryo, 321 + transfer.body.credit);
});
