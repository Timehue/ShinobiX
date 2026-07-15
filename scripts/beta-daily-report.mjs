#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const APPROVED_REPORT_ORIGINS = new Map([
  ['https://shinobijourney.com', 'https://shinobijourney.com'],
  ['https://www.shinobijourney.com', 'https://www.shinobijourney.com'],
  ['http://127.0.0.1:3000', 'http://127.0.0.1:3000'],
  ['http://localhost:3000', 'http://localhost:3000'],
]);

export function betaReportUrl(base, { days = 1, includePopulation = true, format = 'text' } = {}) {
  const requested = new URL(base);
  const approvedBase = APPROVED_REPORT_ORIGINS.get(requested.origin);
  if (!approvedBase) throw new Error('Beta reports require an approved ShinobiX origin (or fixed localhost development origin).');
  const url = new URL(approvedBase);
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
  if (!baseUrl) throw new Error('Usage: npm run beta:report -- https://shinobijourney.com [days] [--json] [--no-population]');
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
