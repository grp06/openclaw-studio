# Refactor Clawdbot Agent UI to Create-Next-App Best Practices

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Maintain this document in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

After this change, the Clawdbot Agent UI will follow the create-next-app best practices end to end: a `src/`-rooted App Router layout, a feature-first structure, a shared component system using shadcn/ui, validated environment variables, consistent logging helpers, and a proper quality gate stack (lint, typecheck, unit tests, e2e tests, and OpenTelemetry instrumentation). A new contributor should be able to locate UI, domain logic, and shared primitives quickly, and the project should ship with predictable tooling and test coverage that proves the UI still loads and core utilities behave as expected.

You can see it working by running `npm run dev` and loading the canvas UI as before, then running `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run e2e` to confirm the new quality gates pass.

## Progress

- [x] (2026-01-27 00:00Z) Copied the ExecPlan requirements into `.agent/PLANS.md` and drafted this plan based on a repo audit.
- [x] (2026-01-27 19:58Z) Establish the new `src/`-based structure, move files, and update imports to the `@/*` alias.
- [x] (2026-01-27 20:09Z) Add shared infrastructure (shadcn/ui, env validation, logger, http helpers, instrumentation) and update code to use it.
- [x] (2026-01-27 20:13Z) Add quality gates (Prettier integration, Vitest, Playwright) and create initial tests.
- [x] (2026-01-27 20:23Z) Verify the refactor by running lint, typecheck, unit tests, e2e tests, and a dev-server smoke check.

## Surprises & Discoveries

- Observation: `tsc --noEmit` initially failed because `.next/types/validator.ts` referenced the old `/app` paths after the move.
  Evidence: `Cannot find module '../../app/page.js'` errors until a fresh `next build` regenerated `.next/types`.

- Observation: Playwright needed browser binaries installed before the e2e smoke test could launch.
  Evidence: `browserType.launch: Executable doesn't exist ... Please run: npx playwright install`.

- Observation: `next dev` failed when `src/app/globals.css` imported markdown styles from `../styles/markdown.css`.
  Evidence: `CssSyntaxError: ... Can't resolve '../styles/markdown.css' in '/Users/.../src/app'` until the styles moved under `src/app/styles`.

## Decision Log

- Decision: Move the App Router tree from `/app` to `/src/app` and update the `@/*` alias to point at `src/*`.
  Rationale: The create-next-app best practices expect a `src/` root and make internal imports consistent across server and client code.
  Date/Author: 2026-01-27 / Codex

- Decision: Introduce `src/features/canvas` for canvas UI and state, while keeping cross-cutting domain logic in `src/lib/*`.
  Rationale: The canvas UI is a single feature used by one route, so colocating its components and state improves navigability without overhauling shared domain code.
  Date/Author: 2026-01-27 / Codex

- Decision: Use shadcn/ui with the default “new-york” style and zinc palette, and keep Tailwind v4 as-is.
  Rationale: This aligns with the skill defaults and avoids introducing additional styling systems.
  Date/Author: 2026-01-27 / Codex

- Decision: Add minimal unit and e2e tests that exercise existing, stable behavior rather than inventing new UI flows.
  Rationale: The goal is to validate the refactor without forcing new product decisions.
  Date/Author: 2026-01-27 / Codex

- Decision: Mock `/api/projects` in the Playwright smoke test to force an empty store response.
  Rationale: The UI renders the empty-state copy only when there are no projects; mocking keeps the smoke test deterministic even if a developer has existing workspace data.
  Date/Author: 2026-01-27 / Codex

- Decision: Move markdown styles to `src/app/styles/markdown.css` and import them via `./styles/markdown.css` from `src/app/globals.css`.
  Rationale: Turbopack failed to resolve the previous `../styles/markdown.css` import during `next dev`; keeping the file under `src/app` keeps dev builds stable.
  Date/Author: 2026-01-27 / Codex

## Outcomes & Retrospective

(To be filled in once milestones are complete.)

## Context and Orientation

This repository is a Next.js 16 App Router UI with the router currently rooted at `/app` and shared code in `/src`. There is no `src/app` directory yet, imports often use deep relative paths (for example `../src/lib/...`), and there is no testing stack beyond ESLint. There is also no OpenTelemetry instrumentation and no shared UI primitives.

Key files and directories today:

