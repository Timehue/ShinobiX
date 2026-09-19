export type ReaderMode = 'cinematic' | 'classic';
export function getReaderMode(): ReaderMode {
    try { return localStorage.getItem('vnReaderMode.v1') === 'classic' ? 'classic' : 'cinematic'; }
    catch { return 'cinematic'; }
}
export function setReaderMode(mode: ReaderMode): void {
    try { localStorage.setItem('vnReaderMode.v1', mode); } catch { /* private mode */ }
}
