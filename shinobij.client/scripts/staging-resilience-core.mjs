import { createHash } from 'node:crypto';
import { appOriginFingerprint } from '../../scripts/lib/maintenance-guards.mjs';
import { parseBoundedInteger, validateLoadTarget } from './staging-load-core.mjs';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

function csv(value) {
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function required(env, key) {
  const value = String(env[key] ?? '').trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

export function canonicalPlayerName(value) {
  const name = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(name)) {
    throw new Error('resilience player names must be 3-32 safe account characters');
  }
  return name;
}

export function playerLabel(name) {
  return createHash('sha256').update(canonicalPlayerName(name)).digest('hex').slice(0, 16);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
}

/**
 * Hash only state that must remain durable across an ordinary worker restart.
 * Runtime vitals and time-based sessions are intentionally omitted: reading a
 * save may legitimately settle regeneration/training while the process is down.
 */
export function durableSaveFingerprint(save) {
  const character = save?.character && typeof save.character === 'object' ? save.character : {};
  const durable = {
    saveVersion: Number(save?._saveVersion ?? 0),
    currentSector: Number(save?.currentSector ?? 0),
    character: {
      name: canonicalPlayerName(character.name),
      village: character.village ?? '',
      specialty: character.specialty ?? '',
      bloodline: character.bloodline ?? '',
      level: Number(character.level ?? 0),
      rank: character.rank ?? '',
      rankTitle: character.rankTitle ?? '',
      onboardingStep: character.onboardingStep ?? '',
      ryo: Number(character.ryo ?? 0),
      bankRyo: Number(character.bankRyo ?? 0),
      honorSeals: Number(character.honorSeals ?? 0),
      fateShards: Number(character.fateShards ?? 0),
      boneCharms: Number(character.boneCharms ?? 0),
      auraStones: Number(character.auraStones ?? 0),
      mythicSeals: Number(character.mythicSeals ?? 0),
      inventory: character.inventory ?? [],
      itemStacks: character.itemStacks ?? [],
      equipment: character.equipment ?? {},
      jutsuMastery: character.jutsuMastery ?? [],
      equippedJutsuIds: character.equippedJutsuIds ?? [],
      pets: character.pets ?? [],
      serverSettlementReceipts: character.serverSettlementReceipts ?? [],
      claimedServerMissions: character.claimedServerMissions ?? [],
      unlockedAchievements: character.unlockedAchievements ?? [],
    },
  };
  return createHash('sha256').update(JSON.stringify(canonicalJson(durable))).digest('hex');
}

export function loadStagingResilienceConfig(env = process.env) {
  if (String(env.SHINOBIX_DEPLOYMENT_TIER ?? '').trim().toLowerCase() !== 'staging') {
    throw new Error('staging resilience requires SHINOBIX_DEPLOYMENT_TIER=staging');
  }
  const rawTarget = required(env, 'RESILIENCE_TARGET_URL');
  const deniedHosts = [
    ...csv(env.RESILIENCE_DENY_HOSTS),
    ...csv(env.LOAD_DENY_HOSTS),
    env.PRODUCTION_HOST,
    env.PUBLIC_HOST,
    env.CANONICAL_HOST,
    env.CANONICAL_ORIGIN,
  ].filter(Boolean);
  const target = validateLoadTarget(rawTarget, {
    confirmedHost: env.RESILIENCE_CONFIRM_TARGET_HOST,
    deniedHosts,
  });
  if (!LOCAL_HOSTS.has(target.hostname.toLowerCase()) && target.protocol !== 'https:') {
    throw new Error('remote resilience targets must use HTTPS');
  }
  const targetFingerprint = appOriginFingerprint(target.origin);
  if (String(env.STAGING_APP_FINGERPRINT ?? '').trim().toLowerCase() !== targetFingerprint) {
    throw new Error('the confirmed target origin does not match STAGING_APP_FINGERPRINT');
  }
  const productionFingerprints = new Set(csv(env.PRODUCTION_APP_FINGERPRINTS).map((value) => value.toLowerCase()));
  if (productionFingerprints.size === 0) {
    throw new Error('PRODUCTION_APP_FINGERPRINTS must contain the canonical production app origin');
  }
  if (productionFingerprints.has(targetFingerprint)) {
    throw new Error('the confirmed target origin is in the production fingerprint deny set');
  }
  if (env.RESILIENCE_DISPOSABLE_SCENARIO !== '1') {
    throw new Error('set RESILIENCE_DISPOSABLE_SCENARIO=1 for two disposable staging accounts');
  }

  const playerA = {
    name: canonicalPlayerName(required(env, 'RESILIENCE_PLAYER_A_NAME')),
    token: required(env, 'RESILIENCE_PLAYER_A_TOKEN'),
  };
  const playerB = {
    name: canonicalPlayerName(required(env, 'RESILIENCE_PLAYER_B_NAME')),
    token: required(env, 'RESILIENCE_PLAYER_B_TOKEN'),
  };
  if (playerA.name === playerB.name) throw new Error('resilience players must be different accounts');
  if (playerA.token === playerB.token) throw new Error('resilience players must use independently issued tokens');

  const expectedConfirmation = `DISPOSABLE:${playerA.name}:${playerB.name}@${target.host.toLowerCase()}`;
  if (String(env.RESILIENCE_MUTATION_CONFIRM ?? '') !== expectedConfirmation) {
    throw new Error('RESILIENCE_MUTATION_CONFIRM does not match the disposable staging scenario');
  }

  const runRestart = env.RESILIENCE_RUN_RESTART === '1';
  let restartToken = '';
  if (runRestart) {
    restartToken = required(env, 'RESILIENCE_RESTART_TOKEN');
    const expectedRestart = `RESTART:${target.host.toLowerCase()}`;
    if (String(env.RESILIENCE_RESTART_CONFIRM ?? '') !== expectedRestart) {
      throw new Error('RESILIENCE_RESTART_CONFIRM does not match the confirmed staging target');
    }
  }

  return {
    target,
    targetFingerprint,
    players: [playerA, playerB],
    playerLabels: [playerLabel(playerA.name), playerLabel(playerB.name)],
    sector: parseBoundedInteger(env.RESILIENCE_SECTOR, {
      name: 'RESILIENCE_SECTOR', defaultValue: 40, min: 0, max: 10_000,
    }),
    timeoutMs: parseBoundedInteger(env.RESILIENCE_TIMEOUT_SECONDS, {
      name: 'RESILIENCE_TIMEOUT_SECONDS', defaultValue: 120, min: 20, max: 300,
    }) * 1_000,
    healthToken: required(env, 'RESILIENCE_HEALTH_TOKEN'),
    runRestart,
    restartToken,
  };
}

export function assertRestarted(before, after) {
  if (!before?.ok || !after?.ok) throw new Error('health did not remain OK across restart');
  if (!before.startedAt || !after.startedAt || before.startedAt === after.startedAt) {
    throw new Error('worker startedAt did not change; restart was not observed');
  }
  if (before.commit && after.commit && before.commit !== 'unknown' && after.commit !== before.commit) {
    throw new Error(`worker commit changed during resilience drill (${before.commit} -> ${after.commit})`);
  }
  return true;
}
