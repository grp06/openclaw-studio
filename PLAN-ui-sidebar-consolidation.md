# Plan: Consolidate Flows UI into Collapsible Sidebar

**Status**: Completed
**Tool**: Claude Code
**Created**: 2026-02-23
**Last Updated**: 2026-02-23

## Overview
Redesigned the Studio UI to consolidate Cron Jobs, Sessions, and Captures (TODOs) from separate widget banners and pages into a unified collapsible sidebar with tabs. Everything is now accessible from the main page without navigation.

## Tasks
- [x] Create FlowsSidebar component with tab structure
- [x] Move cron page content into Cron tab
- [x] Move Sessions and TODOs into sidebar tabs
- [x] Integrate FlowsSidebar into main page
- [x] Delete redundant page routes (/cron, /sessions, /todos)
- [x] Delete old widget components
- [x] Verify build and test UI

## Files Created
- `src/components/FlowsSidebar.tsx` - Main sidebar container with tabs
- `src/components/FlowsSidebar/CronTab.tsx` - Full cron job management UI (from `/cron` page)
- `src/components/FlowsSidebar/SessionsTab.tsx` - Sessions viewer (from SessionsWidget)
- `src/components/FlowsSidebar/TodosTab.tsx` - Captures/TODO manager (from TodosWidget)

## Files Modified
- `src/app/page.tsx` - Added FlowsSidebar integration, removed widget imports, added `flowsSidebarOpen` state

## Files Deleted
- `src/app/cron/page.tsx` - Moved to CronTab component
- `src/app/sessions/page.tsx` - Content was minimal, migrated to SessionsTab
- `src/app/todos/page.tsx` - Content was minimal, migrated to TodosTab
- `src/components/SessionsWidget.tsx` - Replaced by SessionsTab
- `src/components/TodosWidget.tsx` - Replaced by TodosTab
- `src/components/CronWidget.tsx` - Replaced by CronTab

## Design Decisions

### Layout
- **Sidebar width**: 480px (comfortable for form fields)
- **Position**: Fixed, right side, top-14 to bottom-0 (below header)
- **Collapse toggle**: Floating button when closed, icon button in header when open
- **Z-index**: 170 (below modals, above main content)

### Tabs
- **Cron**: Calendar icon - Full CRUD for scheduled jobs
- **Sessions**: Activity icon - Live Claude Code session tracking
- **Captures**: ListTodo icon - Telegram captures + quick add

### Tab Content
- **Cron**: Full management UI with forms, reports viewer, run-now, all actions from old page
- **Sessions**: Real-time activity with paused/active/interrupted/completed states
- **TODOs**: Quick add input + full list with checkboxes and delete actions

### Mobile Considerations
- Sidebar is 480px wide (may need media query for mobile responsiveness in future)
- Toggle button provides easy access to open/close

## Implementation Notes
- Sidebar starts **open** by default (`flowsSidebarOpen: true`)
- Each tab is self-contained with its own polling/data fetching
- CronTab receives `client` and `gwStatus` props from parent for gateway RPC
- SessionsTab and TodosTab use existing API routes (`/api/sessions`, `/api/todos`)
- Reports viewer modal still works within CronTab (unchanged from old page)
- All transitions/animations preserved from original widgets

## API Routes Preserved
- `/api/cron/reports` - File-based report viewer for cron jobs
- `/api/sessions` - Sessions log reader
- `/api/todos` - CAPTURES.md CRUD operations
- `/api/assign` - TODO assignment tracker

## Completion Summary
**Completed on**: 2026-02-23
**Completed by**: Claude Code

Successfully consolidated three widget banners and three separate pages into a single unified sidebar. Users can now access all flows/automation features without leaving the main agent interface. Build passes clean, TypeScript validates, all functionality preserved.
