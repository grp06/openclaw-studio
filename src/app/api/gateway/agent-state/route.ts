import { NextResponse } from "next/server";

import { resolveGatewaySshTargetFromGatewayUrl, runSshJson } from "@/lib/ssh/gateway-host";
import { loadStudioSettings } from "@/lib/studio/settings-store";

export const runtime = "nodejs";

type TrashAgentStateRequest = {
  agentId: string;
};

type RestoreAgentStateRequest = {
  agentId: string;
  trashDir: string;
};

const isSafeAgentId = (value: string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);

const TRASH_SCRIPT = `
set -euo pipefail

python3 - "$1" <<'PY'
import datetime
import json
import os
import pathlib
import re
import shutil
import sys
import uuid

agent_id = sys.argv[1].strip()
if not agent_id:
  raise SystemExit("agentId is required.")
if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}", agent_id):
  raise SystemExit(f"Invalid agentId: {agent_id}")

base = pathlib.Path.home() / ".openclaw"
trash_root = base / "trash" / "studio-delete-agent"
stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
trash_dir = trash_root / f"{stamp}-{agent_id}-{uuid.uuid4()}"
(trash_dir / "agents").mkdir(parents=True, exist_ok=True)
(trash_dir / "workspaces").mkdir(parents=True, exist_ok=True)

moves = []

def move_if_exists(src: pathlib.Path, dest: pathlib.Path):
  if not src.exists():
    return
  dest.parent.mkdir(parents=True, exist_ok=True)
  shutil.move(str(src), str(dest))
  moves.append({"from": str(src), "to": str(dest)})

move_if_exists(base / f"workspace-{agent_id}", trash_dir / "workspaces" / f"workspace-{agent_id}")
move_if_exists(base / "agents" / agent_id, trash_dir / "agents" / agent_id)

print(json.dumps({"trashDir": str(trash_dir), "moved": moves}))
PY
`;

const RESTORE_SCRIPT = `
set -euo pipefail

python3 - "$1" "$2" <<'PY'
import json
import pathlib
import re
import shutil
import sys

agent_id = sys.argv[1].strip()
trash_dir_raw = sys.argv[2].strip()

if not agent_id:
  raise SystemExit("agentId is required.")
if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}", agent_id):
  raise SystemExit(f"Invalid agentId: {agent_id}")
if not trash_dir_raw:
  raise SystemExit("trashDir is required.")

base = pathlib.Path.home() / ".openclaw"
trash_dir = pathlib.Path(trash_dir_raw).expanduser()

try:
  resolved_trash = trash_dir.resolve(strict=True)
except FileNotFoundError:
  raise SystemExit(f"trashDir does not exist: {trash_dir_raw}")

resolved_base = base.resolve(strict=False)
if resolved_base not in resolved_trash.parents:
  raise SystemExit(f"trashDir is not under {base}: {trash_dir_raw}")

moves = []

def restore_if_exists(src: pathlib.Path, dest: pathlib.Path):
  if not src.exists():
    return
  if dest.exists():
    raise SystemExit(f"Refusing to restore over existing path: {dest}")
  dest.parent.mkdir(parents=True, exist_ok=True)
  shutil.move(str(src), str(dest))
  moves.append({"from": str(src), "to": str(dest)})

restore_if_exists(
  resolved_trash / "workspaces" / f"workspace-{agent_id}",
  base / f"workspace-{agent_id}",
)
restore_if_exists(
  resolved_trash / "agents" / agent_id,
  base / "agents" / agent_id,
)

print(json.dumps({"restored": moves}))
PY
`;

const resolveAgentStateSshTarget = (): string => {
  const settings = loadStudioSettings();
  return resolveGatewaySshTargetFromGatewayUrl(settings.gateway?.url ?? "", process.env);
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
    }
    const { agentId } = body as Partial<TrashAgentStateRequest>;
    const trimmed = typeof agentId === "string" ? agentId.trim() : "";
    if (!trimmed) {
      return NextResponse.json({ error: "agentId is required." }, { status: 400 });
    }
    if (!isSafeAgentId(trimmed)) {
      return NextResponse.json({ error: `Invalid agentId: ${trimmed}` }, { status: 400 });
    }

    const sshTarget = resolveAgentStateSshTarget();
    const result = runSshJson({
      sshTarget,
      argv: ["bash", "-s", "--", trimmed],
      input: TRASH_SCRIPT,
      label: `trash agent state (${trimmed})`,
    });
    return NextResponse.json({ result });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to trash agent workspace/state.";
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
    }
    const { agentId, trashDir } = body as Partial<RestoreAgentStateRequest>;
    const trimmedAgent = typeof agentId === "string" ? agentId.trim() : "";
    const trimmedTrash = typeof trashDir === "string" ? trashDir.trim() : "";
    if (!trimmedAgent) {
      return NextResponse.json({ error: "agentId is required." }, { status: 400 });
    }
    if (!trimmedTrash) {
      return NextResponse.json({ error: "trashDir is required." }, { status: 400 });
    }
    if (!isSafeAgentId(trimmedAgent)) {
      return NextResponse.json({ error: `Invalid agentId: ${trimmedAgent}` }, { status: 400 });
    }

    const sshTarget = resolveAgentStateSshTarget();
    const result = runSshJson({
      sshTarget,
      argv: ["bash", "-s", "--", trimmedAgent, trimmedTrash],
      input: RESTORE_SCRIPT,
      label: `restore agent state (${trimmedAgent})`,
    });
    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to restore agent state.";
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
