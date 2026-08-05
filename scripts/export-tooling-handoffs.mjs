#!/usr/bin/env node
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { ECON_CURRENCIES } from '../api/_economy.ts';
import {
  ACADEMY_CHECKLIST,
  ACADEMY_TRIAL,
  COMBAT_MISSIONS,
  DAILY_HUNT_LIMIT,
  DAILY_MISSION_LIMIT,
  FIELD_MISSIONS,
  FIELD_MISSION_SCROLLS,
  HUNT_MISSION_IDS,
  HUNT_MISSION_SCROLLS,
} from '../api/missions/_mission-catalog.ts';
import { ITEM_CATALOG } from '../api/pvp/_item-catalog.ts';
import {
  DECLARE_WAR_WR,
  MAINT_BASE,
  MAINT_EXPONENT,
  SEALS_PER_SECTOR_PER_DAY,
  SECTOR_WAR_WR,
  TAX_BURN_SHARE,
  TAX_CATCHUP_DAYS_MAX,
  TAX_DAILY_CAP_RYO,
  TAX_EXEMPTION_RYO,
  WR_MERC_TIERS,
  WR_PER_SECTOR_PER_DAY,
  WR_POOL_CAP,
} from '../api/_war-economy.ts';
import { PET_BREEDING_DURATION_MS, PET_CHROMATIC_DENOMINATOR } from '../api/pet/_breeding.ts';
import { PET_BREEDING_RULES_VERSION, PET_BREEDING_USES_MAX, PET_BREEDING_USES_MIN } from '../api/pet/_owned-pet.ts';
import { PET_BREEDING_MIN_LEVEL } from '../api/pet/_pet-busy.ts';
import { BLOODLINE_FORGE_COSTS } from '../api/bloodlines/_forge.ts';
import { KEY_FORGE_COSTS } from '../api/hollow-gate/_forge-key.ts';
import { PROFILE_RESPEC_COST, PROFILE_TITLE_COST, PROFILE_TITLE_ICON_COST, PROFILE_TITLE_STYLE_COST } from '../api/profile/_settlement.ts';
import { STAT_RESPEC_FATE_COST } from '../api/save/_stat-entitlement.ts';
import { BLACK_MARKET_COST } from '../api/festival/_black-market.ts';
import { FATE_DICE_COST } from '../api/festival/_sunscar.ts';
import { NAMED_FORGE_COST } from '../api/craft/_named.ts';
import { KAGE_DECLARE_SEAL_COST } from '../api/village/_kage-challenge.ts';
import { LOGIN_RYO_BASE, LOGIN_RYO_CAP, LOGIN_RYO_PER_LEVEL, STREAK_SHARD_INTERVAL, STREAK_SHARD_REWARD } from '../api/player/_daily-login.ts';
import { WAR_CRATE_HONOR, WAR_CRATE_KEY_CHANCE, WAR_CRATE_RYO } from '../api/inventory/_war-crate.ts';
import { BRED_APEX_TRAIT_CHANCE_PERCENT, SHRINE_DEFS, SHRINE_MAX_OFFERING, SHRINE_MIN_OFFERING, SHRINE_TIERS } from '../shared/shrines.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientSource = path.join(repoRoot, 'shinobij.client', 'src');
const tokenFile = path.join(clientSource, 'styles', 'tokens.css');
const outputDir = path.join(repoRoot, 'docs', 'generated');
const checkOnly = process.argv.includes('--check');

const rel = (file) => path.relative(repoRoot, file).replaceAll('\\', '/');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function filesBelow(root, extension) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name))
    .sort();
}

function tokenCategory(name) {
  if (/^(sj-|slate-|gold-|red-|green-|blue-|cyan-|purple-|village-|rarity-|status-|text|ink$|panel|surface|line$|border|accent|danger$|success$|info$|warning$|paper$)/.test(name)) return 'color';
  if (/^sp-/.test(name)) return 'spacing';
  if (/^r-/.test(name)) return 'radius';
  if (/^(font-|fs-|lh-|fw-)/.test(name)) return 'typography';
  if (/^motion-/.test(name)) return 'motion';
  if (/^shadow-/.test(name)) return 'shadow';
  if (/^z-/.test(name)) return 'z-index';
  if (/^(shell-|dialog-|touch-)/.test(name)) return 'layout';
  return 'other';
}

