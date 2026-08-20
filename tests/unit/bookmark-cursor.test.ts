import { describe, expect, it } from "vitest";

import {
  decodeBookmarkCursor,
  encodeBookmarkCursor,
  InvalidBookmarkCursorError,
} from "@/lib/bookmarks/cursor";

describe("bookmark cursors", () => {
  it("round trips a deterministic keyset cursor", () => {
    const value = { createdAt: new Date("2026-08-20T12:34:56.789Z"), id: "cm123" };
    expect(decodeBookmarkCursor(encodeBookmarkCursor(value))).toEqual(value);
  });

  it.each([
    "",
    "not+base64",
    Buffer.from("not json").toString("base64url"),
    Buffer.from(JSON.stringify({ id: "cm123" })).toString("base64url"),
    Buffer.from(JSON.stringify({ created_at: "not-a-date", id: "cm123" })).toString("base64url"),
    Buffer.from(JSON.stringify({ created_at: "2026-08-20T12:34:56.789Z", id: "cm123", owner: "x" })).toString(
      "base64url",
    ),
    "a".repeat(2049),
  ])("rejects malformed cursor %s", (cursor) => {
    expect(() => decodeBookmarkCursor(cursor)).toThrow(InvalidBookmarkCursorError);
  });
});
