# Docs: Connection Model, Remote Access Recipes, and Troubleshooting

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository does not have a root `PLANS.md`. This document must be maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

After this change, a new user can read the docs, pick the setup that matches their situation (Studio local vs remote, Gateway local vs remote, Tailscale vs SSH tunnel), and get connected without guessing what “localhost”, “ws://”, and “wss://” mean in this system. When they get stuck, the troubleshooting guide helps them quickly identify whether the failure is in the browser to Studio path, or Studio to Gateway path, and gives concrete fixes.

The key outcome is that we stop teaching the wrong mental model. In this repo, the browser does not connect directly to the upstream Gateway. The browser connects to Studio’s same-origin WebSocket bridge at `/api/gateway/ws`, and the Studio Node server connects upstream to the configured Gateway URL and forwards frames.

## Progress

- [x] (2026-02-15 21:06Z) Audit existing docs for contradictions and missing scenarios; explicitly list which statements are “browser-side” vs “Studio-host-side” for each recipe.
- [x] (2026-02-15 21:06Z) Add `docs/remote-access.md` with the correct connection model, three deployment recipes, and troubleshooting keyed to where the failure occurs (browser->Studio vs Studio->Gateway).
- [x] (2026-02-15 21:06Z) Update `README.md` to be a clear entry point: short connection model, minimal quick start, link to `docs/remote-access.md`, and a short “common pitfalls” pointer.
- [x] (2026-02-15 21:06Z) Update `ARCHITECTURE.md` where it contradicts code (remove unsupported env var claims like `STUDIO_UPSTREAM_GATEWAY_URL`/`STUDIO_UPSTREAM_GATEWAY_TOKEN`).
- [x] (2026-02-15 21:06Z) Document `STUDIO_ACCESS_TOKEN` (cookie gate) as an optional hardening measure for non-tailnet deployments.
- [x] (2026-02-15 21:06Z) Run repo checks (`npm test`, `npm run lint`, `npm run typecheck`). (Note: this environment did not have `openclaw` installed, so recipe validation was doc/code-grounded rather than a live gateway run.)

## Surprises & Discoveries

- Observation: Studio uses a same-origin WebSocket bridge (`/api/gateway/ws`) and a Node-side upstream connection to the configured Gateway URL, rather than direct browser to Gateway.
  Evidence: `server/index.js` upgrades `/api/gateway/ws` to `createGatewayProxy(...)`, and `server/gateway-proxy.js` creates `upstreamWs = new WebSocket(upstreamUrl, ...)` after loading settings from `server/studio-settings.js`.
- Observation: `ARCHITECTURE.md` claims server-side overrides via `STUDIO_UPSTREAM_GATEWAY_URL`/`STUDIO_UPSTREAM_GATEWAY_TOKEN`, but the current Node server loads upstream settings from `~/.openclaw/openclaw-studio/settings.json` via `server/studio-settings.js` and does not reference those env vars.
  Evidence: `ARCHITECTURE.md` mentions the env vars; `rg STUDIO_UPSTREAM_GATEWAY_URL` only finds that mention; `server/studio-settings.js` reads settings from disk and `NEXT_PUBLIC_GATEWAY_URL` as a default only.
- Observation: `npm run lint` failed on CommonJS `require(...)` in `server/*.js` and `scripts/*.js` under the default Next TypeScript config.
  Evidence: ESLint reported `@typescript-eslint/no-require-imports` errors for `server/index.js`, `server/gateway-proxy.js`, `server/access-gate.js`, and `scripts/studio-setup.js`.

## Decision Log

- Decision: Put all remote-access and troubleshooting guidance in one doc under `docs/` and keep `README.md` short with links.
  Rationale: Keeps `README.md` approachable while still giving comprehensive guidance for “get unstuck” scenarios; avoids scattering similar advice across many files.
  Date/Author: 2026-02-15 / Codex
- Decision: Troubleshooting will reference the exact connect error codes emitted by the Studio proxy (for example `studio.gateway_url_missing`) so users can map UI errors to causes.
  Rationale: These codes are stable, code-defined strings in `server/gateway-proxy.js` and are already treated specially by retry logic in `src/lib/gateway/GatewayClient.ts`.
  Date/Author: 2026-02-15 / Codex
- Decision: Add an ESLint override to allow CommonJS `require(...)` in `server/**/*.js` and `scripts/**/*.js`.
  Rationale: Those files run under Node as CommonJS (per current `package.json`), and the strict TypeScript rule was preventing `npm run lint` from succeeding.
  Date/Author: 2026-02-15 / Codex

