/*
 * Client wrappers for clan mentorship (api/clan/mentor.ts). The server is
 * authoritative for milestone detection + reward escrow; the caller reflects the
 * sensei's returned seal/contribution delta locally so the autosave converges.
 */

export type MentorStudent = { student: string; startedAt: number; claimed: string[]; claimable: string[] };
export type MentorView = { asSensei: { students: MentorStudent[] }; asStudent: { sensei: string | null } };

export const MENTOR_MILESTONE_LABEL: Record<string, string> = {
    academy: "Academy graduate",
    level20: "Level 20",
    level40: "Level 40",
    rankedWin: "First ranked win",
};

export async function fetchMentorView(player: string): Promise<MentorView> {
    try {
        const res = await fetch(`/api/clan/mentor?player=${encodeURIComponent(player)}`);
        const data = await res.json().catch(() => ({})) as Partial<MentorView>;
        return { asSensei: { students: data.asSensei?.students ?? [] }, asStudent: { sensei: data.asStudent?.sensei ?? null } };
    } catch {
        return { asSensei: { students: [] }, asStudent: { sensei: null } };
    }
}

async function postMentor(action: string, playerName: string, studentName: string) {
    const res = await fetch("/api/clan/mentor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, playerName, studentName }),
    });
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    return { ok: res.ok, data };
}

export async function assignStudent(playerName: string, studentName: string): Promise<{ ok: boolean; error?: string }> {
    const { ok, data } = await postMentor("assign", playerName, studentName);
    return ok && data.ok ? { ok: true } : { ok: false, error: (data.error as string) || "Could not take on that student." };
}

export async function claimMentor(playerName: string, studentName: string): Promise<{ ok: boolean; error?: string; claimed: number; seals: number; contrib: number; milestones: string[] }> {
    const { ok, data } = await postMentor("claim", playerName, studentName);
    if (!ok || !data.ok) return { ok: false, error: (data.error as string) || "Could not claim mentor rewards.", claimed: 0, seals: 0, contrib: 0, milestones: [] };
    return { ok: true, claimed: Number(data.claimed ?? 0), seals: Number(data.seals ?? 0), contrib: Number(data.contrib ?? 0), milestones: (data.milestones as string[]) ?? [] };
}

export async function releaseStudent(playerName: string, studentName: string): Promise<boolean> {
    const { ok, data } = await postMentor("release", playerName, studentName);
    return ok && !!data.ok;
}
