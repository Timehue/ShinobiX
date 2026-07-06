export type CombatTag = {
    name: string;
    percent?: number;
    amount?: number;
};

export type CombatStatusKind = 'positive' | 'negative';

export type CombatStatus = {
    name: string;
    rounds: number;
    activeRound?: number;
    percent?: number;
    amount?: number;
    discipline?: string;
    kind: CombatStatusKind;
};

export type CombatStats = Record<string, number>;
export type CombatEquipment = Record<string, string | undefined>;

export type CombatJutsu = {
    id: string;
    name: string;
    type: string;
    element?: string;
    weatherElement?: string;
    target?: string;
    range?: number;
    ap?: number;
    cooldown?: number;
    effectPower?: number;
    isUtility?: boolean;
    bloodlineRank?: string;
    method?: string;
    chakraCost?: number;
    staminaCost?: number;
    tags?: CombatTag[];
    battleDescription?: string;
};

export type CombatItem = {
    id?: string;
    name?: string;
    slot?: string;
    weaponEp?: number;
    weaponElement?: string;
    weaponRange?: number;
    weaponCooldown?: number;
    apCost?: number;
    weaponTags?: CombatTag[];
    weaponEffect?: string;
    weaponEffectValue?: number;
    weaponEffectTarget?: string;
    restoreChakra?: number;
    restoreStamina?: number;
};

export type CombatFighter = {
    id: string;
    side?: string;
    name: string;
    hp: number;
    maxHp: number;
    chakra: number;
    maxChakra: number;
    stamina: number;
    maxStamina: number;
    shield: number;
    statuses: CombatStatus[];
    pos: number;
    character?: Record<string, unknown>;
    stats?: CombatStats;
    jutsu?: CombatJutsu[];
    items?: CombatItem[];
    equipment?: CombatEquipment;
    cooldowns?: Record<string, number>;
};

export type CombatGroundEffect = {
    id: string;
    owner: string;
    name: string;
    tiles: number[];
    rounds: number;
    tags: CombatTag[];
};

export type CombatBattleState = {
    battleId: string;
    round: number;
    activeActorId: string;
    ap: Record<string, number>;
    actionsThisTurn: number;
    cooldowns: Record<string, Record<string, number>>;
    fighters: Record<string, CombatFighter>;
    groundEffects?: CombatGroundEffect[];
    log: string[];
    status: 'active' | 'done';
    winner: string | 'draw' | null;
    meta?: Record<string, unknown>;
};

export type CombatAction =
    | { actorId: string; type: 'move'; tile: number; token?: string }
    | { actorId: string; type: 'wait'; token?: string }
    | { actorId: string; type: 'basicAttack'; targetId?: string; token?: string }
    | { actorId: string; type: 'jutsu'; jutsuId: string; targetId?: string; tile?: number; token?: string }
    | { actorId: string; type: 'weapon'; itemId?: string; itemName?: string; targetId?: string; token?: string }
    | { actorId: string; type: 'item'; itemId?: string; itemName?: string; token?: string }
    | { actorId: string; type: 'clear' | 'cleanse' | 'basicHeal' | 'flee'; token?: string };

// Internal floating-number event before it is mapped to a concrete fighter slot.
export type CombatFxEvent = {
    who: 'self' | 'opp';
    amount: number;
    kind: 'damage' | 'heal';
};

export type CombatFxTarget = {
    target: string;
    amount: number;
    kind: 'damage' | 'heal';
};

export type CombatResolveResult = {
    fighters?: Partial<Record<string, CombatFighter>>;
    ap?: Record<string, number>;
    cooldowns?: Record<string, Record<string, number>>;
    groundEffects?: CombatGroundEffect[];
    log?: string[];
    status?: 'active' | 'done';
    winner?: string | 'draw' | null;
    fx?: CombatFxTarget[];
    fxSeq?: number;
};
