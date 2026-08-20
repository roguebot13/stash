import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
} from "ai";

import { requireApiUser } from "@/lib/auth-dal";
import { getChatModel, STASH_ASSISTANT_INSTRUCTIONS } from "@/lib/ai/config";
import { connectBookmarkTools } from "@/lib/ai/mcp-client";
import { ChatRequestError, parseChatRequestEnvelope, validateChatRequestMessages } from "@/lib/ai/request";
import { getBookmarkMcpConfiguration, validateAppRequestHost, validateAppRequestOrigin } from "@/lib/mcp-auth/metadata";
import { getServerEnv } from "@/lib/env";
import { checkChatRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const STREAM_HEADERS = {
  "Cache-Control": "no-store",
  Vary: "Cookie, Origin",
};

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status, headers: STREAM_HEADERS });
}

export async function POST(request: Request) {
  if (!validateAppRequestHost(request) || !validateAppRequestOrigin(request)) {
    return jsonError(403, "Forbidden");
  }

  const authentication = await requireApiUser();
  if (!authentication.ok) {
    return jsonError(401, "Unauthorized");
  }
  const userId = authentication.user.id;
  await checkChatRateLimit({ userId });

  const cookie = request.headers.get("cookie");
  if (!cookie) return jsonError(401, "Unauthorized");

  let envelope: Awaited<ReturnType<typeof parseChatRequestEnvelope>>;
  try {
    envelope = await parseChatRequestEnvelope(request);
  } catch (error) {
    if (error instanceof ChatRequestError) return jsonError(error.status, error.publicMessage);
    return jsonError(400, "Invalid chat request");
  }

  let connection: Awaited<ReturnType<typeof connectBookmarkTools>>;
  try {
    connection = await connectBookmarkTools({
      appOrigin: getBookmarkMcpConfiguration().appOrigin,
      cookie,
    });
  } catch {
    console.error(JSON.stringify({ event: "chat.request.failed", userId, category: "mcp_unavailable" }));
    return jsonError(503, "Bookmark tools are temporarily unavailable");
  }

  const closeMcpClient = connection.close;
  try {
    const { messages } = await validateChatRequestMessages(envelope, connection.tools);
    const modelMessages = await convertToModelMessages(messages, { tools: connection.tools });
    const startedAt = performance.now();
    let terminalEventLogged = false;

    function logTerminal(event: "chat.request.completed" | "chat.request.failed" | "chat.request.aborted", category?: string) {
      if (terminalEventLogged) return;
      terminalEventLogged = true;
      console.info(JSON.stringify({
        event,
        userId,
        durationMs: Math.round(performance.now() - startedAt),
        ...(category ? { category } : {}),
      }));
    }

    const result = streamText({
      model: getChatModel(),
      instructions: STASH_ASSISTANT_INSTRUCTIONS,
      messages: modelMessages,
      tools: connection.tools,
      toolApproval: { delete_bookmark: "user-approval" },
      experimental_toolApprovalSecret: getServerEnv().AUTH_SECRET,
      stopWhen: stepCountIs(6),
      maxOutputTokens: 1_200,
      abortSignal: request.signal,
      onEnd: async () => {
        logTerminal("chat.request.completed");
        await closeMcpClient();
      },
      onAbort: async () => {
        logTerminal("chat.request.aborted", "aborted");
        await closeMcpClient();
      },
      onError: async () => {
        logTerminal("chat.request.failed", "gateway_or_stream");
        await closeMcpClient();
      },
    });

    const stream = toUIMessageStream({
      stream: result.stream,
      tools: connection.tools,
      originalMessages: messages,
      onError: () => "The assistant could not complete that response.",
    });
    return createUIMessageStreamResponse({ stream, headers: STREAM_HEADERS });
  } catch (error) {
    await closeMcpClient();
    if (error instanceof ChatRequestError) {
      return jsonError(error.status, error.publicMessage);
    }
    console.error(JSON.stringify({ event: "chat.request.failed", userId, category: "internal" }));
    return jsonError(503, "The assistant is temporarily unavailable");
  }
}
