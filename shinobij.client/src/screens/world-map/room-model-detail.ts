import type { FrontIdleDetail } from "../../components/SectorModelFigure";

// Visible bounds of the original south-facing idle inside its packed cell, in percent.
// Each close-up is registered to that exact model revision.
const poses: Record<string, Omit<FrontIdleDetail, "src"> | undefined> = {
    "tracker": { revision: "d687eda7bc78e7fbedead7a52eb444d88c8c2632410db658316ff3c114c1e5de", bounds: [6.061, 3.704, 87.879, 93.827] },
    "starter-one": { revision: "254aae38bf8e9848a324c439702bc4d0124640ef51cbccb5c21694df73210346", bounds: [6.25, 2.5, 87.5, 95] },
    "starter-two": { revision: "b159f9414e3d69d964d6686a498c01d0799eb09f9dafb0fabf0586b68963d71a", bounds: [7.143, 3.704, 89.286, 92.593] },
    "merchant": { revision: "02cc5a3635516923203d8fa705163e3c8f578ae2d675a36f4826857e22c21762", bounds: [5.714, 2.469, 88.571, 93.827] },
};

export function roomModelDetail(kind: string): FrontIdleDetail | undefined {
    const pose = poses[kind];
    return pose && { ...pose, src: "/coast-map/residents/" + kind + "-room-v1.webp" };
}

export function restoreLandscapePose(image: HTMLImageElement, detail: FrontIdleDetail | undefined, fallback?: string) {
    if (detail && fallback && image.getAttribute("src") === detail.src) image.src = fallback;
}
