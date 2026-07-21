export type LegalPageSlug =
    | "terms"
    | "privacy"
    | "community-rules"
    | "purchases-and-refunds"
    | "cookies"
    | "copyright"
    | "privacy-request"
    | "notices";

export const LEGAL_PAGE_LINKS: ReadonlyArray<{ slug: LegalPageSlug; label: string }> = [
    { slug: "terms", label: "Terms" },
    { slug: "privacy", label: "Privacy" },
    { slug: "community-rules", label: "Rules" },
    { slug: "purchases-and-refunds", label: "Purchases" },
    { slug: "cookies", label: "Cookies" },
    { slug: "copyright", label: "Copyright" },
    { slug: "privacy-request", label: "Privacy Request" },
    { slug: "notices", label: "Notices" },
];

const LEGAL_PAGE_SLUGS = new Set<LegalPageSlug>(LEGAL_PAGE_LINKS.map((link) => link.slug));

export function legalPageForPath(pathname: string): LegalPageSlug | null {
    const candidate = pathname.replace(/^\/+|\/+$/g, "") as LegalPageSlug;
    return LEGAL_PAGE_SLUGS.has(candidate) ? candidate : null;
}
