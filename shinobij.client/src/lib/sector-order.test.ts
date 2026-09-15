import assert from "node:assert/strict";
import { test } from "node:test";
import type { NoticePost } from "../types/clan";
import { sectorOrderFor } from "./sector-order";

test("sector map shows only its newest pinned village order", () => {
    const post = (id: string, sector: number, pinned: boolean, createdAt: number): NoticePost => ({
        id, sector, pinned, createdAt, type: "order", title: id, body: id, author: "Kage", authorRole: "Kage",
    });
    const posts = [post("other sector", 6, true, 20), post("unpinned", 5, false, 30), post("older", 5, true, 10), post("latest", 5, true, 15)];
    assert.equal(sectorOrderFor(posts, 5)?.id, "latest");
    assert.equal(sectorOrderFor(posts, 7), null);
});