## Outcomes & Retrospective

- Outcome: Added a single remote-access doc and linked to it from `README.md`, so VPS/Tailscale/SSH guidance is centralized and consistent with the actual Studio WS bridge design.
- Outcome: Corrected `ARCHITECTURE.md` to match code by removing unsupported env var claims for upstream gateway overrides.
- Gap: Did not run a live `openclaw gateway` in this environment (CLI not installed here); validation was via repo tests plus code-grounded docs (paths, error codes, and settings locations).

## Context and Orientation

Key terms (define in docs in plain language):

Studio: This repo’s Next.js UI. When you run `npm run dev`, you are running a Node server defined in `server/index.js` that serves the Next app and also terminates WebSocket upgrades.

Gateway: The OpenClaw Gateway process. It speaks a WebSocket protocol and is the source of truth for agent runtime state.

WS bridge / proxy: In this repo, Studio accepts a browser WebSocket at `/api/gateway/ws` and then Studio opens its own upstream WebSocket connection to the Gateway. Studio forwards JSON frames between the two sockets. This extra hop exists so Studio can load the upstream Gateway URL/token on the server side and inject auth tokens when needed. The word “proxy” here means “a middleman that forwards traffic”.

Where settings live:

Studio stores its upstream connection settings (Gateway URL + token) on the Studio host in `~/.openclaw/openclaw-studio/settings.json` (resolved server-side). The settings API is `GET/PUT /api/studio` (`src/app/api/studio/route.ts`), backed by filesystem reads/writes in `src/lib/studio/settings-store.ts`. The Node WS proxy loads upstream settings via `server/studio-settings.js` and uses them in `server/gateway-proxy.js`.

State dir resolution:

Both `server/studio-settings.js` and `src/lib/clawdbot/paths.ts` resolve the state directory to `~/.openclaw` by default, with fallbacks to legacy `~/.moltbot` and `~/.clawdbot`, and allow overrides via `OPENCLAW_STATE_DIR`/`OPENCLAW_CONFIG_PATH` (and legacy env var names).

Relevant repo files:

- `README.md`: entry-point docs today.
- `ARCHITECTURE.md`: has the authoritative description of the bridge design and data flow.
- `server/index.js`: Node server that handles `/api/gateway/ws` upgrades.
- `server/gateway-proxy.js`: forwards browser frames to upstream gateway; injects token if missing; rewrites upstream Origin for loopback to `localhost`.
- `server/studio-settings.js`: loads upstream gateway URL/token from the Studio settings file; can fall back to local `openclaw.json` defaults.
- `server/access-gate.js`: optional cookie-based access gate enabled by `STUDIO_ACCESS_TOKEN`.
- `src/lib/gateway/GatewayClient.ts`: browser-side client connects to the Studio bridge via `resolveStudioProxyGatewayUrl()` and uses `authScopeKey` to scope auth.
- `src/lib/gateway/openclaw/GatewayBrowserClient.ts`: vendored client that formats connect frames and interprets close reasons like `connect failed: <CODE> ...`.
- `src/app/api/studio/route.ts`: settings API that returns `{ settings, localGatewayDefaults }`.
- `src/lib/studio/settings.ts`: normalizes gateway URLs (loopback IPs become `localhost`) and defines settings shapes.

## Plan of Work

Create one comprehensive doc under `docs/` and reframe `README.md` to point at it.

The comprehensive doc must be written to match how the code actually behaves:

1. Explain the connection model using a short diagram and “what does localhost mean” examples.
2. Provide “known good” recipes for three common deployment shapes:

   - Studio local, Gateway remote (direct `ws://`, or via Tailscale Serve as `wss://`, or via SSH tunnel).
   - Studio and Gateway on the same VPS (recommended: keep Gateway on loopback; expose only Studio; optional: expose Gateway too for non-Studio clients).
   - Studio remote, Gateway remote (Studio host must be able to reach the gateway; clarify that the browser does not need direct gateway reachability).

3. Provide a troubleshooting checklist that is keyed by where the failure is happening:

   - Browser to Studio (HTTP/HTTPS issues, mixed content, asset 404s when reverse-proxying under a path prefix).
   - Studio to Gateway (token missing on Studio host, upstream URL invalid, TLS mismatch `wss://` to non-TLS, upstream closed).

Keep the guidance generic and safe for open source. Do not include any personal hostnames, tailnet names, SSH aliases, or internal runbooks.

## Concrete Steps

