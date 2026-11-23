/*
 * The sentence a player reads when a quest action is refused, by reason.
 *
 * The handler (lines.ts) adds it to the reply as `error`, and the client shows
 * that. The words live here, on the server, so the client carries no table of
 * them and a new reason needs no client release to be worded.
 */
export const QUEST_REFUSAL_SENTENCES: Readonly<Record<string, string>> = {
    unknown: 'That quest is not on offer.',
    active: 'You already have that quest under way.',
    done: 'You have already finished that quest.',
    none: 'That quest is not under way. Open your quests to see where it stands.',
    stale: 'The quest has moved on. Open your quests to see the step you are on.',
    'no-choice': 'There is no choice to make at this step.',
    'bad-option': 'That is not one of the choices.',
    presence: 'Step out into the world first.',
    traveling: 'Finish your journey first.',
    'in-battle': 'Finish your fight first.',
    'wrong-place': 'You are not there yet.',
    'no-building': 'That place cannot be found.',
    incomplete: 'You do not hold enough yet.',
    materials: 'You are missing what the recipe takes.',
    'inventory-full': 'Your backpack is full. Make room first.',
    committed: 'This quest has already taken what you gave it. It has to be finished.',
    level: 'You are not a high enough level yet.',
    quests: 'An earlier quest has to be finished first.',
    marks: 'You need more marks on your Coast Record.',
    region: 'That part of the coast is not open to you yet.',
    clan: 'This quest is for shinobi who belong to a clan.',
    busy: 'You already have three quests under way.',
    'not-final': 'There is more of this quest to do.',
    'not-make': 'There is nothing to make for this quest right now.',
    make: 'This step is made at its counter.',
    choose: 'This step is a choice.',
    fight: 'This step is a fight.',
    clues: 'There is more to find inside first.',
    'no-clue': 'There is nothing here this step needs.',
    'clue-order': 'Something you need to know first is somewhere else in this building.',
};
