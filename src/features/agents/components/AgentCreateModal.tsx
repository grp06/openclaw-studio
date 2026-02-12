"use client";

import { useMemo, useState } from "react";
import {
  compileGuidedAgentCreation,
  createDefaultGuidedDraft,
  deriveGuidedPresetCapabilitySummary,
  GUIDED_PRESET_BUNDLES,
  resolveGuidedControlsForPreset,
  resolveGuidedDraftFromPresetBundle,
} from "@/features/agents/creation/compiler";
import type {
  AgentControlLevel,
  AgentCreateModalSubmitPayload,
  AgentPresetBundle,
  GuidedAgentCreationDraft,
} from "@/features/agents/creation/types";

type AgentCreateModalProps = {
  open: boolean;
  suggestedName: string;
  busy?: boolean;
  submitError?: string | null;
  onClose: () => void;
  onSubmit: (payload: AgentCreateModalSubmitPayload) => Promise<void> | void;
};

const parseLineList = (value: string): string[] =>
  value
    .split(/\n|,/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const formatLineList = (values: string[]): string => values.join("\n");

const fieldClassName =
  "w-full rounded-md border border-border/80 bg-surface-3 px-3 py-2 text-xs text-foreground outline-none";
const labelClassName =
  "font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground";

const CONTROL_LEVEL_OPTIONS: Array<{
  id: AgentControlLevel;
  title: string;
  description: string;
}> = [
  {
    id: "conservative",
    title: "Conservative",
    description: "Ask-first behavior with tighter approvals.",
  },
  {
    id: "balanced",
    title: "Balanced",
    description: "Practical defaults for most day-to-day work.",
  },
  {
    id: "autopilot",
    title: "Autopilot",
    description: "Highest autonomy with broad execution power.",
  },
];

const PRESET_GROUP_LABELS: Record<(typeof GUIDED_PRESET_BUNDLES)[number]["group"], string> = {
  knowledge: "Knowledge",
  builder: "Builder",
  operations: "Operations",
  baseline: "Baseline",
};

const titleCase = (value: string): string =>
  value
    .split("-")
    .map((part) => (part.length > 0 ? `${part[0]!.toUpperCase()}${part.slice(1)}` : part))
    .join(" ");

export const AgentCreateModal = ({
  open,
  suggestedName,
  busy = false,
  submitError = null,
  onClose,
  onSubmit,
}: AgentCreateModalProps) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [name, setName] = useState(() => suggestedName);
  const [guidedDraft, setGuidedDraft] = useState<GuidedAgentCreationDraft>(
    createDefaultGuidedDraft
  );
  const [selectedPresetBundle, setSelectedPresetBundle] = useState<AgentPresetBundle | null>(
    "pr-engineer"
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  const compiledGuided = useMemo(
    () => compileGuidedAgentCreation({ name, draft: guidedDraft }),
    [guidedDraft, name]
  );

  const steps = ["starter", "control", "customize", "review"] as const;
  const stepKey = steps[stepIndex] ?? "starter";

  const canGoNext =
    stepKey === "starter"
      ? Boolean(guidedDraft.starterKit)
      : stepKey === "control"
        ? Boolean(guidedDraft.controlLevel)
        : stepKey === "customize"
          ? name.trim().length > 0
          : false;

  const canSubmit =
    stepKey === "review" &&
    name.trim().length > 0 &&
    compiledGuided.validation.errors.length === 0;

  const moveNext = () => {
    if (!canGoNext) return;
    setStepIndex((current) => Math.min(steps.length - 1, current + 1));
  };

  const moveBack = () => {
    setStepIndex((current) => Math.max(0, current - 1));
  };

  const presetCards = useMemo(
    () =>
      GUIDED_PRESET_BUNDLES.map((preset) => {
        const draft = resolveGuidedDraftFromPresetBundle({
          bundle: preset.id,
          seed: createDefaultGuidedDraft(),
        });
        const capability = deriveGuidedPresetCapabilitySummary({
          controls: draft.controls,
          heartbeatEnabled: draft.heartbeatEnabled,
        });
        return {
          ...preset,
          capability,
        };
      }),
    []
  );

  const updatePresetBundle = (bundle: AgentPresetBundle) => {
    setSelectedPresetBundle(bundle);
    setGuidedDraft((current) => ({
      ...resolveGuidedDraftFromPresetBundle({
        bundle,
        seed: current,
      }),
    }));
  };

  const updateControlLevel = (controlLevel: AgentControlLevel) => {
    setSelectedPresetBundle(null);
    setGuidedDraft((current) => ({
      ...current,
      controlLevel,
      controls: resolveGuidedControlsForPreset({
        starterKit: current.starterKit,
        controlLevel,
      }),
    }));
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;
    void onSubmit({ mode: "guided", name: trimmedName, draft: guidedDraft });
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-background/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Create agent"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="w-full max-w-3xl rounded-lg border border-border bg-card"
        onClick={(event) => event.stopPropagation()}
        data-testid="agent-create-modal"
      >
        <div className="flex items-center justify-between border-b border-border/80 px-5 py-4">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              New Agent
            </div>
            <div className="mt-1 text-base font-semibold text-foreground">Starter setup</div>
          </div>
          <button
            type="button"
            className="rounded-md border border-border/80 bg-surface-3 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition hover:border-border hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </div>

        <div className="max-h-[72vh] overflow-auto px-5 py-4">
          {stepKey === "starter" ? (
            <div className="grid gap-3" data-testid="agent-create-starter-step">
              <div className="text-sm text-muted-foreground">
                Pick a preset bundle. You can still customize controls before creation.
              </div>
              {Object.entries(PRESET_GROUP_LABELS).map(([group, groupLabel]) => (
                <div key={group} className="grid gap-2">
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {groupLabel}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {presetCards
                      .filter((preset) => preset.group === group)
                      .map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          aria-label={`${preset.title} preset bundle`}
                          className={`rounded-md border px-4 py-4 text-left transition ${
                            selectedPresetBundle === preset.id
                              ? "border-border bg-surface-2"
                              : "border-border/80 bg-surface-1 hover:border-border hover:bg-surface-2"
                          }`}
                          onClick={() => updatePresetBundle(preset.id)}
                        >
                          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            {preset.title}
                          </div>
                          <div className="mt-2 text-sm text-foreground">{preset.description}</div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {preset.capability.chips.map((chip) => (
                              <span
                                key={`${preset.id}-${chip.id}`}
                                className="rounded border border-border/70 bg-surface-3 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground"
                              >
                                {chip.label}: {chip.value}
                              </span>
                            ))}
                          </div>
                          <div className="mt-2 text-xs font-semibold text-foreground">
                            Risk: {titleCase(preset.capability.risk)}
                          </div>
                          {preset.capability.caveats.map((caveat) => (
                            <div key={`${preset.id}-${caveat}`} className="mt-1 text-xs text-muted-foreground">
                              {caveat}
                            </div>
                          ))}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {stepKey === "control" ? (
            <div className="grid gap-3" data-testid="agent-create-control-step">
              <div className="text-sm text-muted-foreground">
                Choose how autonomous this agent should be.
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {CONTROL_LEVEL_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-label={`${option.title} control level`}
                    className={`rounded-md border px-4 py-4 text-left transition ${
                      guidedDraft.controlLevel === option.id
                        ? "border-border bg-surface-2"
                        : "border-border/80 bg-surface-1 hover:border-border hover:bg-surface-2"
                    }`}
                    onClick={() => updateControlLevel(option.id)}
                  >
                    <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {option.title}
                    </div>
                    <div className="mt-2 text-sm text-foreground">{option.description}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {stepKey === "customize" ? (
            <div className="grid gap-4" data-testid="agent-create-customize-step">
              <label className={labelClassName}>
                Agent name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className={`mt-1 ${fieldClassName}`}
                  placeholder="My agent"
                />
              </label>
              <label className={labelClassName}>
                First task
                <textarea
                  className={`mt-1 min-h-20 ${fieldClassName}`}
                  value={guidedDraft.firstTask}
                  onChange={(event) =>
                    setGuidedDraft((current) => ({
                      ...current,
                      firstTask: event.target.value,
                    }))
                  }
                  placeholder="What should this agent handle first?"
                />
              </label>
              <label className={labelClassName}>
                Custom instructions (optional)
                <textarea
                  className={`mt-1 min-h-16 ${fieldClassName}`}
                  value={guidedDraft.customInstructions}
                  onChange={(event) =>
                    setGuidedDraft((current) => ({
                      ...current,
                      customInstructions: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-md border border-border/80 bg-surface-2 px-3 py-2">
                <span className={labelClassName}>Enable heartbeat checklist</span>
                <input
                  type="checkbox"
                  checked={guidedDraft.heartbeatEnabled}
                  onChange={(event) =>
                    setGuidedDraft((current) => ({
                      ...current,
                      heartbeatEnabled: event.target.checked,
                    }))
                  }
                />
              </label>

              <button
                type="button"
                aria-label={showAdvanced ? "Hide advanced controls" : "Show advanced controls"}
                className="rounded-md border border-border/80 bg-surface-3 px-3 py-2 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition hover:border-border hover:bg-surface-2"
                onClick={() => setShowAdvanced((current) => !current)}
              >
                {showAdvanced ? "Hide advanced controls" : "Show advanced controls"}
              </button>

              {showAdvanced ? (
                <div className="grid gap-3 rounded-md border border-border/80 bg-surface-1 p-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className={labelClassName}>
                      Tool profile
                      <select
                        className={`mt-1 ${fieldClassName}`}
                        value={guidedDraft.controls.toolsProfile}
                        onChange={(event) =>
                          setGuidedDraft((current) => ({
                            ...current,
                            controls: {
                              ...current.controls,
                              toolsProfile:
                                event.target.value as GuidedAgentCreationDraft["controls"]["toolsProfile"],
                            },
                          }))
                        }
                      >
                        <option value="minimal">Minimal</option>
                        <option value="coding">Coding</option>
                        <option value="messaging">Messaging</option>
                        <option value="full">Full</option>
                      </select>
                    </label>
                    <label className={labelClassName}>
                      Sandbox mode
                      <select
                        className={`mt-1 ${fieldClassName}`}
                        value={guidedDraft.controls.sandboxMode}
                        onChange={(event) =>
                          setGuidedDraft((current) => ({
                            ...current,
                            controls: {
                              ...current.controls,
                              sandboxMode:
                                event.target.value as GuidedAgentCreationDraft["controls"]["sandboxMode"],
                            },
                          }))
                        }
                      >
                        <option value="off">Off</option>
                        <option value="non-main">Non-main</option>
                        <option value="all">All sessions</option>
                      </select>
                    </label>
                    <label className={labelClassName}>
                      Workspace access
                      <select
                        className={`mt-1 ${fieldClassName}`}
                        value={guidedDraft.controls.workspaceAccess}
                        onChange={(event) =>
                          setGuidedDraft((current) => ({
                            ...current,
                            controls: {
                              ...current.controls,
                              workspaceAccess:
                                event.target.value as GuidedAgentCreationDraft["controls"]["workspaceAccess"],
                            },
                          }))
                        }
                      >
                        <option value="none">None</option>
                        <option value="ro">Read-only</option>
                        <option value="rw">Read/write</option>
                      </select>
                    </label>
                    <label className={labelClassName}>
                      Approval mode
                      <select
                        className={`mt-1 ${fieldClassName}`}
                        value={guidedDraft.controls.approvalAsk}
                        onChange={(event) =>
                          setGuidedDraft((current) => ({
                            ...current,
                            controls: {
                              ...current.controls,
                              approvalAsk:
                                event.target.value as GuidedAgentCreationDraft["controls"]["approvalAsk"],
                            },
                          }))
                        }
                      >
                        <option value="always">Always</option>
                        <option value="on-miss">On miss</option>
                        <option value="off">Off</option>
                      </select>
                    </label>
                  </div>
                  <label className="flex items-center justify-between gap-3 rounded-md border border-border/80 bg-surface-2 px-3 py-2">
                    <span className={labelClassName}>Allow runtime exec tools</span>
                    <input
                      type="checkbox"
                      checked={guidedDraft.controls.allowExec}
                      onChange={(event) =>
                        setGuidedDraft((current) => ({
                          ...current,
                          controls: {
                            ...current.controls,
                            allowExec: event.target.checked,
                          },
                        }))
                      }
                    />
                  </label>
                  <label className={labelClassName}>
                    Additional tool allowlist entries (comma or newline separated)
                    <textarea
                      className={`mt-1 min-h-16 ${fieldClassName}`}
                      value={formatLineList(guidedDraft.controls.toolsAllow)}
                      onChange={(event) =>
                        setGuidedDraft((current) => ({
                          ...current,
                          controls: {
                            ...current.controls,
                            toolsAllow: parseLineList(event.target.value),
                          },
                        }))
                      }
                    />
                  </label>
                  <label className={labelClassName}>
                    Additional tool denylist entries (comma or newline separated)
                    <textarea
                      className={`mt-1 min-h-16 ${fieldClassName}`}
                      value={formatLineList(guidedDraft.controls.toolsDeny)}
                      onChange={(event) =>
                        setGuidedDraft((current) => ({
                          ...current,
                          controls: {
                            ...current.controls,
                            toolsDeny: parseLineList(event.target.value),
                          },
                        }))
                      }
                    />
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}

          {stepKey === "review" ? (
            <div className="grid gap-4" data-testid="agent-create-review-step">
              <div className="rounded-md border border-border/80 bg-surface-2 px-4 py-3">
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Config preview
                </div>
                <ul className="mt-2 list-disc pl-5 text-sm text-foreground">
                  {compiledGuided.summary.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              {compiledGuided.validation.errors.length > 0 ? (
                <div className="rounded-md border border-destructive/50 bg-destructive/12 px-4 py-3 text-sm text-destructive">
                  {compiledGuided.validation.errors.map((error) => (
                    <div key={error}>{error}</div>
                  ))}
                </div>
              ) : null}
              {compiledGuided.validation.warnings.length > 0 ? (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
                  {compiledGuided.validation.warnings.map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {submitError ? (
            <div className="mt-4 rounded-md border border-destructive/50 bg-destructive/12 px-3 py-2 text-xs text-destructive">
              {submitError}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-border/80 px-5 py-3">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Step {stepIndex + 1} of {steps.length}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-border/80 bg-surface-3 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition hover:border-border hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={moveBack}
              disabled={stepIndex === 0 || busy}
            >
              Back
            </button>
            {stepKey === "review" ? (
              <button
                type="button"
                className="rounded-md border border-transparent bg-primary px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-foreground transition hover:brightness-105 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
                onClick={handleSubmit}
                disabled={!canSubmit || busy}
              >
                {busy ? "Creating..." : "Create agent"}
              </button>
            ) : (
              <button
                type="button"
                className="rounded-md border border-transparent bg-primary px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-foreground transition hover:brightness-105 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
                onClick={moveNext}
                disabled={!canGoNext || busy}
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
