import type { StashUIMessage } from "@/lib/ai/chat-types";

type ToolPart = Extract<
  StashUIMessage["parts"][number],
  {
    type:
      | "tool-add_bookmark"
      | "tool-list_bookmarks"
      | "tool-search_bookmarks"
      | "tool-delete_bookmark";
  }
>;

function hostname(value: string | undefined) {
  if (!value) return "bookmark";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "bookmark";
  }
}

function toolCopy(part: ToolPart) {
  switch (part.type) {
    case "tool-add_bookmark":
      return {
        label: "Saving bookmark",
        detail: part.input ? `${part.input.title || "Untitled"} · ${hostname(part.input.url)}` : "Preparing bookmark",
      };
    case "tool-list_bookmarks":
      return {
        label: "Loading bookmarks",
        detail: part.input ? `Up to ${part.input.limit} bookmarks` : "Preparing list",
      };
    case "tool-search_bookmarks":
      return {
        label: "Searching bookmarks",
        detail: part.input?.query || "Preparing search",
      };
    case "tool-delete_bookmark":
      return {
        label: "Deleting bookmark",
        detail: part.input?.id ? `Bookmark ${part.input.id}` : "Preparing deletion",
      };
  }
}

function outputCopy(part: ToolPart) {
  if (part.state !== "output-available") return null;
  switch (part.type) {
    case "tool-add_bookmark":
      return part.output.created ? "Bookmark saved" : "Bookmark was already saved";
    case "tool-list_bookmarks":
    case "tool-search_bookmarks": {
      const count = part.output.bookmarks.length;
      return `${count} ${count === 1 ? "bookmark" : "bookmarks"}${part.output.next_cursor ? " · more available" : ""}`;
    }
    case "tool-delete_bookmark":
      return part.output.deleted ? "Bookmark deleted" : "Bookmark not found";
  }
}

export function ToolInvocation({
  part,
  onApproval,
}: {
  part: ToolPart;
  onApproval: (id: string, approved: boolean) => void;
}) {
  const copy = toolCopy(part);
  const output = outputCopy(part);
  const running = part.state === "input-streaming" || part.state === "input-available";

  return (
    <section className={`tool-card tool-card-${part.state}`} aria-label={copy.label}>
      <div className="tool-card-icon" aria-hidden="true">
        {running ? <span className="tool-spinner" /> :
          part.state === "output-error" ? "!" :
          part.state === "approval-requested" ? "?" :
          part.state === "approval-responded" ? "…" :
          part.state === "output-denied" ? "–" : "✓"}
      </div>
      <div className="tool-card-body">
        <div className="tool-card-title-row">
          <strong>{copy.label}</strong>
          <span className="tool-state">
            {part.state === "input-streaming" ? "Preparing" :
              part.state === "input-available" ? "Running" :
              part.state === "approval-requested" ? "Needs approval" :
              part.state === "approval-responded" ? "Decision recorded" :
              part.state === "output-denied" ? "Cancelled" :
              part.state === "output-error" ? "Failed" : "Complete"}
          </span>
        </div>
        <p>{copy.detail}</p>
        {output ? <p className="tool-output">{output}</p> : null}
        {part.state === "output-error" ? <p className="tool-error">The bookmark operation could not be completed.</p> : null}
        {part.state === "output-denied" ? <p className="tool-output">Deletion cancelled.</p> : null}
        {part.state === "approval-requested" ? (
          <div className="tool-approval">
            <p>This permanently removes the bookmark from Stash. Continue?</p>
            <div className="tool-approval-actions">
              <button type="button" className="chat-header-button" onClick={() => onApproval(part.approval.id, false)}>
                Keep bookmark
              </button>
              <button type="button" className="danger-button" onClick={() => onApproval(part.approval.id, true)}>
                Delete bookmark
              </button>
            </div>
          </div>
        ) : null}
        {part.state === "approval-responded" ? (
          <p className="tool-output">{part.approval.approved ? "Deletion approved…" : "Deletion denied."}</p>
        ) : null}
      </div>
    </section>
  );
}
