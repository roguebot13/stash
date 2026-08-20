import { describe, expect, it } from "vitest";

import {
  addBookmarkInputSchema,
  bookmarkNotesSchema,
  bookmarkTitleSchema,
  bookmarkUrlSchema,
  publicBookmarkSchema,
  searchBookmarksInputSchema,
  tagArraySchema,
  toPublicBookmark,
} from "@/lib/bookmarks/schemas";

describe("bookmark schemas", () => {
  it("canonicalizes valid HTTP URLs and preserves path, query, and fragment", () => {
    expect(bookmarkUrlSchema.parse(" HTTPS://EXAMPLE.COM:443/a%20b?q=1#part ")).toBe(
      "https://example.com/a%20b?q=1#part",
    );
  });

  it.each([
    "javascript:alert(1)",
    "data:text/plain,hello",
    "file:///tmp/a",
    "https://user:secret@example.com/",
    "https://example.com/\npath",
    "not a url",
  ])("rejects an unsafe URL: %s", (url) => {
    expect(bookmarkUrlSchema.safeParse(url).success).toBe(false);
  });

  it("enforces title Unicode code-point boundaries", () => {
    expect(bookmarkTitleSchema.parse("  A title  ")).toBe("A title");
    expect(bookmarkTitleSchema.safeParse("   ").success).toBe(false);
    expect(bookmarkTitleSchema.safeParse("😀".repeat(501)).success).toBe(false);
  });

  it("normalizes, discards, and stably deduplicates tags", () => {
    expect(tagArraySchema(20).parse([" Reference ", "ＴＹＰＥＳＣＲＩＰＴ", "reference", "  "])).toEqual([
      "reference",
      "typescript",
    ]);
    expect(tagArraySchema(1).safeParse(["one", "two"]).success).toBe(false);
  });

  it("normalizes notes and stores blank notes as null", () => {
    expect(bookmarkNotesSchema.parse(" line one\r\nline two\r ")).toBe("line one\nline two");
    expect(bookmarkNotesSchema.parse(" \n ")).toBeNull();
  });

  it("rejects unknown tool input properties and applies search defaults", () => {
    expect(
      addBookmarkInputSchema.safeParse({
        url: "https://example.com",
        title: "Example",
        user_id: "attacker",
      }).success,
    ).toBe(false);
    expect(
      addBookmarkInputSchema.safeParse({
        url: "https://example.com",
        title: "Example",
        userId: "attacker",
      }).success,
    ).toBe(false);
    expect(searchBookmarksInputSchema.parse({ query: " TypeScript " })).toMatchObject({
      query: "TypeScript",
      tags: [],
      tag_match: "all",
      limit: 20,
      cursor: null,
    });
  });

  it("maps only the public snake-case bookmark DTO", () => {
    const dto = toPublicBookmark({
      id: "bookmark-id",
      url: "https://example.com/",
      title: "Example",
      tags: ["reference"],
      notes: null,
      createdAt: new Date("2026-08-20T12:34:56.789Z"),
    });
    expect(dto).toEqual({
      id: "bookmark-id",
      url: "https://example.com/",
      title: "Example",
      tags: ["reference"],
      notes: null,
      created_at: "2026-08-20T12:34:56.789Z",
    });
    expect(publicBookmarkSchema.safeParse({ ...dto, userId: "private" }).success).toBe(false);
  });
});
