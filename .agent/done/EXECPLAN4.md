# Show Thinking Traces in Agent Chat Tiles

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Maintain this document in accordance with `.agent/PLANS.md` (repository root).

## Purpose / Big Picture

After this change, the Agent Canvas UI surfaces the model's "thinking" blocks alongside assistant replies. When a chat run streams, the tile shows a live thinking trace; when the run completes or when history is loaded, the thinking trace is preserved in the output timeline so the user can read it later. This makes the UI match the session log format (for example the `content[]` items with `type: "thinking"` in `~/.clawdbot/agents/.../sessions/*.jsonl`) and removes the current gap where reasoning is either hidden or truncated.

You can see it working by starting the dev server, sending a message to an agent with thinking enabled, and watching the tile output show a "Thinking" block before the assistant response. Reloading the page should still show those thinking blocks in history for that session.

## Progress

- [x] (2026-01-27 23:46Z) Milestone 1: Added `src/lib/text/extractThinking.ts` with extraction/formatting helpers and `tests/unit/extractThinking.test.ts`; unit tests pass.
- [ ] (2026-01-27 23:55Z) Milestone 2: Wired thinking traces into live streaming, history loading, and tile rendering; traces collapse after completion with a toggleable summary; README updated (manual UI verification still pending).

## Surprises & Discoveries

- Observation: No surprises encountered while parsing thinking blocks or wiring UI rendering.
  Evidence: `npm run test -- tests/unit/extractThinking.test.ts` passed on first run.

## Decision Log

- Decision: Treat "thinking traces" as first-class output lines, rendered before the assistant reply and persisted in history.
  Rationale: The session logs include explicit thinking blocks; representing them as output lines preserves them after streaming ends and keeps the UI timeline coherent.
  Date/Author: 2026-01-27 / Codex

- Decision: Parse thinking from `message.content[]` items with `type: "thinking"`, with `<thinking>...</thinking>` tag parsing as back-compat.
  Rationale: The provided session log uses `content[]` with `type: "thinking"`, but older logs can embed thinking tags; supporting both matches existing Clawdbot UI behavior.
  Date/Author: 2026-01-27 / Codex

- Decision: Render live thinking with the raw markdown content, but store completed thinking as a formatted trace block in output history.
  Rationale: Live thinking should reflect the model output as-is, while history benefits from consistent styling and collapsible traces.
  Date/Author: 2026-01-27 / Codex

- Decision: Represent completed traces as a prefixed markdown string and render them as collapsed `<details>` blocks with a "Trace" summary.
  Rationale: Output lines remain simple strings for persistence, while the UI can detect and render a toggleable collapsed view without adding a new data model.
  Date/Author: 2026-01-27 / Codex

## Outcomes & Retrospective

- Outcome: Thinking extraction helpers and unit tests added; UI now surfaces thinking during streaming and persists it in history. Manual end-to-end verification remains to confirm runtime behavior.

## Context and Orientation

This repo is a Next.js App Router UI for the Clawdbot agent canvas. Chat traffic arrives over the gateway WebSocket and is handled in `src/app/page.tsx`, which updates tile state stored in `src/features/canvas/state/store.tsx`. Tiles render their outputs in `src/features/canvas/components/AgentTile.tsx` using `ReactMarkdown` and the `agent-markdown` styles in `src/app/styles/markdown.css`.

Relevant paths for this change:
- `src/app/page.tsx`: Gateway event handlers for `chat` and `agent`, history loading (`chat.history`), and the current thinking trace extraction helpers.
- `src/features/canvas/components/AgentTile.tsx`: Renders the tile output area and the inline "thinking" block.
- `src/lib/text/extractText.ts`: Extracts assistant/user text and strips `<thinking>` tags from assistant responses.
- `tests/unit/*`: Vitest unit tests; new parsing utilities should be tested here.

The provided session log at `/Users/georgepickett/.clawdbot/agents/proj-clawdbot-agent-ui-agent-5aab/sessions/b9773235-f5b1-46b4-8eb6-86bbd312828b.jsonl` shows the exact thinking payload shape: assistant `message.content[]` includes `{ type: "thinking", thinking: "...", thinkingSignature: "..." }` ahead of tool calls and text.

## Plan of Work

The work has two milestones. First, create a small parsing utility that can extract thinking text from the same message shapes found in the session log and format it for display, backed by unit tests. Second, wire that utility into the live chat stream handler and the history loader so thinking traces show during streaming and remain visible in the output timeline after completion. The tile rendering should display the live thinking trace as markdown (not just a truncated first line) and the output timeline should include formatted thinking blocks before assistant replies. Update the README with a short note about thinking traces so the behavior is documented.

## Concrete Steps

All commands below run from:

    /Users/georgepickett/clawdbot-agent-ui

### Milestone 1: Thinking extraction + tests

Acceptance for this milestone is that we can extract thinking text from the message shapes in the session log (content arrays with `type: "thinking"`) and from embedded `<thinking>` tags, and that the behavior is covered by unit tests.

