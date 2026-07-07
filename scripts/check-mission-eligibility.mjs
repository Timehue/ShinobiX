import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function fail(message) {
  failures.push(message);
}

function objectLines(src, marker) {
  return src.split(/\r?\n/).filter((line) => line.includes(marker) && line.includes('{'));
}

function idsFrom(src, prop) {
  const ids = [];
  const re = new RegExp(`\\b${prop}:\\s*['"]([^'"]+)['"]`, 'g');
  let match;
  while ((match = re.exec(src))) ids.push(match[1]);
  return ids;
}

function levelReqMap(src, prop) {
  const out = new Map();
  const re = new RegExp(`\\{[^{}]*?\\b${prop}:\\s*['"]([^'"]+)['"][^{}]*?\\blevelReq:\\s*(\\d+)`, 'g');
  let match;
  while ((match = re.exec(src))) out.set(match[1], Number(match[2]));
  return out;
}

function minMap(src) {
  const out = new Map();
  const re = /\{[^{}]*?\bkey:\s*['"]([^'"]+)['"][^{}]*?\bmin:\s*(\d+)/g;
  let match;
  while ((match = re.exec(src))) out.set(match[1], Number(match[2]));
  return out;
}

function duplicateCheck(label, ids) {
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) fail(`${label} has duplicate mission id/key/templateId: ${id}`);
    seen.add(id);
  }
}

const pool = read('api/missions/_pool.ts');
const weekly = read('api/missions/_weekly-board.ts');
const missionCatalog = read('api/missions/_mission-catalog.ts');
const clientMissions = read('shinobij.client/src/data/missions.ts');
const clientCombat = read('shinobij.client/src/data/combat-missions.ts');
const adminPanel = read('shinobij.client/src/screens/AdminPanel.tsx');
const creatorEligibility = read('shinobij.client/src/lib/creator-mission-eligibility.ts');

for (const line of objectLines(pool, 'templateId:').filter((line) => line.includes('profession:'))) {
  if (!line.includes('eligibility:')) fail(`daily mission template is missing eligibility: ${line.trim()}`);
}

for (const line of objectLines(weekly, "id: 'wk-")) {
  if (!line.includes('eligibility:')) fail(`weekly mission is missing eligibility: ${line.trim()}`);
}

if (!/wk-hollow-warden/.test(weekly)) fail('weekly catalog is missing Hollow Gate Warden regression fixture');
if (!/hollowGateWardenEligibility[\s\S]*minLevel:\s*100/.test(weekly)) fail('Hollow Gate Warden eligibility must require minLevel 100');
if (!/hollowGateWardenEligibility[\s\S]*requiresHollowGateUnlocked:\s*true/.test(weekly)) fail('Hollow Gate Warden eligibility must require Hollow Gate unlock');

for (const line of objectLines(missionCatalog, 'key:')) {
  if (line.includes('aiProfileId') && !line.includes('min:')) fail(`combat mission is missing min level: ${line.trim()}`);
}
for (const line of objectLines(missionCatalog, 'id:')) {
  if ((line.includes('exploreCount') || line.includes('raidCount')) && !line.includes('levelReq:')) {
    fail(`field/hunt mission is missing levelReq: ${line.trim()}`);
  }
}

duplicateCheck('daily profession pool', idsFrom(pool, 'templateId'));
duplicateCheck('weekly catalog', idsFrom(weekly, 'id'));
duplicateCheck('server field catalog', idsFrom(missionCatalog, 'id'));
duplicateCheck('server combat catalog', idsFrom(missionCatalog, 'key'));

const serverFieldLevels = levelReqMap(missionCatalog, 'id');
const clientFieldLevels = levelReqMap(clientMissions, 'id');
for (const [id, level] of serverFieldLevels) {
  if (clientFieldLevels.get(id) !== level) fail(`client/server field mission level drift for ${id}: server=${level}, client=${clientFieldLevels.get(id)}`);
}

const serverCombatLevels = minMap(missionCatalog);
const clientCombatLevels = minMap(clientCombat);
for (const [key, level] of serverCombatLevels) {
  if (clientCombatLevels.get(key) !== level) fail(`client/server combat mission level drift for ${key}: server=${level}, client=${clientCombatLevels.get(key)}`);
}

if (!adminPanel.includes('validateCreatorMissionEligibility')) fail('AdminPanel must validate creator mission eligibility before publishing');
if (!creatorEligibility.includes('ENDGAME_LEVEL = 100')) fail('creator mission eligibility helper must encode level 100 endgame gates');
if (!creatorEligibility.includes('requiresHollowGateUnlocked')) fail('creator mission eligibility helper must gate Hollow Gate objectives');

if (failures.length > 0) {
  console.error('Mission eligibility catalog check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Mission eligibility catalog check passed.');
