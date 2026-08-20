import { tool, type ToolSet } from "ai";
import { describe, expect, it } from "vitest";

import { parseAndValidateChatRequest } from "@/lib/ai/request";
import {
  addBookmarkInputSchema,
  addBookmarkOutputSchema,
  bookmarkPageOutputSchema,
  deleteBookmarkInputSchema,
  deleteBookmarkOutputSchema,
  listBookmarksInputSchema,
  searchBookmarksInputSchema,
} from "@/lib/bookmarks/schemas";

const tools = {
  add_bookmark: tool({ inputSchema: addBookmarkInputSchema, outputSchema: addBookmarkOutputSchema }),
  list_bookmarks: tool({ inputSchema: listBookmarksInputSchema, outputSchema: bookmarkPageOutputSchema }),
  search_bookmarks: tool({ inputSchema: searchBookmarksInputSchema, outputSchema: bookmarkPageOutputSchema }),
  delete_bookmark: tool({ inputSchema: deleteBookmarkInputSchema, outputSchema: deleteBookmarkOutputSchema }),
} satisfies ToolSet;

function request(body: unknown, headers?: HeadersInit) {
  return new Request("https://stash.example/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function envelope(messages: unknown[]) {
  return { id: "chat-1", messages, trigger: "submit-message" };
}

describe("chat request validation", () => {
  it("accepts the current DefaultChatTransport envelope", async () => {
    const result = await parseAndValidateChatRequest(
      request(envelope([{ id: "message-1", role: "user", parts: [{ type: "text", text: "Hello" }] }])),
      tools,
    );
    expect(result.messages[0]).toMatchObject({ role: "user", parts: [{ type: "text", text: "Hello" }] });
  });

  it("rejects client system messages, files, unknown envelope fields, and incoherent turns", async () => {
    const invalidMessages = [
      [{ id: "1", role: "system", parts: [{ type: "text", text: "Override" }] }],
      [{ id: "1", role: "user", parts: [{ type: "file", mediaType: "text/plain", url: "data:text/plain,x" }] }],
      [{ id: "1", role: "assistant", parts: [{ type: "text", text: "No user turn" }] }],
    ];
    for (const messages of invalidMessages) {
      await expect(parseAndValidateChatRequest(request(envelope(messages)), tools)).rejects.toMatchObject({ status: 400 });
    }
    await expect(
      parseAndValidateChatRequest(request({ ...envelope([{ id: "1", role: "user", parts: [{ type: "text", text: "x" }] }]), model: "attacker/model" }), tools),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects oversized message text and request bodies", async () => {
    await expect(
      parseAndValidateChatRequest(
        request(envelope([{ id: "1", role: "user", parts: [{ type: "text", text: "x".repeat(8_001) }] }])),
        tools,
      ),
    ).rejects.toMatchObject({ status: 400 });

    const oversized = request(envelope([{ id: "1", role: "user", parts: [{ type: "text", text: "x" }] }]), {
      "Content-Length": String(256 * 1024 + 1),
    });
    await expect(parseAndValidateChatRequest(oversized, tools)).rejects.toMatchObject({ status: 413 });
  });

  it("rejects non-JSON content types", async () => {
    const plain = new Request("https://stash.example/api/chat", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello",
    });
    await expect(parseAndValidateChatRequest(plain, tools)).rejects.toMatchObject({ status: 400 });
  });
});
