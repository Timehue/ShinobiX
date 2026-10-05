type CombatTooltipItem = {
    name?: string;
    description?: string;
};

type CombatItemTooltipOptions = {
    action: "Weapon" | "Throwable" | "Consumable";
    apCost: number;
    range?: number;
    charges?: number | null;
    cooldown?: number;
    unavailable?: string;
};

/** Keep item-card tooltip copy consistent across the combat screens. */
export function combatItemTooltip(item: CombatTooltipItem, options: CombatItemTooltipOptions) {
    const details = [`${options.apCost} AP`];
    if (options.range != null) details.push(`Range ${options.range}`);
    if (options.charges != null) details.push(`${options.charges} use${options.charges === 1 ? "" : "s"} left`);
    if (options.cooldown != null && options.cooldown > 0) details.push(`Cooldown ${options.cooldown} turn${options.cooldown === 1 ? "" : "s"}`);
    if (options.unavailable) details.push(options.unavailable);

    const heading = `${item.name ?? options.action} · ${options.action} | ${details.join(" | ")}`;
    const description = item.description?.trim();
    return description ? `${heading}\n${description}` : heading;
}
