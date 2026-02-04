# Agent Workspace Notes

This directory intentionally mixes tracked and local-only files.

Tracked in git:
- `PLANS.md`
- `done/`

Local-only:
- `execplan-pending.md`
- `local/` (symlink to machine-private notes)

The `post-checkout` git hook creates `local/` as a symlink to:
- `${OPENCLAW_STUDIO_PRIVATE_AGENT_DIR}` if set
- otherwise `~/.codex/private/openclaw-studio`

Store EC2 credentials, host-specific notes, and other sensitive material under that private path.
