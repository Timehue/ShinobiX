import assert from 'node:assert/strict';
import test from 'node:test';
import { betaReportUrl, fetchBetaReport } from './beta-daily-report.mjs';

test('beta report URL is bounded, aggregate population is explicit, and credentials stay in headers', async () => {
  const calls = [];
  const body = await fetchBetaReport({
    baseUrl: 'https://staging.example/game?secret=no',
    adminPassword: 'operator-secret',
    days: 999,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response('ok', { status: 200 });
    },
  });
  assert.equal(body, 'ok');
  assert.equal(calls[0].url, 'https://staging.example/api/admin/beta-metrics?days=60&includePopulation=1&format=text');
  assert.equal(calls[0].url.includes('operator-secret'), false);
  assert.equal(calls[0].init.headers['x-admin-password'], 'operator-secret');
});

test('beta report refuses plaintext remote transport and missing admin credentials', async () => {
  assert.throws(() => betaReportUrl('http://example.com'), /require HTTPS/);
  assert.equal(betaReportUrl('http://127.0.0.1:3000').protocol, 'http:');
  await assert.rejects(() => fetchBetaReport({ baseUrl: 'https://example.com', adminPassword: '' }), /ADMIN_PASSWORD/);
});
