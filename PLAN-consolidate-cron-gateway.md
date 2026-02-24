# Plan: Consolidate Studio Cron Page to Use Gateway API

**Status**: Completed
**Tool**: Claude Code
**Created**: 2026-02-23
**Last Updated**: 2026-02-23

## Overview
Rewrote the Studio cron page (`/cron`) and CronWidget to use the OpenClaw gateway WebSocket RPC instead of a file-based API route. One source of truth, no duplication.

## Tasks

### Phase 1: Rewrite cron page to use GatewayClient
- [x] Rewrite `src/app/cron/page.tsx` as a client component that uses `GatewayClient`

### Phase 2: Rewrite CronWidget to use GatewayClient
- [x] Rewrite `src/components/CronWidget.tsx` to accept `client` and `gwStatus` props

### Phase 3: Clean up
- [x] Delete `src/app/api/cron/route.ts` (file-based CRUD route)
- [ ] Remove the two manually-added jobs from `~/.openclaw/cron/jobs.json`
- [ ] Re-add the LinkedIn post and health check jobs via the gateway

## Files Affected
- `src/lib/cron/types.ts` - Added `updateCronJob()` function and `outputDir` to `CronJobSummary`
- `src/app/cron/page.tsx` - Rewrote to use GatewayClient via `useGatewayConnection` hook
- `src/components/CronWidget.tsx` - Changed from self-contained to props-based (`client`, `gwStatus`)
- `src/app/page.tsx` - Updated CronWidget usage to pass `client` and `gwStatus` props
- `src/app/api/cron/route.ts` - Deleted (file-based CRUD replaced by gateway RPC)

## Implementation Notes
- Cron page creates its own `StudioSettingsCoordinator` and `useGatewayConnection` (same pattern as main page)
- CronWidget receives the existing gateway client from its parent (main page) via props
- Added gateway connection status badge (connected/connecting/disconnected) to cron page header
- Added reconnect button when gateway is disconnected
- Reports viewer still uses `/api/cron/reports` (file-based, as planned)
- Used `agentId: 'studio'` for jobs created from the cron page (gateway requires agentId)
- Added `outputDir?: string` to `CronJobSummary` type since gateway returns it from jobs.json

## Completion Summary
**Completed on**: 2026-02-23
**Completed by**: Claude Code

All code changes implemented and verified. TypeScript and Next.js build both pass cleanly. Manual Phase 3 tasks (removing old jobs, re-adding via gateway) are left for the user to do through the UI.