1. Create `docs/remote-access.md` (new directory + new file).

   From repo root:

       mkdir -p docs
       $EDITOR docs/remote-access.md

   The doc should include:

   - A “Connection model” section with an ASCII diagram similar to:

       Browser
         |  HTTP (pages, API)
         |  WS  /api/gateway/ws
         v
       Studio (this repo, Node server)
         |  WS  <configured upstream gateway URL>
         v
       OpenClaw Gateway

     and explicitly name the concrete code paths:

       - Browser WS URL is computed from `window.location` in `src/lib/gateway/proxy-url.ts`.
       - Studio terminates WS upgrades at `/api/gateway/ws` in `server/index.js`.
       - Studio dials upstream using `new WebSocket(upstreamUrl, ...)` in `server/gateway-proxy.js`.

   - A “What ‘localhost’ means” section with two concrete examples:

       If Studio runs on your laptop: `ws://localhost:18789` means Gateway on your laptop.
       If Studio runs on a VPS: `ws://localhost:18789` means Gateway on the VPS.

   - A “Where settings are stored” section:

       - Upstream URL/token are stored on the Studio host in `<state dir>/openclaw-studio/settings.json`.
       - `<state dir>` defaults to `~/.openclaw` and can be overridden by `OPENCLAW_STATE_DIR`.
       - Studio UI reads/writes these via `GET/PUT /api/studio` (`src/app/api/studio/route.ts` + `src/lib/studio/settings-store.ts`).
       - The Node WS proxy reads upstream settings via `server/studio-settings.js`, not from the browser.

   - A “Recipes” section with explicit numbered steps and commands. Recipes must include:

       A) Studio local + Gateway remote:
          - Option 1: Direct port (only if you intentionally expose it): set Gateway URL to `ws://<gateway-host>:18789`.
          - Option 2: Tailscale Serve for the gateway: serve HTTPS to the gateway and use `wss://...` as the upstream URL.
          - Option 3: SSH tunnel: `ssh -L 18789:127.0.0.1:18789 user@<gateway-host>` and then use `ws://localhost:18789`.

       B) Studio + Gateway on VPS (tailnet access):
          - Run Gateway bound to loopback on the VPS.
          - Expose Studio via Tailscale Serve on 443 (preferred).
          - Configure Studio upstream URL as `ws://localhost:18789`.
          - Add a strong warning that `tailscale serve reset` is destructive; show safer alternatives first (check `tailscale serve status`, pick an unused port, or remove only the relevant serve rule).
          - Explicitly note that exposing the gateway is optional in this topology.

       C) Studio remote + Gateway remote:
          - Emphasize that Studio must be able to reach the gateway from the Studio host network.
          - Show that `wss://` is required if the gateway is behind HTTPS.

   - A “Reverse proxy notes” section:
       - Path prefixes like `/studio` require Next.js `basePath` configuration; if not configured, serve at `/`.
       - If Studio is served over `https://`, the browser-side bridge is `wss://<studio-host>/api/gateway/ws` (computed by `src/lib/gateway/proxy-url.ts`). The upstream can still be `ws://...` because it is dialed server-side by Studio, but recommend `wss://...` for remote gateways to avoid sending tokens over plaintext.

   - A “Troubleshooting” section that maps common symptoms to the actual error codes emitted by the proxy and the likely fix:

       - `studio.gateway_url_missing`: upstream URL not configured on the Studio host (check `/api/studio` settings; check `<state dir>/openclaw-studio/settings.json`).
       - `studio.gateway_token_missing`: token missing on the Studio host (same as above; check `<state dir>/openclaw.json` fallback rules in `server/studio-settings.js`).
       - `studio.gateway_url_invalid`: upstream URL is not parseable (must be `ws://...` or `wss://...`).
       - `studio.settings_load_failed`: Studio host could not read settings from disk (permissions / invalid JSON).
       - `studio.upstream_error`: Node could not establish the upstream WebSocket (common: TLS mismatch or network reachability).
       - `studio.upstream_closed`: upstream closed the connection; include the close code and reason.

     Also include:

       - “EPROTO / wrong version number”: you used `wss://` to a non-TLS endpoint (use `ws://` or put it behind TLS).
       - “Assets 404 / blank page under /studio”: Next.js `basePath` not configured (serve at `/` or configure `next.config.ts` and rebuild).
       - “401 Studio access token required”: `STUDIO_ACCESS_TOKEN` access gate is enabled; visit `/?access_token=...` once to set the cookie (see `server/access-gate.js`).

