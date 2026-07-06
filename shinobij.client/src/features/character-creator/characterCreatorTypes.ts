export type CreatorStep = "welcome" | "village" | "bloodline" | "avatar" | "preview" | "identity";

export type IdentityErrors = Partial<Record<"name" | "password" | "confirmPassword", string>>;

export type StarterAvatarId = "avatar-one" | "avatar-two";

export type StarterAvatar = {
    id: StarterAvatarId;
    label: string;
    stance: string;
    image: string;
    alt: string;
    hook: string;
};

export type VillageTheme = {
    tone: string;
    record: string;
    summary: string;
};

export type BloodlinePresentation = {
    image: string;
    alt: string;
    tagline: string;
    flavor: string;
};
