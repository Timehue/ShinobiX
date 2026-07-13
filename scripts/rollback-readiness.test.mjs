import assert from 'node:assert/strict';
import test from 'node:test';
import { destructiveSchemaStatements, stripSqlComments, validateRollbackReadiness } from './rollback-readiness-lib.mjs';

const good = () => ({
    schemaSql: 'create table if not exists public.kv_store (key text primary key);',
    railway: { deploy: { numReplicas: 1, healthcheckPath: '/health', restartPolicyType: 'ON_FAILURE' } },
    packageJson: { scripts: { 'drill:restore': 'restore', 'test:backup': 'test' } },
});

test('comment stripping prevents documentation examples from tripping the gate', () => {
    assert.equal(stripSqlComments('-- drop table saves\nselect 1; /* truncate table kv_store */').trim(), 'select 1;');
    assert.deepEqual(destructiveSchemaStatements('-- drop table saves'), []);
});

test('destructive table, column, and truncate changes fail readiness', () => {
    for (const sql of ['drop table public.kv_store;', 'alter table public.kv_store drop column value;', 'truncate table public.kv_store;']) {
        const input = good(); input.schemaSql += sql;
        const verdict = validateRollbackReadiness(input);
        assert.equal(verdict.ok, false, sql);
        assert.match(verdict.failures.join(' '), /destructive schema/i);
    }
});

test('single-replica, health, restart, restore, and backup controls are required', () => {
    assert.equal(validateRollbackReadiness(good()).ok, true);
    const scaled = good(); scaled.railway.deploy.numReplicas = 2;
    assert.match(validateRollbackReadiness(scaled).failures.join(' '), /one replica/i);
    const noRestore = good(); delete noRestore.packageJson.scripts['drill:restore'];
    assert.match(validateRollbackReadiness(noRestore).failures.join(' '), /drill:restore/);
});
