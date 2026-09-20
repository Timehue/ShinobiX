export function activitySpineRequestPath(player: string, focus?: string): string {
    const query = new URLSearchParams({ player });
    if (focus) query.set('focus', focus);
    return `/api/player/activity-spine?${query.toString()}`;
}
