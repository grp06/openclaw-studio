# Build a guided Personality Builder UI for Agent Brain files

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan is governed by `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, users will no longer edit `SOUL.md`, `IDENTITY.md`, and `USER.md` as raw markdown tabs in the Brain panel. Instead, they will use guided form fields that produce those markdown files deterministically, while still persisting through the existing gateway file APIs. This makes onboarding and persona updates easier for non-technical users and keeps file output compatible with OpenClaw conventions.

A developer can verify the behavior by opening the Brain panel, seeing guided identity/user/soul fields instead of tab-by-tab markdown editing, updating fields, saving, and confirming the outgoing `agents.files.set` payloads contain generated markdown for `SOUL.md`, `IDENTITY.md`, and `USER.md`.

## Progress

- [x] (2026-02-11 06:11Z) Researched current OpenClaw Studio Brain panel and identified the existing read/write primitives in `src/lib/gateway/agentFiles.ts` (`readGatewayAgentFile` at line 21 and `writeGatewayAgentFile` at line 39). [no-beads]
- [x] (2026-02-11 06:11Z) Researched upstream OpenClaw templates and parser references in `~/openclaw` (`docs/reference/templates/IDENTITY.md`, `docs/reference/templates/USER.md`, `docs/reference/templates/SOUL.md`, and `src/agents/identity-file.ts`). [no-beads]
- [x] (2026-02-11 06:18Z) Milestone 1: Added failing-first parser/serializer tests in `tests/unit/personalityBuilder.test.ts` and implemented `src/lib/agents/personalityBuilder.ts`. [no-beads]
- [x] (2026-02-11 06:21Z) Milestone 2: Replaced Brain panel tab-based raw markdown editing with guided Personality Builder fields in `src/features/agents/components/AgentInspectPanels.tsx`, wired to existing gateway file read/write helpers. [no-beads]
- [x] (2026-02-11 06:21Z) Milestone 3: Expanded Brain panel tests and ran verification (`npm run test` passes; `npm run typecheck` and `npm run lint` fail due pre-existing repo issues unrelated to this change). [no-beads]

## Surprises & Discoveries

- Observation: The current Brain panel always saves every file in `AGENT_FILE_NAMES` when any edit is saved, not just the active tab.
  Evidence: `src/features/agents/components/AgentInspectPanels.tsx` lines 1102-1111 iterate through `AGENT_FILE_NAMES` and call `writeGatewayAgentFile` for each entry.

- Observation: OpenClaw already has tolerant IDENTITY markdown parsing that strips placeholders and reads `- Label: value` lines.
  Evidence: `~/openclaw/src/agents/identity-file.ts` (`parseIdentityMarkdown`, `identityHasValues`).

- Observation: OpenClaw template files define stable headings and field labels that can be reused directly for generated output.
  Evidence: `~/openclaw/docs/reference/templates/IDENTITY.md`, `~/openclaw/docs/reference/templates/USER.md`, `~/openclaw/docs/reference/templates/SOUL.md`.

- Observation: The workspace did not have installed node modules, so test-first execution initially failed before any project tests could run.
  Evidence: `npm run test -- tests/unit/personalityBuilder.test.ts` returned `vitest: command not found`; resolved with `npm ci`.

- Observation: Full lint/typecheck gates are currently red for pre-existing issues outside this implementation scope.
  Evidence: `npm run typecheck` failed in `tests/unit/gatewayProxy.test.ts` and `tests/unit/studioSetupPaths.test.ts`; `npm run lint` failed in existing `server/*.js`, `scripts/studio-setup.js`, `src/features/agents/components/GatewayConnectScreen.tsx`, and `tests/unit/accessGate.test.ts`.

## Decision Log

- Decision: Keep `src/lib/gateway/agentFiles.ts` as the only network boundary; implement the Personality Builder as a pure UI/data transformation layer on top of existing `readGatewayAgentFile`/`writeGatewayAgentFile`.
  Rationale: The gateway contract already exists and is tested (`tests/unit/gatewayAgentFiles.test.ts`); changing protocol is unnecessary for this UI shift.
  Date/Author: 2026-02-11 / Codex

- Decision: Introduce a dedicated markdown conversion module for personality files, rather than embedding parsing/serialization in `AgentInspectPanels.tsx`.
  Rationale: Parser and serializer logic must be unit-tested independently and reused cleanly by the panel; keeping this logic out of JSX reduces complexity.
  Date/Author: 2026-02-11 / Codex

- Decision: Use OpenClaw template-compatible section names and labels for generated `IDENTITY.md`, `USER.md`, and `SOUL.md`.
  Rationale: Compatibility minimizes drift with existing ecosystem expectations and enables easy migration between OpenClaw and Studio workspaces.
  Date/Author: 2026-02-11 / Codex

- Decision: Keep `AGENTS.md`, `TOOLS.md`, `HEARTBEAT.md`, and `MEMORY.md` editable in the Personality Builder as long-form guided textareas (single-section guidance) rather than removing them.
  Rationale: The user asked for guided fields that write these files instead of raw tabs; these files still need editing surfaces, but they do not have a stable field schema like identity/user/soul.
  Date/Author: 2026-02-11 / Codex

- Decision: Add an explicit Save button while retaining save-on-close behavior.
  Rationale: The tab-based auto-save trigger was removed with tabs; explicit save provides immediate persistence control without changing close semantics.
  Date/Author: 2026-02-11 / Codex

## Outcomes & Retrospective

Implemented the guided Personality Builder end-to-end for Brain files with deterministic markdown serialization and parser-based prefill.

Completed outcomes:

- Added `src/lib/agents/personalityBuilder.ts` with pure parse/serialize behavior for `IDENTITY.md`, `USER.md`, `SOUL.md`, plus passthrough handling of `AGENTS.md`, `TOOLS.md`, `HEARTBEAT.md`, and `MEMORY.md`.
- Added `tests/unit/personalityBuilder.test.ts` and validated test-first parser/serializer behavior.
- Reworked `src/features/agents/components/AgentInspectPanels.tsx` to replace raw file tabs and preview/edit toggles with guided form sections and markdown generation on save.
- Updated `tests/unit/agentBrainPanel.test.ts` to assert guided-field rendering and generated `IDENTITY.md` save output.
- Verified full unit suite passes (`npm run test`).

Remaining gap:

- Repository-wide `npm run typecheck` and `npm run lint` are not green due pre-existing issues outside this implementation.

## Context and Orientation

The current Brain UI lives inside `src/features/agents/components/AgentInspectPanels.tsx` as `AgentBrainPanel` plus a local hook `useAgentFilesEditor`. It loads all files listed in `src/lib/agents/agentFiles.ts` and presents raw file tabs with preview/edit modes. The current file IO boundary already exists:

- `src/lib/gateway/agentFiles.ts:21` exports `readGatewayAgentFile`.
- `src/lib/gateway/agentFiles.ts:39` exports `writeGatewayAgentFile`.

Those functions call gateway RPC methods `agents.files.get` and `agents.files.set`, so no new gateway route is required.

Existing tests already exercise baseline Brain behavior and gateway IO:

- `tests/unit/agentBrainPanel.test.ts`
- `tests/unit/gatewayAgentFiles.test.ts`
- `tests/unit/agentFilesBootstrap.test.ts`

Reference material from `~/openclaw` (research source for this plan):

- `~/openclaw/docs/reference/templates/IDENTITY.md`
- `~/openclaw/docs/reference/templates/USER.md`
- `~/openclaw/docs/reference/templates/SOUL.md`
- `~/openclaw/src/agents/identity-file.ts` (parsing behavior for identity markdown)
- `~/openclaw/ui/src/ui/controllers/agent-files.ts` (load/save controller flow using same RPC methods)

Terminology used in this plan:

- Personality Builder: the guided form UI that maps structured fields to markdown file contents.
- Serializer: a pure function that turns structured form data into markdown text.
- Parser: a pure function that reads markdown text and extracts structured form data for pre-filling fields.

## Plan of Work

### Milestone 1: Build personality markdown domain utilities (tests first)

Create a new module `src/lib/agents/personalityBuilder.ts` and a focused unit test file `tests/unit/personalityBuilder.test.ts`.

First write failing tests that define stable parse/serialize behavior for `IDENTITY.md`, `USER.md`, and `SOUL.md`, including:

- extraction of known labeled fields (`Name`, `Creature`, `Vibe`, `Emoji`, `Avatar`, etc.),
- normalization of missing/blank fields,
- preservation of multiline section content for SOUL sections,
- deterministic serializer output (headings and section order stay stable).

Then implement types and pure functions in `src/lib/agents/personalityBuilder.ts`:

- `parsePersonalityFiles(...)` to derive a draft from loaded file contents,
- `serializePersonalityFiles(...)` to produce updated markdown file contents from draft state,
- small per-file helpers (`parseIdentityMarkdown`, `serializeIdentityMarkdown`, etc.) where needed.

This milestone ends when parser/serializer tests pass and expose a stable interface for the UI milestone.

### Milestone 2: Replace raw tabs with guided Personality Builder UI (tests first)

Update `tests/unit/agentBrainPanel.test.ts` before changing UI so it fails on the old implementation. Add assertions that the Brain panel now renders guided fields and persists generated markdown via `agents.files.set`.

Then edit `src/features/agents/components/AgentInspectPanels.tsx`:

- remove tab-centric interaction for Brain files (`agentFileTab`, tab buttons, preview/edit mode controls, raw textarea by active tab),
- add Personality Builder sections with explicit field groups:
  - Identity (`IDENTITY.md`) fields,
  - User (`USER.md`) fields,
  - Soul (`SOUL.md`) section text blocks,
  - Long-form sections for `AGENTS.md`, `TOOLS.md`, `HEARTBEAT.md`, `MEMORY.md`,
- initialize builder draft by calling parser utilities on loaded file content,
- on save, generate file contents through serializer utilities and persist through `writeGatewayAgentFile`,
- keep existing load/reload/error/close-save semantics.

Do not add an alternate fallback editor mode. The guided builder is the primary editing path for this feature.

### Milestone 3: Verify behavior end to end and stabilize

Add or update tests for edge behavior (missing files, empty initial files, close-with-dirty changes). Ensure generated markdown is written for personality files and no regression occurs in existing Brain panel flows.

Run full project gates (`typecheck`, unit tests, lint). Commit milestone changes only after verification passes.

## Concrete Steps

Run all commands from repository root:

    cd /Users/georgepickett/.codex/worktrees/51c1/openclaw-studio

Milestone 1 (tests first):

1. Create/extend tests in `tests/unit/personalityBuilder.test.ts` with these test cases:
   - `parseIdentityMarkdown_extracts_fields_from_template_style_list`
   - `parseUserMarkdown_extracts_context_block_and_profile_fields`
   - `parseSoulMarkdown_extracts_core_sections`
   - `serializePersonalityFiles_emits_stable_markdown_for_identity_user_soul`
2. Run the new test file and confirm it fails before implementation:

       npm run test -- tests/unit/personalityBuilder.test.ts

3. Implement `src/lib/agents/personalityBuilder.ts` until tests pass:

       npm run test -- tests/unit/personalityBuilder.test.ts

Milestone 2 (tests first):

1. Update `tests/unit/agentBrainPanel.test.ts` with failing tests such as:
   - `renders_guided_personality_fields_instead_of_file_tabs`
   - `saving_builder_fields_writes_generated_identity_markdown`
2. Confirm failing status before UI edits:

       npm run test -- tests/unit/agentBrainPanel.test.ts

3. Implement UI changes in `src/features/agents/components/AgentInspectPanels.tsx` and wire to `src/lib/agents/personalityBuilder.ts`.
4. Re-run targeted tests:

       npm run test -- tests/unit/agentBrainPanel.test.ts tests/unit/personalityBuilder.test.ts

Milestone 3 (full verification):

1. Run all quality gates:

       npm run typecheck
       npm run test
       npm run lint

2. Inspect changed files and commit milestone completion:

       git status --porcelain=v1
       git add src/lib/agents/personalityBuilder.ts src/features/agents/components/AgentInspectPanels.tsx tests/unit/personalityBuilder.test.ts tests/unit/agentBrainPanel.test.ts
       git commit -m "Milestone X: add guided personality builder for brain files"

Expected concise verification signals:

- `npm run test -- tests/unit/personalityBuilder.test.ts` shows all new parser/serializer tests passing.
- `npm run test -- tests/unit/agentBrainPanel.test.ts` shows guided UI behavior tests passing.
- Full gates exit with code 0.

## Validation and Acceptance

Milestone-level acceptance criteria:

1. Milestone 1 acceptance:
   - Tests in `tests/unit/personalityBuilder.test.ts` fail before implementation and pass after implementation.
   - Parser/serializer functions are pure (no network calls, no React hooks) and deterministic.

2. Milestone 2 acceptance:
   - `tests/unit/agentBrainPanel.test.ts` proves the Brain UI now shows guided form labels/inputs rather than raw file tab buttons.
   - Saving builder changes emits `agents.files.set` calls for `IDENTITY.md`, `USER.md`, and `SOUL.md` with generated markdown content.
   - Existing missing-agent and close-with-save behavior remains covered and passing.

3. Milestone 3 acceptance:
   - `npm run typecheck`, `npm run test`, and `npm run lint` all pass.
   - Manual check in local app confirms editing guided fields updates persisted file contents after save/reload.

## Idempotence and Recovery

The plan is safe to rerun. Parser/serializer tests can be run repeatedly, and UI tests should remain stable because they assert behavior rather than implementation details.

If UI migration breaks save behavior, recover by:

1. Re-running targeted tests to isolate parser vs UI regressions.
2. Temporarily routing save through existing `agentFiles` state shape while keeping builder inputs.
3. Only committing when targeted tests and full gates pass together.

No destructive filesystem or migration operations are required.

## Artifacts and Notes

Generated `IDENTITY.md` output should remain human-readable and template-compatible. Example shape (exact values vary by user input):

    # IDENTITY.md - Who Am I?

    - Name: Nova
    - Creature: fox spirit
    - Vibe: calm and direct
    - Emoji: 🦊
    - Avatar: avatars/nova.png

Generated `USER.md` and `SOUL.md` should follow equivalent heading/section conventions from OpenClaw templates so they stay interoperable.

## Interfaces and Dependencies

Add this new module interface in `src/lib/agents/personalityBuilder.ts` (function names may vary, behavior must match):

    export type PersonalityBuilderDraft = {
      identity: {
        name: string;
        creature: string;
        vibe: string;
        emoji: string;
        avatar: string;
      };
      user: {
        name: string;
        callThem: string;
        pronouns: string;
        timezone: string;
        notes: string;
        context: string;
      };
      soul: {
        coreTruths: string;
        boundaries: string;
        vibe: string;
        continuity: string;
      };
      agents: string;
      tools: string;
      heartbeat: string;
      memory: string;
    };

    export function parsePersonalityFiles(files: Record<AgentFileName, { content: string; exists: boolean }>): PersonalityBuilderDraft;
    export function serializePersonalityFiles(draft: PersonalityBuilderDraft): Record<AgentFileName, string>;

Dependencies to keep unchanged:

- `src/lib/gateway/agentFiles.ts` read/write functions remain the persistence boundary.
- `src/lib/agents/agentFiles.ts` remains the source of file-name constants.
- No gateway protocol or server-side handler changes are required for this milestone.

Plan revision note (2026-02-11): Initial draft created after researching current OpenClaw Studio implementation and upstream OpenClaw templates/parsers as requested.
Plan revision note (2026-02-11): Updated after implementation to record completed milestones, verification evidence, and pre-existing repo gate failures.
