import { Streamdown } from "streamdown";

import { ToolInvocation } from "@/app/chat/tool-invocation";
import type { StashUIMessage } from "@/lib/ai/chat-types";

export function ChatMessage({
  message,
  isStreaming,
  onApproval,
}: {
  message: StashUIMessage;
  isStreaming: boolean;
  onApproval: (id: string, approved: boolean) => void;
}) {
  return (
    <article className={`chat-message chat-message-${message.role}`} aria-label={`${message.role} message`}>
      <div className="message-avatar" aria-hidden="true">{message.role === "user" ? "Y" : "S"}</div>
      <div className="message-content">
        <div className="message-role">{message.role === "user" ? "You" : "Stash"}</div>
        {message.parts.map((part, index) => {
          if (part.type === "text") {
            return message.role === "assistant" ? (
              <Streamdown
                key={`${message.id}-text-${index}`}
                className="message-markdown"
                components={{
                  a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>,
                }}
                mode={isStreaming ? "streaming" : "static"}
                linkSafety={{ enabled: true }}
              >
                {part.text}
              </Streamdown>
            ) : <p className="message-text" key={`${message.id}-text-${index}`}>{part.text}</p>;
          }
          if (
            part.type === "tool-add_bookmark" ||
            part.type === "tool-list_bookmarks" ||
            part.type === "tool-search_bookmarks" ||
            part.type === "tool-delete_bookmark"
          ) {
            return <ToolInvocation key={part.toolCallId} part={part} onApproval={onApproval} />;
          }
          if (part.type === "dynamic-tool") {
            return (
              <section className="tool-card" key={part.toolCallId} aria-label="Tool activity">
                <div className="tool-card-body">
                  <strong>Tool activity</strong>
                  <p>{part.state === "output-error" ? "The tool failed." : "The assistant used an unavailable tool."}</p>
                </div>
              </section>
            );
          }
          return null;
        })}
      </div>
    </article>
  );
}