function tokenType(category, value) {
  if (category === 'color') return 'color';
  if (category === 'typography' && value.includes(',')) return 'fontFamily';
  if (category === 'motion' && /^-?[\d.]+m?s$/.test(value)) return 'duration';
  if (['spacing', 'radius', 'layout', 'typography'].includes(category) && /(?:px|rem|em|vw|vh|%)\b/.test(value) && !value.includes('clamp(')) return 'dimension';
  if (category === 'z-index' || /^-?[\d.]+$/.test(value)) return 'number';
  return 'string';
}

async function designTokenExport() {
  const source = await readFile(tokenFile, 'utf8');
  const tokens = {};
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.replace(/\/\*.*?\*\//g, '').trim();
    const match = line.match(/^--([\w-]+)\s*:\s*(.+);$/);
    if (!match) continue;
    const [, name, value] = match;
    const category = tokenCategory(name);
    tokens[name] = {
      '$value': value.trim(),
      '$type': tokenType(category, value.trim()),
      '$extensions': { 'com.shinobix': { cssVariable: `--${name}`, category, source: rel(tokenFile), line: index + 1 } },
    };
  }

  const canonicalBreakpoints = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const match = rawLine.match(/^\s*(xs|sm|md|lg|xl|xxl)\s*=\s*(.+?)\s*$/);
    if (!match) continue;
    const [, name, range] = match;
    const numbers = [...range.matchAll(/\d+/g)].map((item) => Number(item[0]));
    canonicalBreakpoints[name] = {
      description: range,
      ...(range.includes('below') ? { maxExclusivePx: numbers[0] } : {}),
      ...(range.includes('through') ? { minPx: numbers[0], maxPx: numbers[1] } : {}),
      ...(range.includes('above') ? { minPx: numbers[0] } : {}),
      source: rel(tokenFile),
    };
  }

  const observed = new Map();
  for (const file of await filesBelow(clientSource, '.css')) {
    const css = await readFile(file, 'utf8');
    for (const [index, line] of css.split(/\r?\n/).entries()) {
      if (!line.includes('@media')) continue;
      for (const match of line.matchAll(/\((min|max)-(width|height):\s*(\d+)px\)/g)) {
        const key = `${match[1]}-${match[2]}-${match[3]}`;
        const item = observed.get(key) ?? { direction: match[1], axis: match[2], valuePx: Number(match[3]), occurrences: [] };
        item.occurrences.push({ source: rel(file), line: index + 1 });
        observed.set(key, item);
      }
    }
  }

  const grouped = {};
  for (const [name, token] of Object.entries(tokens).sort(([a], [b]) => a.localeCompare(b))) {
    const category = token.$extensions['com.shinobix'].category;
    (grouped[category] ??= {})[name] = token;
  }
  return {
    '$schema': 'https://tr.designtokens.org/format/',
    metadata: {
      generatedBy: 'scripts/export-tooling-handoffs.mjs',
      authority: rel(tokenFile),
      tokenCount: Object.keys(tokens).length,
      note: 'Values preserve CSS var() aliases; resolve aliases inside Figma rather than flattening semantic intent.',
    },
    collections: { 'ShinobiX Core': grouped },
    breakpoints: {
      canonical: canonicalBreakpoints,
      observedQueries: [...observed.values()].sort((a, b) => a.valuePx - b.valuePx || a.axis.localeCompare(b.axis) || a.direction.localeCompare(b.direction)),
    },
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(rows) {
  const columns = ['system', 'id', 'currency', 'amount', 'cadence', 'authority', 'notes'];
  return `${columns.join(',')}\n${rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')).join('\n')}\n`;
}

function economyExport() {
  const faucets = [];
  const sinks = [];
  const source = (authority) => authority;
  const addFlow = (target, system, id, currency, amount, cadence, authority, notes = '') => target.push({ system, id, currency, amount, cadence, authority, notes });

  for (const mission of COMBAT_MISSIONS) {
    addFlow(faucets, 'combat-mission', mission.key, 'ryo', mission.ryo, 'per claim', source('api/missions/_mission-catalog.ts'));
    addFlow(faucets, 'combat-mission', mission.key, 'territoryControlScrolls', mission.territoryScrolls, 'per claim', source('api/missions/_mission-catalog.ts'));
  }
  for (const mission of FIELD_MISSIONS) {
    const hunt = HUNT_MISSION_IDS.has(mission.id);
    addFlow(faucets, hunt ? 'hunt-mission' : 'field-mission', mission.id, 'ryo', mission.ryoReward, 'per daily claim', source('api/missions/_mission-catalog.ts'));
    addFlow(faucets, hunt ? 'hunt-mission' : 'field-mission', mission.id, 'statPoints', 3, 'per daily claim', source('api/missions/_mission-catalog.ts'), 'Daily checklist progression; XP fields are legacy display data.');
    addFlow(faucets, hunt ? 'hunt-mission' : 'field-mission', mission.id, 'territoryControlScrolls', hunt ? HUNT_MISSION_SCROLLS : FIELD_MISSION_SCROLLS, 'per daily claim', source('api/missions/_mission-catalog.ts'));
    for (const [currency, amount] of Object.entries(mission.currencyRewards ?? {})) {
      addFlow(faucets, hunt ? 'hunt-mission' : 'field-mission', mission.id, currency, amount, 'per daily claim', source('api/missions/_mission-catalog.ts'));
    }
  }
  for (const reward of [ACADEMY_TRIAL, ACADEMY_CHECKLIST]) {
    for (const [currency, amount] of Object.entries(reward).filter(([key, value]) => key !== 'id' && Number(value) > 0)) {
      addFlow(faucets, 'academy', reward.id, currency, amount, 'once per account', source('api/missions/_mission-catalog.ts'));
    }
  }
  addFlow(faucets, 'daily-login', 'level-scaled-ryo', 'ryo', `${LOGIN_RYO_BASE}+${LOGIN_RYO_PER_LEVEL}*level (cap ${LOGIN_RYO_CAP})`, 'daily', source('api/player/_daily-login.ts'));
  addFlow(faucets, 'daily-login', 'streak-shards', 'fateShards', STREAK_SHARD_REWARD, `every ${STREAK_SHARD_INTERVAL} streak days`, source('api/player/_daily-login.ts'));
  addFlow(faucets, 'war-crate', 'legendary-war-crate', 'ryo', WAR_CRATE_RYO, 'per crate', source('api/inventory/_war-crate.ts'));
  addFlow(faucets, 'war-crate', 'legendary-war-crate', 'honorSeals', WAR_CRATE_HONOR, 'per crate', source('api/inventory/_war-crate.ts'));
  addFlow(faucets, 'territory', 'controlled-sector-daily', 'warResources', WR_PER_SECTOR_PER_DAY, 'per controlled sector/day', source('api/_war-economy.ts'));
  addFlow(faucets, 'territory', 'controlled-sector-daily', 'honorSeals', SEALS_PER_SECTOR_PER_DAY, 'per controlled sector/day', source('api/_war-economy.ts'));

  for (const item of Object.values(ITEM_CATALOG).filter((item) => Number(item.cost) > 0).sort((a, b) => a.id.localeCompare(b.id))) {
    const currency = item.rarity === 'legendary' || item.rarity === 'mythic' ? 'fateShards' : 'ryo';
    addFlow(sinks, 'shop', item.id, currency, item.cost, 'per unit', source('api/pvp/_item-catalog.ts'), `${item.rarity} ${item.slot}`);
  }
  for (const [rank, price] of Object.entries(BLOODLINE_FORGE_COSTS)) addFlow(sinks, 'bloodline-forge', rank, price.currency, price.cost, 'per forge', source('api/bloodlines/_forge.ts'));
  for (const [currency, amount] of Object.entries(KEY_FORGE_COSTS)) addFlow(sinks, 'hollow-key-forge', currency, currency, amount, 'per key', source('api/hollow-gate/_forge-key.ts'));
  for (const [id, amount] of Object.entries({ profileRespec: PROFILE_RESPEC_COST, statRespec: STAT_RESPEC_FATE_COST, customTitle: PROFILE_TITLE_COST, titleStyle: PROFILE_TITLE_STYLE_COST, titleIcon: PROFILE_TITLE_ICON_COST })) {
    addFlow(sinks, 'profile', id, 'fateShards', amount, 'per action', source(id === 'statRespec' ? 'api/save/_stat-entitlement.ts' : 'api/profile/_settlement.ts'));
  }
  addFlow(sinks, 'festival', 'black-market-pull', 'ryo', BLACK_MARKET_COST, 'per pull', source('api/festival/_black-market.ts'));
  addFlow(sinks, 'festival', 'sunscar-fate-die', 'fateShards', FATE_DICE_COST, 'per roll', source('api/festival/_sunscar.ts'));
  addFlow(sinks, 'craft', 'named-forge', 'ryo', NAMED_FORGE_COST, 'per forge', source('api/craft/_named.ts'));
  addFlow(sinks, 'kage', 'declare-challenge', 'honorSeals', KAGE_DECLARE_SEAL_COST, 'per challenge', source('api/village/_kage-challenge.ts'));
  addFlow(sinks, 'shrine', 'communal-offering', 'ryo', `${SHRINE_MIN_OFFERING}-${SHRINE_MAX_OFFERING}`, 'per offering', source('shared/shrines.ts'), 'Pure sink; no payout.');
  addFlow(sinks, 'war', 'declare-war', 'warResources', DECLARE_WAR_WR, 'per declaration', source('api/_war-economy.ts'));
  addFlow(sinks, 'war', 'sector-war', 'warResources', SECTOR_WAR_WR, 'per sector war', source('api/_war-economy.ts'));
  for (const merc of WR_MERC_TIERS) addFlow(sinks, 'war-mercenary', merc.id, 'warResources', merc.costWr, 'per hire', source('api/_war-economy.ts'), `level ${merc.level}`);

  const shopItems = Object.values(ITEM_CATALOG)
    .filter((item) => Number(item.cost) > 0)
    .map((item) => ({ id: item.id, name: item.name, rarity: item.rarity, slot: item.slot, levelReq: item.levelReq ?? 1, baseCost: item.cost, currency: item.rarity === 'legendary' || item.rarity === 'mythic' ? 'fateShards' : 'ryo' }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    model: {
      schemaVersion: 'shinobix.economy-model.v1',
      generatedBy: 'scripts/export-tooling-handoffs.mjs',
      authority: 'server-authoritative source modules listed on every flow; generated artifacts are read-only handoffs',
      currencies: [...ECON_CURRENCIES, 'warResources', 'territoryControlScrolls', 'statPoints'],
      dailyCaps: { missions: DAILY_MISSION_LIMIT, huntsBase: DAILY_HUNT_LIMIT },
      faucets,
      sinks,
      shopItems,
      petBreeding: {
        authority: ['api/pet/_breeding.ts', 'api/pet/_owned-pet.ts', 'api/pet/_pet-busy.ts', 'shared/shrines.ts'],
        rulesVersion: PET_BREEDING_RULES_VERSION,
        minimumParentLevel: PET_BREEDING_MIN_LEVEL,
        durationMs: PET_BREEDING_DURATION_MS,
        usesPerPet: { min: PET_BREEDING_USES_MIN, max: PET_BREEDING_USES_MAX },
        speciesPercent: { parent1: 45, parent2: 45, sameElementSameTier: 9, randomNonStandard: 1 },
        chromaticPercent: 100 / PET_CHROMATIC_DENOMINATOR,
        apexTraitPercent: BRED_APEX_TRAIT_CHANCE_PERCENT,
      },
      war: {
        poolCap: WR_POOL_CAP,
        structureMaintenance: { base: MAINT_BASE, exponent: MAINT_EXPONENT, formula: 'round(base * level^exponent)' },
        tax: { exemptionRyo: TAX_EXEMPTION_RYO, dailyCapRyo: TAX_DAILY_CAP_RYO, catchupDaysMax: TAX_CATCHUP_DAYS_MAX, burnShare: TAX_BURN_SHARE },
        crate: { ryo: WAR_CRATE_RYO, honorSeals: WAR_CRATE_HONOR, dungeonKeyChance: WAR_CRATE_KEY_CHANCE },
      },
      shrines: { count: SHRINE_DEFS.length, minOfferingRyo: SHRINE_MIN_OFFERING, maxOfferingRyo: SHRINE_MAX_OFFERING, tiers: SHRINE_TIERS },
      notes: [
        'Amounts are base values. Runtime discounts, village upgrades, entitlements, and idempotency gates remain in code.',
        'Legacy XP fields are exported for fidelity, but field/hunt progression is modeled as statPoints per the authoritative daily checklist.',
        'Custom/admin content and probabilistic/event rewards are intentionally excluded unless represented by a stable server constant.',
      ],
    },
    faucets,
    sinks,
  };
}

async function emit(fileName, content) {
  const target = path.join(outputDir, fileName);
  if (checkOnly) {
    const current = await readFile(target, 'utf8').catch(() => null);
    if (current !== content) throw new Error(`${rel(target)} is stale; run npm run export:tooling-handoffs`);
    return;
  }
  await writeFile(target, content, 'utf8');
  console.error(`[handoff] wrote ${rel(target)}`);
}

await mkdir(outputDir, { recursive: true });
const design = await designTokenExport();
const economy = economyExport();
await emit('design-tokens.json', json(design));
await emit('economy-model.json', json(economy.model));
await emit('economy-faucets.csv', csv(economy.faucets));
await emit('economy-sinks.csv', csv(economy.sinks));
if (checkOnly) console.error('[handoff] generated artifacts are current');
