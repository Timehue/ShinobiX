/** Integrated smoothstep velocity. Distances are in the 1080 px reference sector.
 * `pace` is the player's clip playback rate: from full paced speed the brake covers
 * the authored distance in 1/pace the time (less distance from a slower start). */
export function createGaitBrake(speed: number, gait: 'walk' | 'run', pace = 1) {
    const authoredSpeed = (gait === 'run' ? 120 : 31) * pace;
    const duration = 2 * (gait === 'run' ? 8.034 : 3.224) / authoredSpeed;
    const velocity = Math.min(authoredSpeed, Math.max(0, speed));
    let time = 0;
    function distance(seconds: number) {
        const u = seconds / duration;
        return velocity * duration * (u - u ** 3 + u ** 4 / 2);
    }
    return {
        gait,
        get done() { return time >= duration; },
        advance(dt: number) {
            const previous = time;
            time = Math.min(duration, time + Math.max(0, dt));
            return distance(time) - distance(previous);
        },
    };
}
