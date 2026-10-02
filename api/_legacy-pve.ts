import type { LegacyStatDeltas } from './_legacy-track.js';
import type { SoloPveSession } from './solo-pve/_session.js';
import type { TowerSession } from './towers/_tower-session.js';

const STYLES: Record<string, { kill: keyof LegacyStatDeltas; damage: keyof LegacyStatDeltas }> = {
    Ninjutsu: { kill: 'ninjutsuKills', damage: 'ninjutsuDamage' },
    Genjutsu: { kill: 'genjutsuKills', damage: 'genjutsuDamage' },
    Taijutsu: { kill: 'taijutsuKills', damage: 'taijutsuDamage' },
    Bukijutsu: { kill: 'bukijutsuKills', damage: 'bukijutsuDamage' },
};

export function pveStyleDeltas(specialty: unknown, kills: number, damage = 0): LegacyStatDeltas {
    const style = STYLES[String(specialty ?? '')];
    return style ? { ...(kills > 0 ? { [style.kill]: kills } : {}), ...(damage > 0 ? { [style.damage]: damage } : {}) } : {};
}

/** Applied server event facts. Practice and reward eligibility belong to caller. */
export function extractSoloPveLegacyDeltas(session: SoloPveSession, kills = 1): LegacyStatDeltas {
    if (session.huntCombat?.battle) return extractTowerLegacyDeltas(session.huntCombat.battle, session.ownerSlug, kills);
    let healing = 0, shields = 0, blocked = 0, damage = 0;
    for (const event of session.events ?? []) {
        const combat = event.combat;
        if (!combat?.applied) continue;
        // Shield expiration also produces a negative resource delta. Actual
        // resolver absorption lines distinguish a hit from retiring the pool.
        const absorbed = (role: 'player' | 'enemy', fallback: number) => {
            if (!Array.isArray(event.log)) return fallback;
            const name = session[role].name;
            return event.log.reduce((total, line) => {
                const match = /^(\d+) absorbed by (.+)'s shield\.$/.exec(line);
                return total + (match?.[2] === name ? Number(match[1]) : 0);
            }, 0);
        };
        for (const fact of combat.healing) if (fact.role === 'player') healing += fact.applied;
        for (const fact of combat.shielding) if (fact.role === 'player' && fact.applied > 0) shields++;
        for (const fact of combat.damage) {
            if (fact.target === 'player') blocked += absorbed('player', fact.toShield);
            if (fact.source === 'player' && fact.target === 'enemy') damage += fact.toHp + absorbed('enemy', fact.toShield);
        }
    }
    return {
        ...pveStyleDeltas(session.player.character.specialty, kills, damage),
        ...(healing > 0 ? { healingDone: healing } : {}),
        ...(shields > 0 ? { shieldsApplied: shields } : {}),
        ...(blocked > 0 ? { damageBlocked: blocked } : {}),
    };
}

/** Tower logs name the caster before resolver output; never guess DoT ownership. */
export function extractTowerLegacyDeltas(session: TowerSession, slug: string, kills = 1): LegacyStatDeltas {
    const actor = session.actors.find((a) => a.side === 'squad' && !a.ai && a.ownerSlug === slug);
    if (!actor) return {};
    let caster = '', healing = 0, shields = 0, blocked = 0, damage = 0;
    const names = session.actors.map((a) => a.name).sort((a, b) => b.length - a.length);
    for (const line of session.log) {
        const header = names.find((name) => line.startsWith(`${name} uses `) || line.startsWith(`${name} casts `) || line.startsWith(`${name} strikes `) || line.startsWith(`${name} attacks`));
        if (header) caster = header;
        if (line.startsWith('--- Round ')) caster = '';
        let match = /^(.+) strikes (.+) for (\d+)\.$/.exec(line);
        if (match && match[1] === actor.name) { const target = match[2]; if (session.actors.some((a) => a.name === target && a.side === 'enemy')) damage += Number(match[3]); }
        match = /^(\d+) damage to (.+)\.$/.exec(line);
        if (match && caster === actor.name) { const target = match[2]; if (session.actors.some((a) => a.name === target && a.side === 'enemy')) damage += Number(match[1]); }
        match = /^Heal: (.+) restores (\d+) HP\.$/.exec(line)
            ?? /^(.+) uses Basic Heal, restoring (\d+) HP\.$/.exec(line)
            ?? /^(?:Siphon|Lifesteal): (.+) heals (\d+) HP\.$/.exec(line)
            ?? /^(.+) absorbs (\d+) HP\.$/.exec(line)
            ?? /^(.+)'s armor (?:absorbs|steals) (\d+) HP\.$/.exec(line);
        if (match && match[1] === actor.name) healing += Number(match[2]);
        match = /^(.+) restores (\d+) HP to (.+)\.$/.exec(line);
        if (match && match[1] === actor.name) healing += Number(match[2]);
        match = /^Shield: (.+) gains (\d+) shield\.$/.exec(line);
        if (match && match[1] === actor.name && Number(match[2]) > 0) shields++;
        match = /^(\d+) absorbed by (.+)'s shield\.$/.exec(line);
        if (match && match[2] === actor.name) blocked += Number(match[1]);
    }
    return {
        ...pveStyleDeltas(actor.character.specialty, kills, damage),
        ...(healing > 0 ? { healingDone: healing } : {}), ...(shields > 0 ? { shieldsApplied: shields } : {}),
        ...(blocked > 0 ? { damageBlocked: blocked } : {}),
    };
}
