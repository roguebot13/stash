import { z } from "zod";

const CONTROL_CHARACTER = /\p{Cc}/u;

function codePointLength(value: string) {
  return Array.from(value).length;
}

function normalizedText(options: {
  name: string;
  min?: number;
  max: number;
  normalize?: "NFKC";
  lowercase?: boolean;
}) {
  return z.string().transform((value, context) => {
    let normalized = options.normalize ? value.normalize(options.normalize) : value;
    normalized = normalized.trim();
    if (options.lowercase) normalized = normalized.toLowerCase();
    const length = codePointLength(normalized);
    if (length < (options.min ?? 0) || length > options.max) {
      context.addIssue({
        code: "custom",
        message: `${options.name} must contain between ${options.min ?? 0} and ${options.max} Unicode code points`,
      });
      return z.NEVER;
    }
    return normalized;
  });
}

export const bookmarkUrlSchema = z.string().transform((value, context) => {
  if (CONTROL_CHARACTER.test(value)) {
    context.addIssue({ code: "custom", message: "URL must not contain control characters" });
    return z.NEVER;
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    context.addIssue({ code: "custom", message: "URL must be an absolute HTTP or HTTPS URL" });
    return z.NEVER;
  }

  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
    context.addIssue({ code: "custom", message: "URL must be an absolute HTTP or HTTPS URL" });
  }
  if (parsed.username || parsed.password) {
    context.addIssue({ code: "custom", message: "URL credentials are not allowed" });
  }
  if (codePointLength(parsed.href) > 2048) {
    context.addIssue({ code: "custom", message: "URL must not exceed 2048 characters" });
  }
  return parsed.href;
});

export const bookmarkTitleSchema = normalizedText({ name: "Title", min: 1, max: 500 });

const rawTagSchema = normalizedText({
  name: "Tag",
  min: 0,
  max: 50,
  normalize: "NFKC",
  lowercase: true,
});

export function tagArraySchema(maxTags: number) {
  return z.array(rawTagSchema).transform((tags, context) => {
    const normalized = [...new Set(tags.filter(Boolean))];
    if (normalized.length > maxTags) {
      context.addIssue({ code: "custom", message: `No more than ${maxTags} tags are allowed` });
      return z.NEVER;
    }
    return normalized;
  });
}

export const bookmarkNotesSchema = z.nullish(z.string()).transform((value, context) => {
  if (value == null) return null;
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (codePointLength(normalized) > 10_000) {
    context.addIssue({ code: "custom", message: "Notes must not exceed 10000 Unicode code points" });
    return z.NEVER;
  }
  return normalized || null;
});

export const bookmarkIdSchema = z.string().min(1).max(64);
export const bookmarkLimitSchema = z.number().int().min(1).max(100).default(20);
export const bookmarkCursorInputSchema = z.string().max(2048).nullable().optional().default(null);

export const addBookmarkInputSchema = z
  .object({
    url: bookmarkUrlSchema,
    title: bookmarkTitleSchema,
    tags: tagArraySchema(20).optional().default([]),
    notes: bookmarkNotesSchema.optional().default(null),
  })
  .strict();

export const listBookmarksInputSchema = z
  .object({
    limit: bookmarkLimitSchema,
    cursor: bookmarkCursorInputSchema,
  })
  .strict();

export const searchBookmarksInputSchema = z
  .object({
    query: normalizedText({ name: "Query", min: 1, max: 200 }),
    tags: tagArraySchema(10).optional().default([]),
    tag_match: z.enum(["all", "any"]).optional().default("all"),
    limit: bookmarkLimitSchema,
    cursor: bookmarkCursorInputSchema,
  })
  .strict();

export const deleteBookmarkInputSchema = z.object({ id: bookmarkIdSchema }).strict();

export const publicBookmarkSchema = z
  .object({
    id: z.string(),
    url: z.string(),
    title: z.string(),
    tags: z.array(z.string()),
    notes: z.string().nullable(),
    created_at: z.iso.datetime(),
  })
  .strict();

export const addBookmarkOutputSchema = z
  .object({ bookmark: publicBookmarkSchema, created: z.boolean() })
  .strict();

export const bookmarkPageOutputSchema = z
  .object({ bookmarks: z.array(publicBookmarkSchema), next_cursor: z.string().nullable() })
  .strict();

export const deleteBookmarkOutputSchema = z
  .object({ id: z.string(), deleted: z.boolean() })
  .strict();

export type AddBookmarkInput = z.output<typeof addBookmarkInputSchema>;
export type ListBookmarksInput = z.output<typeof listBookmarksInputSchema>;
export type SearchBookmarksInput = z.output<typeof searchBookmarksInputSchema>;
export type DeleteBookmarkInput = z.output<typeof deleteBookmarkInputSchema>;
export type PublicBookmark = z.output<typeof publicBookmarkSchema>;
export type AddBookmarkOutput = z.output<typeof addBookmarkOutputSchema>;
export type BookmarkPageOutput = z.output<typeof bookmarkPageOutputSchema>;
export type DeleteBookmarkOutput = z.output<typeof deleteBookmarkOutputSchema>;

export type BookmarkRow = {
  id: string;
  url: string;
  title: string;
  tags: string[];
  notes: string | null;
  createdAt: Date;
};

export function toPublicBookmark(row: BookmarkRow): PublicBookmark {
  return publicBookmarkSchema.parse({
    id: row.id,
    url: row.url,
    title: row.title,
    tags: row.tags,
    notes: row.notes,
    created_at: row.createdAt.toISOString(),
  });
}
