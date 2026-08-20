import "server-only";

import { validateUIMessages, type ToolSet } from "ai";
import { z } from "zod";

import type { StashUIMessage } from "@/lib/ai/chat-types";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_MESSAGES = 50;
const MAX_TEXT_CODE_POINTS = 8_000;
const MAX_TOTAL_TEXT_CODE_POINTS = 40_000;

const chatEnvelopeSchema = z
  .object({
    id: z.string().min(1).max(128),
    messages: z.array(z.unknown()).min(1).max(MAX_MESSAGES),
    trigger: z.enum(["submit-message", "regenerate-message"]),
    messageId: z.string().min(1).max(128).nullish(),
  })
  .strict();

export class ChatRequestError extends Error {
  constructor(
    readonly status: 400 | 413,
    readonly publicMessage: string,
  ) {
    super(publicMessage);
  }
}

function codePointLength(value: string) {
  return Array.from(value).length;
}

async function readBoundedJson(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ChatRequestError(400, "Invalid chat request");
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new ChatRequestError(413, "Chat request too large");
  }
  if (!request.body) throw new ChatRequestError(400, "Invalid chat request");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new ChatRequestError(413, "Chat request too large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ChatRequestError(400, "Invalid chat request");
  }
}

function assertMessageBounds(messages: StashUIMessage[]) {
  let totalText = 0;

  for (const message of messages) {
    if (!message.id || message.id.length > 128 || message.role === "system") {
      throw new ChatRequestError(400, "Invalid chat request");
    }

    for (const part of message.parts) {
      if (part.type === "text") {
        const length = codePointLength(part.text);
        if (length > MAX_TEXT_CODE_POINTS) {
          throw new ChatRequestError(400, "Invalid chat request");
        }
        totalText += length;
        continue;
      }
      if (message.role !== "assistant") {
        throw new ChatRequestError(400, "Invalid chat request");
      }
      if (
        part.type !== "step-start" &&
        part.type !== "tool-add_bookmark" &&
        part.type !== "tool-list_bookmarks" &&
        part.type !== "tool-search_bookmarks" &&
        part.type !== "tool-delete_bookmark"
      ) {
        throw new ChatRequestError(400, "Invalid chat request");
      }
    }
  }

  if (totalText > MAX_TOTAL_TEXT_CODE_POINTS) {
    throw new ChatRequestError(400, "Invalid chat request");
  }
}

export async function parseChatRequestEnvelope(request: Request) {
  const raw = await readBoundedJson(request);
  const envelope = chatEnvelopeSchema.safeParse(raw);
  if (!envelope.success) throw new ChatRequestError(400, "Invalid chat request");
  return envelope.data;
}

export async function validateChatRequestMessages(
  envelope: z.infer<typeof chatEnvelopeSchema>,
  tools: ToolSet,
): Promise<{ id: string; messages: StashUIMessage[]; trigger: "submit-message" | "regenerate-message" }> {
  let messages: StashUIMessage[];
  try {
    messages = await validateUIMessages<StashUIMessage>({
      messages: envelope.messages,
      tools,
    });
  } catch {
    throw new ChatRequestError(400, "Invalid chat request");
  }
  assertMessageBounds(messages);

  const lastMessage = messages.at(-1);
  const hasApprovalResponse = lastMessage?.role === "assistant" && lastMessage.parts.some(
    (part) => "state" in part && part.state === "approval-responded",
  );
  if (
    envelope.trigger === "submit-message" &&
    lastMessage?.role !== "user" &&
    !hasApprovalResponse
  ) {
    throw new ChatRequestError(400, "Invalid chat request");
  }

  return {
    id: envelope.id,
    messages,
    trigger: envelope.trigger,
  };
}

export async function parseAndValidateChatRequest(request: Request, tools: ToolSet) {
  return validateChatRequestMessages(await parseChatRequestEnvelope(request), tools);
}
