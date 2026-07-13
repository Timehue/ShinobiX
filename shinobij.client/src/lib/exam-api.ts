import type { Character } from '../types/character';

export async function passRankExamServer(playerName: string, examKey: string): Promise<Character> {
    const response = await fetch('/api/exams/pass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName, examKey }) });
    const data = await response.json().catch(() => null) as { character?: Character; error?: string } | null;
    if (!response.ok || !data?.character) throw new Error(data?.error || 'Rank exam could not be verified.');
    return data.character;
}
