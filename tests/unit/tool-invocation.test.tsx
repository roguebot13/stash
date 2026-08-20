// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ToolInvocation } from "@/app/chat/tool-invocation";

describe("bookmark tool invocation", () => {
  it("requires a deliberate choice for deletion", () => {
    const onApproval = vi.fn();
    render(
      <ToolInvocation
        part={{
          type: "tool-delete_bookmark",
          toolCallId: "call-1",
          state: "approval-requested",
          input: { id: "bookmark-1" },
          approval: { id: "approval-1" },
        }}
        onApproval={onApproval}
      />,
    );

    expect(screen.getByText("This permanently removes the bookmark from Stash. Continue?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep bookmark" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete bookmark" }));
    expect(onApproval).toHaveBeenNthCalledWith(1, "approval-1", false);
    expect(onApproval).toHaveBeenNthCalledWith(2, "approval-1", true);
  });

  it("summarizes results without dumping structured content", () => {
    render(
      <ToolInvocation
        part={{
          type: "tool-list_bookmarks",
          toolCallId: "call-2",
          state: "output-available",
          input: { limit: 20, cursor: null },
          output: { bookmarks: [], next_cursor: null },
        }}
        onApproval={vi.fn()}
      />,
    );
    expect(screen.getByText("0 bookmarks")).toBeInTheDocument();
    expect(screen.queryByText("next_cursor")).not.toBeInTheDocument();
  });
});
