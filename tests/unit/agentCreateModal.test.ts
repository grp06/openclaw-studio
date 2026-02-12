import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AgentCreateModal } from "@/features/agents/components/AgentCreateModal";

const openModal = (overrides?: {
  onClose?: () => void;
  onSubmit?: (payload: unknown) => void;
}) => {
  const onClose = overrides?.onClose ?? vi.fn();
  const onSubmit = overrides?.onSubmit ?? vi.fn();
  render(
    createElement(AgentCreateModal, {
      open: true,
      suggestedName: "New Agent",
      onClose,
      onSubmit,
    })
  );
  return { onClose, onSubmit };
};

describe("AgentCreateModal", () => {
  afterEach(() => {
    cleanup();
  });

  it("submits guided payload through preset-bundle flow", () => {
    const onSubmit = vi.fn();
    openModal({ onSubmit });

    fireEvent.click(screen.getByRole("button", { name: "PR Engineer preset bundle" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Balanced control level" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    fireEvent.change(screen.getByLabelText("Agent name"), {
      target: { value: "PR Agent" },
    });
    fireEvent.change(screen.getByLabelText("First task"), {
      target: { value: "Fix one failing test and ship a minimal patch." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "guided",
        name: "PR Agent",
        draft: expect.objectContaining({
          starterKit: "engineer",
          controlLevel: "balanced",
          firstTask: "Fix one failing test and ship a minimal patch.",
        }),
      })
    );
  });

  it("renders grouped preset sections and capability chips", () => {
    openModal();

    expect(screen.getByText("Knowledge")).toBeInTheDocument();
    expect(screen.getByText("Builder")).toBeInTheDocument();
    expect(screen.getByText("Operations")).toBeInTheDocument();
    expect(screen.getByText("Baseline")).toBeInTheDocument();
    expect(screen.getAllByText("Exec: On").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Internet: Off").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sandbox: non-main").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Risk: Moderate").length).toBeGreaterThan(0);
  });

  it("shows non-main sandbox caveat on preset cards", () => {
    openModal();

    expect(
      screen.getAllByText("Sandbox mode non-main does not sandbox the agent main session.").length
    ).toBeGreaterThan(0);
  });

  it("allows advanced controls for runtime tool additions", () => {
    const onSubmit = vi.fn();
    openModal({ onSubmit });

    fireEvent.click(screen.getByRole("button", { name: "PR Engineer preset bundle" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Balanced control level" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Show advanced controls" }));

    const toolsAllow = screen.getByLabelText(
      "Additional tool allowlist entries (comma or newline separated)"
    );
    fireEvent.change(toolsAllow, { target: { value: "group:web\ngroup:runtime" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "guided",
        draft: expect.objectContaining({
          controls: expect.objectContaining({
            toolsAllow: expect.arrayContaining(["group:web", "group:runtime"]),
          }),
        }),
      })
    );
  });

  it("calls onClose when close is pressed", () => {
    const onClose = vi.fn();
    openModal({ onClose });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
