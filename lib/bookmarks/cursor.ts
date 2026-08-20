import { z } from "zod";

const MAX_CURSOR_LENGTH = 2048;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

const cursorPayloadSchema = z
  .object({
    created_at: z.iso.datetime(),
    id: z.string().min(1).max(64),
  })
  .strict();

export class InvalidBookmarkCursorError extends Error {
  constructor() {
    super("Invalid bookmark cursor");
    this.name = "InvalidBookmarkCursorError";
  }
}

export type BookmarkCursor = { createdAt: Date; id: string };

export function encodeBookmarkCursor(cursor: BookmarkCursor) {
  const value = JSON.stringify({ created_at: cursor.createdAt.toISOString(), id: cursor.id });
  return Buffer.from(value, "utf8").toString("base64url");
}

export function decodeBookmarkCursor(value: string): BookmarkCursor {
  try {
    if (!value || value.length > MAX_CURSOR_LENGTH || !BASE64URL.test(value)) {
      throw new InvalidBookmarkCursorError();
    }
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) throw new InvalidBookmarkCursorError();
    const payload = cursorPayloadSchema.parse(JSON.parse(bytes.toString("utf8")));
    const createdAt = new Date(payload.created_at);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== payload.created_at) {
      throw new InvalidBookmarkCursorError();
    }
    return { createdAt, id: payload.id };
  } catch (error) {
    if (error instanceof InvalidBookmarkCursorError) throw error;
    throw new InvalidBookmarkCursorError();
  }
}
