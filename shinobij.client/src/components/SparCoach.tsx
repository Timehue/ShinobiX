/** Read-only Academy guidance, rendered in the existing combat feedback band. */
export function SparCoach({
    attacked, casted, enemyHp, enemyMaxHp, enemyInMelee, myTurn, outOfActions, canAttack, canMove, canCastJutsu,
}: {
    attacked: boolean;
    casted: boolean;
    enemyHp: number;
    enemyMaxHp: number;
    enemyInMelee: boolean;
    myTurn: boolean;
    outOfActions: boolean;
    canAttack: boolean;
    canMove: boolean;
    canCastJutsu: boolean;
}) {
    if (enemyHp <= 0) return null;
    let message: string;
    if (!myTurn) {
        message = "Dummy's turn. Your AP returns next turn.";
    } else if (outOfActions || (!canAttack && !canMove && !canCastJutsu)) {
        message = "Tap Wait to end your turn and recover AP.";
    } else if (!attacked && !enemyInMelee && canMove) {
        message = "Move → tap a lit tile toward the dummy.";
    } else if (!attacked && canAttack) {
        message = "Tap Attack to strike the nearby dummy.";
    } else if (canCastJutsu && (!casted || !canAttack)) {
        message = "Choose a jutsu, then its lit target.";
    } else if (!enemyInMelee && canMove) {
        message = "Move → tap a lit tile toward the dummy.";
    } else if (canAttack && enemyMaxHp > 0 && enemyHp <= enemyMaxHp * 0.25) {
        message = canCastJutsu ? "Finish the dummy with Attack or a jutsu." : "Finish the dummy with Attack.";
    } else {
        message = canAttack ? "Tap Attack. Wait ends your turn." : "Tap Wait to end your turn and recover AP.";
    }
    return <span className="spar-coach-hint">{message}</span>;
}
