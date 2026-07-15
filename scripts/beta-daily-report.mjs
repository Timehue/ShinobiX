#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function betaReportUrl(base, { days = 1, includePopulation = true, format = 'text' } = {}) {
  const url = new URL(base);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('Beta reports require HTTPS except on localhost.');
  }
  url.pathname = '/api/admin/beta-metrics';
  url.search = '';
  url.searchParams.set('days', String(Math.max(1, Math.min(60, Math.floor(Number(days) || 1)))));
  if (includePopulation) url.searchParams.set('includePopulation', '1');
  if (format === 'text') url.searchParams.set('format', 'text');
  return url;
}

export async function fetchBetaReport({ baseUrl, adminPassword, days, includePopulation = true, format = 'text', fetchImpl = fetch }) {
  if (!adminPassword) throw new Error('ADMIN_PASSWORD is required.');
  const url = betaReportUrl(baseUrl, { days, includePopulation, format });
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { accept: format === 'text' ? 'text/plain' : 'application/json', 'x-admin-password': adminPassword },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Beta report failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
  return body;
}

async function main() {
  const baseUrl = process.argv[2];
  if (!baseUrl) throw new Error('Usage: npm run beta:report -- https://staging-host [days] [--json] [--no-population]');
  const format = process.argv.includes('--json') ? 'json' : 'text';
  const includePopulation = !process.argv.includes('--no-population');
  const daysArg = process.argv.slice(3).find((arg) => /^\d+$/.test(arg));
  const output = await fetchBetaReport({
    baseUrl,
    adminPassword: process.env.ADMIN_PASSWORD,
    days: Number(daysArg ?? 1),
    includePopulation,
    format,
  });
  process.stdout.write(`${output.trim()}\n`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`[beta-report] FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
