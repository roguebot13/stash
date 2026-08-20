import "server-only";

import { prisma } from "@/lib/prisma";
import {
  addBookmarkInputSchema,
  type AddBookmarkInput,
  type AddBookmarkOutput,
  type BookmarkPageOutput,
  deleteBookmarkInputSchema,
  type DeleteBookmarkInput,
  type DeleteBookmarkOutput,
  listBookmarksInputSchema,
  type ListBookmarksInput,
  searchBookmarksInputSchema,
  type SearchBookmarksInput,
  toPublicBookmark,
} from "@/lib/bookmarks/schemas";
import { decodeBookmarkCursor, encodeBookmarkCursor } from "@/lib/bookmarks/cursor";

export type BookmarkOwner = Readonly<{ userId: string }>;

const bookmarkSelect = {
  id: true,
  url: true,
  title: true,
  tags: true,
  notes: true,
  createdAt: true,
} as const;

function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

function paginationWhere(cursorValue: string | null) {
  if (!cursorValue) return {};
  const cursor = decodeBookmarkCursor(cursorValue);
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

function pageResult(rows: Array<Parameters<typeof toPublicBookmark>[0]>, limit: number): BookmarkPageOutput {
  const hasNextPage = rows.length > limit;
  const visible = hasNextPage ? rows.slice(0, limit) : rows;
  const last = visible.at(-1);
  return {
    bookmarks: visible.map(toPublicBookmark),
    next_cursor: hasNextPage && last ? encodeBookmarkCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}

export async function addBookmark(
  owner: BookmarkOwner,
  rawInput: AddBookmarkInput,
): Promise<AddBookmarkOutput> {
  const input = addBookmarkInputSchema.parse(rawInput);
  try {
    const row = await prisma.bookmark.create({
      data: { userId: owner.userId, ...input },
      select: bookmarkSelect,
    });
    return { bookmark: toPublicBookmark(row), created: true };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await prisma.bookmark.findUnique({
      where: { userId_url: { userId: owner.userId, url: input.url } },
      select: bookmarkSelect,
    });
    if (!existing) throw error;
    return { bookmark: toPublicBookmark(existing), created: false };
  }
}

export async function listBookmarks(
  owner: BookmarkOwner,
  rawInput: ListBookmarksInput,
): Promise<BookmarkPageOutput> {
  const input = listBookmarksInputSchema.parse(rawInput);
  const rows = await prisma.bookmark.findMany({
    where: { userId: owner.userId, ...paginationWhere(input.cursor) },
    select: bookmarkSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
  });
  return pageResult(rows, input.limit);
}

export async function searchBookmarks(
  owner: BookmarkOwner,
  rawInput: SearchBookmarksInput,
): Promise<BookmarkPageOutput> {
  const input = searchBookmarksInputSchema.parse(rawInput);
  const normalizedQueryTag = input.query.normalize("NFKC").trim().toLowerCase();
  const rows = await prisma.bookmark.findMany({
    where: {
      userId: owner.userId,
      ...paginationWhere(input.cursor),
      AND: [
        {
          OR: [
            { title: { contains: input.query, mode: "insensitive" } },
            { url: { contains: input.query, mode: "insensitive" } },
            { notes: { contains: input.query, mode: "insensitive" } },
            { tags: { has: normalizedQueryTag } },
          ],
        },
        ...(input.tags.length
          ? [{ tags: input.tag_match === "all" ? { hasEvery: input.tags } : { hasSome: input.tags } }]
          : []),
      ],
    },
    select: bookmarkSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
  });
  return pageResult(rows, input.limit);
}

export async function deleteBookmark(
  owner: BookmarkOwner,
  rawInput: DeleteBookmarkInput,
): Promise<DeleteBookmarkOutput> {
  const input = deleteBookmarkInputSchema.parse(rawInput);
  const result = await prisma.bookmark.deleteMany({ where: { id: input.id, userId: owner.userId } });
  return { id: input.id, deleted: result.count === 1 };
}