1. Add a new helper in `src/lib/text/extractThinking.ts`.

   Implement and export:
   - `extractThinking(message: unknown): string | null` -- returns concatenated thinking text when `message.content` is an array of `{ type: "thinking", thinking: string }` entries, or when raw text contains `<thinking>...</thinking>` tags. Return `null` for empty/whitespace-only results.
   - `formatThinkingMarkdown(text: string): string` -- returns a markdown block that visually separates thinking from normal output (for example: a "Thinking:" label followed by italicized non-empty lines). Keep it deterministic so tests can assert exact output.

   The helper should not mutate inputs and should not rely on DOM APIs.

2. Add unit tests in `tests/unit/extractThinking.test.ts` (new).

   Write tests first and confirm they fail before implementation. Cover these cases:
   - Extracts a single thinking block from `content[]` and returns trimmed text.
   - Extracts multiple thinking blocks and joins them with `\n` in order.
   - Extracts thinking from a string containing `<thinking>...</thinking>` tags.
   - Returns `null` when no thinking exists or when the thinking text is only whitespace.
   - `formatThinkingMarkdown` produces the expected labeled/italicized markdown for multi-line thinking.

3. Run:

       npm run test -- tests/unit/extractThinking.test.ts

   Expect the new tests to pass.

4. Commit:

       git add -A
       git commit -m "Milestone 1: Add thinking extraction helpers"

### Milestone 2: UI wiring + history + docs

Acceptance for this milestone is that thinking traces are visible while a run streams, persisted in the output timeline after completion, and included when loading chat history. The output should show the thinking block before the assistant reply.

1. Update `src/app/page.tsx` to use the new helpers.

   - Replace `formatThinkingTrace`/`extractThinkingTrace` with calls to `extractThinking` and `formatThinkingMarkdown`.
   - In the chat event handler (`event.event === "chat"`):
     - When `payload.state === "delta"`, if a thinking block is present, set `tile.thinkingTrace` to the raw thinking text (not truncated). Keep the tile status as `running`.
     - When `payload.state === "final"`, extract thinking from the final message (or use any pending `tile.thinkingTrace`), format it with `formatThinkingMarkdown`, and `appendOutput` it before appending the assistant's final text. Then clear `thinkingTrace` and `streamText` as today.
   - In `buildHistoryLines`, for each assistant message, extract thinking and insert the formatted thinking markdown line before the assistant response line in the returned `lines` array. Keep user lines unchanged.

2. Update `src/features/canvas/components/AgentTile.tsx` to render live thinking as markdown.

   - Render the `thinkingTrace` block using `ReactMarkdown` so multi-line thinking and markdown formatting appear correctly.
   - Keep the existing visual styling (amber block) but remove truncation logic; the content should be the full thinking trace as sent by the model.

3. Update `README.md` with a short section explaining that thinking traces are displayed when the model sends `content[]` entries of type `thinking` or `<thinking>` blocks, and that the thinking level selector controls whether those traces appear.

4. Manual verification:

   - Run `npm run dev`.
   - Open the UI, select an agent tile, set thinking to `low` or `medium`, and send a short message.
   - Confirm that while the run is streaming, a "thinking" block appears in the tile output, and once the response completes the thinking block remains in the output history above the assistant reply.
   - Reload the page and confirm the thinking block persists via history loading.

5. Commit:

       git add -A
       git commit -m "Milestone 2: Surface thinking traces in chat tiles"

## Validation and Acceptance

Run unit tests and verify an end-to-end chat:

- Unit tests: `npm run test -- tests/unit/extractThinking.test.ts` should pass.
- Manual UI check: start the dev server and confirm thinking blocks appear live and persist after completion and reload.

The change is accepted when an agent run shows the thinking trace as a distinct block before the assistant message, and history reloads show the same thinking traces from `chat.history`.

## Idempotence and Recovery

All steps are safe to rerun. If a test or manual check fails, revert the latest commit, adjust the helper or UI wiring, and rerun the same commands. No persistent data migrations are required; only UI rendering changes and parsing utilities are added.

## Artifacts and Notes

- Example thinking payload (from session log):

    { "type": "thinking", "thinking": "**Running initial repo listing**", "thinkingSignature": "..." }

- Expected output ordering in a tile after completion:

    _Running initial repo listing_
    
    <assistant response>

- Test run:

    npm run test -- tests/unit/extractThinking.test.ts
    PASS tests/unit/extractThinking.test.ts (6 tests)

Plan update note: 2026-01-27 -- added wheel handling so selected tile output scrolls without page scroll; changed completed traces to render as a single collapsible "Thinking" block and updated README wording.

## Interfaces and Dependencies

- `src/lib/text/extractThinking.ts`
  - `extractThinking(message: unknown): string | null`
  - `formatThinkingMarkdown(text: string): string`

- `src/app/page.tsx`
  - Use `extractThinking` and `formatThinkingMarkdown` in `buildHistoryLines` and chat event handling.

- `src/features/canvas/components/AgentTile.tsx`
  - Render `thinkingTrace` via `ReactMarkdown` inside the existing styled block.

No new external dependencies are required.
