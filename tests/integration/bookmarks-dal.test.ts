import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaClient } from "@/app/generated/prisma/client";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseName = testDatabaseUrl ? new URL(testDatabaseUrl).pathname.toLowerCase() : "";
const hasIsolatedDatabase = Boolean(testDatabaseUrl && databaseName.includes("test"));

describe.skipIf(!hasIsolatedDatabase)("bookmark database flows", () => {
  let db: PrismaClient;
  let dal: typeof import("@/lib/bookmarks/dal");
  let aliceId: string;
  let bobId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl! }) });
    dal = await import("@/lib/bookmarks/dal");
  });

  beforeEach(async () => {
    await db.bookmark.deleteMany();
    await db.user.deleteMany();
    const [alice, bob] = await Promise.all([
      db.user.create({ data: { email: "alice@example.com", passwordHash: "unused" }, select: { id: true } }),
      db.user.create({ data: { email: "bob@example.com", passwordHash: "unused" }, select: { id: true } }),
    ]);
    aliceId = alice.id;
    bobId = bob.id;
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it("allows per-user URL uniqueness and makes retries idempotent", async () => {
    const input = { url: "HTTPS://EXAMPLE.COM:443/article", title: "Alice", tags: [], notes: null };
    const [first, second] = await Promise.all([
      dal.addBookmark({ userId: aliceId }, input),
      dal.addBookmark({ userId: aliceId }, input),
    ]);
    expect([first.created, second.created].sort()).toEqual([false, true]);
    expect(await db.bookmark.count({ where: { userId: aliceId } })).toBe(1);
    await expect(dal.addBookmark({ userId: bobId }, { ...input, title: "Bob" })).resolves.toMatchObject({
      created: true,
    });
  });

  it("lists and searches only the authenticated owner with stable pagination", async () => {
    for (const [index, title] of ["Old TypeScript", "Middle", "Newest"].entries()) {
      await db.bookmark.create({
        data: {
          userId: aliceId,
          url: `https://example.com/${index}`,
          title,
          tags: index === 0 ? ["reference", "typescript"] : ["reference"],
          notes: index === 1 ? "TypeScript notes" : null,
          createdAt: new Date(`2026-08-20T12:0${index}:00.000Z`),
        },
      });
    }
    await db.bookmark.create({
      data: { userId: bobId, url: "https://example.com/bob", title: "TypeScript Bob", tags: ["reference"] },
    });

    const first = await dal.listBookmarks({ userId: aliceId }, { limit: 2, cursor: null });
    const second = await dal.listBookmarks({ userId: aliceId }, { limit: 2, cursor: first.next_cursor });
    expect(first.bookmarks.map((bookmark) => bookmark.title)).toEqual(["Newest", "Middle"]);
    expect(second.bookmarks.map((bookmark) => bookmark.title)).toEqual(["Old TypeScript"]);
    expect(new Set([...first.bookmarks, ...second.bookmarks].map((bookmark) => bookmark.id)).size).toBe(3);

    const search = await dal.searchBookmarks(
      { userId: aliceId },
      { query: "typescript", tags: ["reference"], tag_match: "all", limit: 20, cursor: null },
    );
    expect(search.bookmarks.map((bookmark) => bookmark.title).sort()).toEqual([
      "Middle",
      "Old TypeScript",
    ]);
  });

  it("cannot delete another user's bookmark and cascades user deletion", async () => {
    const bob = await dal.addBookmark(
      { userId: bobId },
      { url: "https://example.com/bob", title: "Bob", tags: [], notes: null },
    );
    const foreign = await dal.deleteBookmark({ userId: aliceId }, { id: bob.bookmark.id });
    const unknown = await dal.deleteBookmark({ userId: aliceId }, { id: "unknown" });
    expect(foreign).toEqual({ id: bob.bookmark.id, deleted: false });
    expect(unknown).toEqual({ id: "unknown", deleted: false });
    expect(await db.bookmark.count({ where: { userId: bobId } })).toBe(1);
    await db.user.delete({ where: { id: bobId } });
    expect(await db.bookmark.count({ where: { userId: bobId } })).toBe(0);
  });
});
