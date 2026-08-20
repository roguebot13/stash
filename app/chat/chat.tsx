"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ChatMessage } from "@/app/chat/chat-message";
import type { StashUIMessage } from "@/lib/ai/chat-types";

const MAX_INPUT = 8_000;
const SUGGESTIONS = [
  { label: "Latest saves", prompt: "Show my latest bookmarks." },
  { label: "Find inspiration", prompt: "Search my bookmarks for design systems." },
  { label: "Save something", prompt: "Help me save a new bookmark." },
];

function codePointLength(value: string) {
  return Array.from(value).length;
}

export function Chat({ email, accountActions }: { email: string; accountActions: ReactNode }) {
  const [input, setInput] = useState("");
  const [toolsConnected, setToolsConnected] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shouldFollowRef = useRef(true);
  const transport = useMemo(() => new DefaultChatTransport<StashUIMessage>({ api: "/api/chat" }), []);

  const {
    messages,
    sendMessage,
    status,
    error,
    stop,
    regenerate,
    setMessages,
    clearError,
    addToolApprovalResponse,
  } = useChat<StashUIMessage>({
    transport,
    resume: false,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: ({ isError }) => {
      if (!isError) setToolsConnected(true);
    },
  });

  const inputLength = codePointLength(input);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !shouldFollowRef.current) return;
    element.scrollTo({ top: element.scrollHeight, behavior: status === "streaming" ? "auto" : "smooth" });
  }, [messages, status]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [input]);

  function scrollToLatest() {
    const element = scrollRef.current;
    if (!element) return;
    shouldFollowRef.current = true;
    setShowJump(false);
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
    shouldFollowRef.current = nearBottom;
    setShowJump(!nearBottom);
  }

  async function submit(value = input) {
    if (busy || !value.trim() || codePointLength(value) > MAX_INPUT) return;
    shouldFollowRef.current = true;
    clearError();
    setInput("");
    await sendMessage({ text: value });
    inputRef.current?.focus();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  async function newChat() {
    if (busy) await stop();
    setMessages([]);
    setInput("");
    clearError();
    setToolsConnected(false);
    inputRef.current?.focus();
  }

  function handleApproval(id: string, approved: boolean) {
    void addToolApprovalResponse({
      id,
      approved,
      reason: approved ? "User approved bookmark deletion" : "User denied bookmark deletion",
    });
  }

  return (
    <main className="chat-page">
      <header className="chat-header">
        <div className="chat-brand-group">
          <div className="brand">stash<span>.</span></div>
          <span className={`tool-connection ${toolsConnected ? "connected" : ""}`}>
            <i aria-hidden="true" />{toolsConnected ? "4 tools connected" : "Bookmark tools available"}
          </span>
        </div>
        <div className="chat-header-actions">
          <span className="account-email" title={email}>{email}</span>
          <button className="chat-header-button" type="button" onClick={() => void newChat()}>New chat</button>
          {accountActions}
        </div>
      </header>

      <div className="chat-conversation" ref={scrollRef} onScroll={handleScroll} role="log" aria-label="Conversation" aria-live="polite">
        {messages.length === 0 ? (
          <section className="chat-empty">
            <div className="chat-orbit" aria-hidden="true"><span>S</span></div>
            <div className="eyebrow">Your collection, in conversation</div>
            <h1>Ask your Stash.</h1>
            <p>Find an old idea, save something new, or tidy up the links you meant to return to.</p>
            <div className="suggestion-grid">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion.label} type="button" onClick={() => void submit(suggestion.prompt)}>
                  <strong>{suggestion.label}</strong><span>{suggestion.prompt}</span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <div className="message-list">
            {messages.map((message, index) => (
              <ChatMessage
                key={message.id}
                message={message}
                isStreaming={status === "streaming" && index === messages.length - 1}
                onApproval={handleApproval}
              />
            ))}
            {status === "submitted" ? <div className="assistant-thinking"><span /><span /><span /><em>Stash is thinking</em></div> : null}
            {error ? (
              <div className="chat-error" role="alert">
                <span>The assistant could not complete that response.</span>
                <button type="button" onClick={() => void regenerate()}>Try again</button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {showJump ? <button className="jump-latest" type="button" onClick={scrollToLatest}>Jump to latest ↓</button> : null}

      <div className="composer-dock">
        <form className="chat-composer" onSubmit={handleSubmit}>
          <label htmlFor="chat-input" className="sr-only">Message Stash</label>
          <textarea
            id="chat-input"
            ref={inputRef}
            value={input}
            rows={1}
            maxLength={MAX_INPUT * 2}
            placeholder="Ask about your bookmarks…"
            onChange={(event) => setInput(Array.from(event.target.value).slice(0, MAX_INPUT).join(""))}
            onKeyDown={handleKeyDown}
            aria-describedby="composer-help"
          />
          <div className="composer-actions">
            <span id="composer-help">Enter to send · Shift+Enter for a new line</span>
            {inputLength > 7_000 ? <span className="input-count">{inputLength.toLocaleString()} / {MAX_INPUT.toLocaleString()}</span> : null}
            {busy ? (
              <button className="composer-stop" type="button" onClick={() => void stop()} aria-label="Stop generating"><i aria-hidden="true" /></button>
            ) : (
              <button className="composer-send" type="submit" disabled={!input.trim() || inputLength > MAX_INPUT} aria-label="Send message">↑</button>
            )}
          </div>
        </form>
        <p className="composer-note">Stash can make mistakes. Deletions always ask for your approval.</p>
      </div>
    </main>
  );
}
