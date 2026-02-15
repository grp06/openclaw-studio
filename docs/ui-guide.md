# Studio UI Guide

This doc covers common UI workflows after you are connected to a gateway.

## Cron jobs in Agent Settings

- Open an agent and go to **Settings -> Cron jobs**.
- If no jobs exist, use the empty-state **Create** button.
- If jobs already exist, use the header **Create** button.
- The modal is agent-scoped and walks through template selection, task text, schedule, and review.
- Submitting creates the job via gateway `cron.add` and refreshes that same agent's cron list.

## Agent creation workflow

- Click **New Agent** in the fleet sidebar.
- Pick a **Preset bundle** (for example Research Analyst, PR Engineer, Autonomous Engineer, Growth Operator, Coordinator, or Blank).
- Each preset card shows capability chips and risk level (`Exec`, `Internet`, `File tools`, `Sandbox`, `Heartbeat`, plus caveats when relevant).
- Optionally override the **Control level** (Conservative, Balanced, or Autopilot).
- Add optional customization (agent name, first task, notes, and advanced control toggles).
- Review the behavior summary, then create.

## Exec approvals in chat

- When a run requires exec approval, chat shows an **Exec approval required** card with:
  - command preview
  - host and cwd
  - expiration timestamp
- Resolve directly in chat with:
  - **Allow once**
  - **Always allow**
  - **Deny**
- The fleet row displays **Needs approval** while approvals are pending for that agent.
- Expired approvals are pruned automatically, so stale cards and stale **Needs approval** badges clear without a manual resolve event.