2. Update `README.md`:

   - Keep “Quick start” and add a short link: “For VPS/Tailscale/SSH setups and troubleshooting, see `docs/remote-access.md`.”
   - Ensure the connection model in `README.md` matches the actual implementation (browser connects to `/api/gateway/ws`, Studio dials upstream).
   - Remove or reword any sentences that claim the browser connects directly to the upstream Gateway URL.
   - Ensure any Tailscale Serve examples are “safe by default” (do not lead with `tailscale serve reset`; if included, label as destructive and optional).

3. Add a short security note (docs-only, no code changes) describing Studio’s optional access gate:

   - Mention env var `STUDIO_ACCESS_TOKEN` (see `server/access-gate.js`).
   - Explain how a user sets it and the one-time `/?access_token=...` flow to set the cookie.
   - Make it clear this is optional and mainly for deployments that are reachable outside a tailnet.

4. Update `ARCHITECTURE.md` to match reality:

   - In the configuration section that mentions `STUDIO_UPSTREAM_GATEWAY_URL`/`STUDIO_UPSTREAM_GATEWAY_TOKEN`, either remove the claim or implement it. This ExecPlan is docs-focused, so the default action is to remove/clarify the claim unless code is added elsewhere to support it.

5. (Optional) Add a tiny “Troubleshooting” section in `README.md` that points to `docs/remote-access.md#troubleshooting` rather than duplicating content.

## Validation and Acceptance

Acceptance criteria (human-verifiable):

1. A new reader can answer these correctly after reading `README.md` and `docs/remote-access.md`:
   - “Does my browser connect directly to the upstream Gateway?” (Answer: no; it connects to Studio’s `/api/gateway/ws`.)
   - “If I browse Studio from my phone, what does `ws://localhost:18789` refer to?” (Answer: the Studio host.)
2. The docs include at least two complete, “copy/paste-able” recipes that work without hidden assumptions:
   - “Studio local, Gateway remote via SSH tunnel” recipe.
   - “Studio+Gateway on VPS via Tailscale Serve exposing only Studio” recipe.
3. The troubleshooting section includes explicit guidance for:
   - TLS `EPROTO` / “wrong version number” (root cause: using `wss://` to a non-TLS endpoint).
   - Assets 404 / blank page when reverse-proxying under `/studio` (root cause: missing `basePath`).
   - Token missing errors (root cause: token not configured on Studio host; settings file location; error code `studio.gateway_token_missing`).
4. Repo quality gates still pass:
   - From repo root: `npm test`, `npm run lint`, `npm run typecheck`.

If testing the actual VPS/Tailscale path is not feasible in CI, verification is “follow the recipe” and ensure the docs describe what success looks like (what URL to open, what UI state indicates connection success, and what to do if it fails).

## Idempotence and Recovery

Doc changes are safe to apply repeatedly.

Any instructions that modify a user’s Tailscale Serve configuration must be written to be safe by default:

- Prefer “inspect current state” (`tailscale serve status`) before changing anything.
- If mentioning `tailscale serve reset`, it must be clearly labeled as destructive and optional, and the doc must provide safer alternatives first.

## Artifacts and Notes

When implementing, include in the PR description:

- A short excerpt of the new connection diagram.
- Links to the new doc sections (recipes and troubleshooting).
- A brief note explaining the corrected mental model (browser -> Studio bridge -> Gateway).

## Interfaces and Dependencies

No new runtime dependencies are required. This is a documentation-only change (plus optional README refactor). If an optional doc diagram uses Mermaid, it must be supported by GitHub Markdown rendering (it is) and must remain readable as plain text if Mermaid is not rendered.

## Revision Note (2026-02-15 / Codex)

Rewrote this ExecPlan to be more code-grounded and executable by:

- Adding the missing settings API + settings-store files (`src/app/api/studio/route.ts`, `src/lib/studio/settings-store.ts`, `src/lib/studio/settings.ts`) that actually own persistence and normalization.
- Adding concrete troubleshooting mappings for the exact proxy error codes emitted by `server/gateway-proxy.js` and referenced by retry logic in `src/lib/gateway/GatewayClient.ts`.
- Flagging and planning to fix a docs/code mismatch in `ARCHITECTURE.md` (claimed `STUDIO_UPSTREAM_GATEWAY_URL`/`STUDIO_UPSTREAM_GATEWAY_TOKEN` overrides are not implemented in the current codebase).
- Making the Tailscale guidance “safe by default” by explicitly requiring non-destructive first steps and labeling `tailscale serve reset` as optional/destructive.
