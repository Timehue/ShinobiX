type GroundPosition = { col: number; row: number };

/** Replay delayed authored motion through the navigator without skipping ground. */
export function advanceAuthoredGroundMotion(options: {
    position: GroundPosition;
    elapsedMs: number;
    now: number;
    maxStepMs: number;
    speed: number;
    targetAt: (timeMs: number) => GroundPosition;
    navigate: (position: GroundPosition, target: GroundPosition) => GroundPosition;
}) {
    const { now, targetAt, navigate, speed } = options;
    const elapsed = Math.max(0, options.elapsedMs);
    const maxStep = Math.max(1, options.maxStepMs);
    let position = { ...options.position };
    let consumed = 0;
    let facingDelta = 0;
    for (let count = 0; consumed < elapsed && count < 2000; count++) {
        const stepMs = Math.min(maxStep, elapsed - consumed);
        consumed += stepMs;
        const target = targetAt(now - elapsed + consumed);
        const next = navigate(position, target);
        const dx = next.col - position.col, dy = next.row - position.row;
        const distance = Math.hypot(dx, dy);
        const step = Math.min(distance, Math.max(0, speed) * stepMs / 1000);
        if (Math.abs(dx) > .005) facingDelta = dx;
        if (distance > 0) position = {
            col: position.col + dx / distance * step,
            row: position.row + dy / distance * step,
        };
    }
    const target = targetAt(now - elapsed + consumed);
    return {
        position,
        facingDelta,
        remainingDistance: Math.hypot(target.col - position.col, target.row - position.row),
        unconsumedMs: Math.max(0, elapsed - consumed),
    };
}
