import { bossFormView, type BossFormView, type BossTransformationState } from "../../../shared/boss-transformations";

/** The client view of a sealed transformation, or undefined for every other fight. */
export function bossFormViewFor(state: BossTransformationState | undefined, round: number, bossHp: number | undefined): BossFormView | undefined {
    return state ? bossFormView(state, round, bossHp) : undefined;
}

/** Classes that paint the form's aura over the boss art when no alternate art exists (and frame it when it does). */
export function bossFormAuraClass(view: BossFormView | undefined): string {
    if (!view?.aura) return "";
    return ` boss-form-aura boss-form-aura--${view.aura}${view.charging ? " boss-form-aura--charging" : ""}`;
}

/** The closing line of the transformation cut-scene: what changed, in plain words. */
export function bossFormClosingLine(view: BossFormView, bossName: string): string {
    const parts = [
        view.savedFromLethal ? `${bossName} refused to fall.` : "",
        view.summary ?? "",
        view.mechanic ? `${view.mechanic.name}: ${view.mechanic.tell}` : "",
        view.skipped?.length ? `Your attack also broke through ${view.skipped.join(" and ")}.` : "",
    ];
    return parts.filter(Boolean).join(" ");
}