The App Router lives in `app/` with `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, and multiple API routes under `app/api/*` (for example `app/api/projects/route.ts` and `app/api/gateway/route.ts`). UI components live in `src/components/` and are tightly coupled to the canvas route. Client state and reducers are in `src/state/store.tsx`. Shared domain logic is already in `src/lib/` (for example `src/lib/gateway/`, `src/lib/projects/`, and `src/lib/clawdbot/`).

There is an existing ExecPlan at `.agent/EXECPLAN.md` that addresses different functionality. This plan does not depend on it and stands alone.

## Plan of Work

First, move the App Router and UI code to a `src/`-rooted structure that matches the create-next-app layout. This includes relocating the `app/` tree to `src/app`, placing canvas-specific UI and state under `src/features/canvas`, and ensuring all internal imports use the `@/*` alias. After the file moves, update `tsconfig.json` and any import paths so the app builds cleanly without deep relative paths.

Next, add the infrastructure expected by the skill: initialize shadcn/ui, add shared `src/components/ui` primitives, and introduce base `src/lib` helpers for environment validation, logging, HTTP helpers, and tracing. Update the existing code to use these helpers and centralize duplicated logic (notably the gateway config parsing used by `app/api/gateway/route.ts`). Add OpenTelemetry instrumentation via `src/instrumentation.ts` and ensure the service name matches the project.

Finally, add quality gates and tests. Integrate Prettier into the ESLint flat config, add `typecheck`, `test`, and `e2e` scripts, and configure Vitest and Playwright. Write initial unit tests for stable, pure utilities (for example `slugifyProjectName`) and a lightweight e2e smoke test that verifies the canvas UI loads. Run lint, typecheck, unit tests, e2e tests, and a dev-server smoke check to validate the refactor.

## Concrete Steps

Work from the repo root `/Users/georgepickett/clawdbot-agent-ui`.

1. Move the App Router to `src/app` and establish the feature structure using `git mv` so history is preserved.
   Example commands:
     git mv app src/app
     git mv src/components src/features/canvas/components
     git mv src/state src/features/canvas/state
     mkdir -p src/components/shared src/components/ui src/features src/hooks src/styles tests/unit tests/e2e

2. Update import paths to the new locations and to the `@/*` alias. Every import that currently starts with `../src/` or `../../src/` should be replaced with `@/` and point to the new structure. Make sure `src/app/page.tsx`, all API route files under `src/app/api/`, and all moved components and state modules compile cleanly.

3. Update `tsconfig.json` so the `@/*` alias maps to `./src/*`. Ensure all TypeScript path imports align with the new structure.

4. Initialize shadcn/ui and add a starter component. Run the CLI with the opinionated answers from the skill: style `new-york`, base color `zinc`, CSS variables `yes`, global CSS `src/app/globals.css`, components alias `@/components`, utils alias `@/lib/utils`, and UI alias `@/components/ui`. Then add the Button component.
   Example commands:
     npx shadcn@latest init
     npx shadcn@latest add button

5. Add shared `src/lib` helpers and wire them into the existing code.

   Create `src/lib/env.ts` and validate environment variables using Zod. Include optional server variables used in config resolution (`MOLTBOT_STATE_DIR`, `CLAWDBOT_STATE_DIR`, `MOLTBOT_CONFIG_PATH`, `CLAWDBOT_CONFIG_PATH`) and an optional client variable (`NEXT_PUBLIC_GATEWAY_URL`). Use this module in server-side config resolution and in the client hook to default the gateway URL.

   Create `src/lib/logger.ts` as a small wrapper over `console` that exposes `info`, `warn`, `error`, and `debug`, and replace direct `console.*` usage in the gateway client and API routes with the logger to keep logging consistent and easy to adjust.

   Create `src/lib/http.ts` with a `fetchJson<T>(input, init)` helper that throws a useful error when responses are not ok. Update `src/lib/projects/client.ts` (and any other client fetchers) to use this helper.

   Create `src/lib/tracing.ts` as the shared tracing helper, and add `src/instrumentation.ts` that calls `registerOTel` from `@vercel/otel` with `serviceName: "clawdbot-agent-ui"`.

6. Reduce duplicated gateway config logic by refactoring `src/app/api/gateway/route.ts` to rely on the existing `src/lib/clawdbot/config.ts` helpers (or introduce a small `src/lib/clawdbot/gateway.ts` helper if needed) so there is a single source of truth for state dir/config resolution.

7. Split the markdown styling into `src/styles/markdown.css` and import it from `src/app/globals.css`, leaving the Tailwind v4 `@import "tailwindcss";` line intact.

8. Add quality gates and testing configuration.

   Install dependencies (npm is used by this repo):
     npm install zod @vercel/otel
     npm install -D prettier eslint-config-prettier vitest @testing-library/react @testing-library/jest-dom jsdom @playwright/test

   Update `eslint.config.mjs` to include `eslint-config-prettier/flat` and keep the existing ignores. Update `package.json` scripts to:
     lint: eslint .
     typecheck: tsc --noEmit
     test: vitest
     e2e: playwright test

   Create `vitest.config.ts` with a JSDOM environment and a setup file that imports `@testing-library/jest-dom`. Add at least two unit tests in `tests/unit/`:

   - `tests/unit/slugifyProjectName.test.ts` should assert that `slugifyProjectName("My Project")` becomes `"my-project"` and that an all-symbol input throws with the current error message.
   - `tests/unit/fetchJson.test.ts` should stub `fetch` and assert that non-ok responses throw and ok responses return parsed JSON.

   Create `playwright.config.ts` with a `webServer` that runs `npm run dev` on port 3000. Add `tests/e2e/canvas-smoke.spec.ts` that loads `/` and asserts the empty-state copy “Create a workspace to begin.” is visible.

9. Run verification commands and record outputs in the Progress section as you go.

## Validation and Acceptance

The refactor is accepted when the app still runs and all quality gates pass.

Run the following from `/Users/georgepickett/clawdbot-agent-ui`:

- `npm run lint` and expect no ESLint errors.
- `npm run typecheck` and expect no TypeScript errors.
- `npm run test` and expect all unit tests to pass (the new tests must fail before the implementation and pass after).
- `npm run e2e` and expect the Playwright smoke test to pass.
- `npm run dev`, open `http://localhost:3000`, and confirm the canvas UI loads and the empty-state message appears when no workspace is selected.

For each milestone, follow the verification workflow:

1. Tests to write: create the unit tests described above and confirm they fail before the helper implementations or refactors are complete.
2. Implementation: perform the moves, refactors, and helper additions described in the Plan of Work.
3. Verification: re-run the relevant tests and commands until they pass.
4. Commit: after each milestone succeeds, commit the changes with a message like “Milestone 1: Move app to src and update imports”.

## Idempotence and Recovery

The file moves can be re-run safely with `git mv` and do not delete data. If a move goes to the wrong location, move it back and re-run the import updates. Dependency installs are safe to re-run; if conflicts occur, remove `node_modules` and run `npm install` again. If any tests or builds fail, revert to the last successful commit and re-apply the current milestone with smaller, verified steps.

## Artifacts and Notes

Include short transcripts of any failing test errors or build errors encountered during the refactor in this section so the next contributor can see what broke and why. Keep snippets concise and focused on the error and fix.

`npm run test` initially failed with:
  ReferenceError: expect is not defined
  at tests/setup.ts:1
Fix: swap `@testing-library/jest-dom` import to `@testing-library/jest-dom/vitest` and restrict Vitest to `tests/unit/**`.

`npm run e2e` initially failed with:
  Error: browserType.launch: Executable doesn't exist at .../chromium_headless_shell...
Fix: run `npx playwright install` to fetch browsers.

`npm run e2e` then failed with:
  Error: getByText('Create a workspace to begin.') ... element(s) not found
Fix: mock `/api/projects` in the Playwright test to return an empty store.

`npm run dev` failed with:
  CssSyntaxError: ... Can't resolve '../styles/markdown.css' in '/Users/.../src/app'
Fix: move markdown styles into `src/app/styles/markdown.css` and update the import to `./styles/markdown.css`.

## Interfaces and Dependencies

New dependencies to add include `zod` for environment validation, `@vercel/otel` for OpenTelemetry, `prettier` and `eslint-config-prettier` for formatting alignment, `vitest` plus React Testing Library and `jsdom` for unit tests, and `@playwright/test` for e2e testing. The shadcn/ui CLI will add its own dependencies (notably `class-variance-authority`, `tailwind-merge`, `clsx`, and `@radix-ui/react-slot`) when the Button component is installed.

Define these modules explicitly:

In `src/lib/env.ts`, export `env` as the parsed result of a Zod schema containing the optional server variables and the optional `NEXT_PUBLIC_GATEWAY_URL` string.

In `src/lib/logger.ts`, export a `logger` object with `info`, `warn`, `error`, and `debug` methods; each should delegate to the matching `console` method.

In `src/lib/http.ts`, export `fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T>` that throws an `Error` with the response body’s `error` field (if present) or a default message.

In `src/lib/tracing.ts`, export a `registerTracing()` function that calls `registerOTel` or is invoked by `src/instrumentation.ts`.

In `src/instrumentation.ts`, export a `register()` function that calls `registerOTel({ serviceName: "clawdbot-agent-ui" })`.

Plan update note (2026-01-27 19:58Z): Marked milestone 1 complete after moving the App Router to `src/app`, relocating canvas components/state under `src/features/canvas`, and switching imports to the `@/*` alias with the updated TypeScript path mapping.
Plan update note (2026-01-27 20:09Z): Marked milestone 2 complete after adding shadcn/ui, env validation, logger/http/tracing helpers, gateway config reuse, and extracting markdown styles into `src/styles/markdown.css`.
Plan update note (2026-01-27 20:13Z): Marked milestone 3 complete after wiring Prettier into ESLint, adding Vitest + Playwright configs, and creating initial unit and e2e tests.
Plan update note (2026-01-27 20:23Z): Marked milestone 4 complete after running lint/typecheck/tests/e2e, installing Playwright browsers, and stabilizing the smoke test via an `/api/projects` mock.
Plan update note (2026-01-27 20:38Z): Moved markdown styles under `src/app/styles` and updated `globals.css` import to fix `next dev` resolution errors.
