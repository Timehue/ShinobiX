import { type Character } from "../App";
import { CharacterCreatorFlow } from "../features/character-creator/CharacterCreatorFlow";

function IconUser() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
        </svg>
    );
}

function IconLock() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="10" width="16" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 1 1 8 0v3" />
        </svg>
    );
}

function IconEyeOpen() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    );
}

function IconEyeOff() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a19.55 19.55 0 0 1 4.06-5.06" />
            <path d="M22.54 12.88A19.5 19.5 0 0 0 23 12s-4-7-11-7a10.74 10.74 0 0 0-4.06.76" />
            <path d="M9.9 4.24A9.6 9.6 0 0 1 12 4" />
            <path d="M1 1l22 22" />
            <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
        </svg>
    );
}

export { IconUser, IconLock, IconEyeOpen, IconEyeOff };

export function CharacterCreator({ onCreate, onBack, bare = false }: {
    onCreate: (character: Character, password: string) => void | Promise<void>;
    onBack?: () => void;
    bare?: boolean;
}) {
    return <CharacterCreatorFlow onCreate={onCreate} onBack={onBack} compact={bare} />;
}
