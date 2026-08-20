import type { UIMessage } from "ai";

import type {
  AddBookmarkInput,
  AddBookmarkOutput,
  BookmarkPageOutput,
  DeleteBookmarkInput,
  DeleteBookmarkOutput,
  ListBookmarksInput,
  SearchBookmarksInput,
} from "@/lib/bookmarks/schemas";

export type BookmarkUITools = {
  add_bookmark: { input: AddBookmarkInput; output: AddBookmarkOutput };
  list_bookmarks: { input: ListBookmarksInput; output: BookmarkPageOutput };
  search_bookmarks: { input: SearchBookmarksInput; output: BookmarkPageOutput };
  delete_bookmark: { input: DeleteBookmarkInput; output: DeleteBookmarkOutput };
};

export type StashUIMessage = UIMessage<never, never, BookmarkUITools>;
