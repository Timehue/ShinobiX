import type { Achievement } from "../constants/achievements";

export type MissionToast = { id: string; name: string; xp: number; profession?: string; label?: string };

type ToastStacksProps = {
    achievementToasts: Achievement[];
    missionToasts: MissionToast[];
    onDismissAchievement: (achievement: Achievement) => void;
    onDismissMission: (id: string) => void;
};

export function ToastStacks({ achievementToasts, missionToasts, onDismissAchievement, onDismissMission }: ToastStacksProps) {
    return (
        <>
            {achievementToasts.length > 0 && (
                <div className="achievement-toast-stack">
                    {achievementToasts.slice(0, 3).map((a, i) => (
                        <div
                            key={`${a.id}-${i}`}
                            className={`achievement-toast ${a.hidden ? "secret" : ""}`}
                            onClick={() => onDismissAchievement(a)}
                        >
                            <div className="achievement-toast-icon">
                                <img
                                    src={`/badges/${a.id}.png`}
                                    alt=""
                                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                                />
                                <span className="achievement-toast-emoji" aria-hidden>{a.icon}</span>
                            </div>
                            <div className="achievement-toast-body">
                                <span className="achievement-toast-label">
                                    {a.hidden ? "Secret Unlocked" : "Achievement Unlocked"}
                                </span>
                                <strong>{a.name}</strong>
                                <small>{a.desc}</small>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {missionToasts.length > 0 && (
                <div className="achievement-toast-stack" style={{ bottom: 80 }}>
                    {missionToasts.slice(0, 3).map((t) => {
                        const accent = t.profession === "healer" ? "#22d3ee" : t.profession === "vanguard" ? "#f97316" : "#facc15";
                        return (
                            <div
                                key={t.id}
                                className="achievement-toast"
                                style={{ borderColor: accent, boxShadow: `0 0 20px ${accent}55` }}
                                onClick={() => onDismissMission(t.id)}
                            >
                                <div className="achievement-toast-icon">
                                    <span className="achievement-toast-emoji" aria-hidden style={{ color: accent }}>📜</span>
                                </div>
                                <div className="achievement-toast-body">
                                    <span className="achievement-toast-label" style={{ color: accent }}>
                                        {t.label ?? "Mission Complete"}
                                    </span>
                                    <strong>{t.name}</strong>
                                    {t.xp > 0 && <small>+{t.xp} {t.profession ? `${t.profession.charAt(0).toUpperCase() + t.profession.slice(1)} ` : ""}XP</small>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </>
    );
}
