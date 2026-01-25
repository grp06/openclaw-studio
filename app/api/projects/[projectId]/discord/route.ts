import { NextResponse } from "next/server";

import { createDiscordChannelForAgent } from "../../../../../src/lib/discord/discordChannel";
import { loadStore } from "../../store";

export const runtime = "nodejs";

type DiscordChannelRequest = {
  guildId?: string;
  agentId: string;
  agentName: string;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const trimmedProjectId = projectId.trim();
    if (!trimmedProjectId) {
      return NextResponse.json({ error: "Project id is required." }, { status: 400 });
    }
    const body = (await request.json()) as DiscordChannelRequest;
    const guildId = typeof body?.guildId === "string" ? body.guildId.trim() : undefined;
    const agentId = typeof body?.agentId === "string" ? body.agentId.trim() : "";
    const agentName = typeof body?.agentName === "string" ? body.agentName.trim() : "";
    if (!agentId || !agentName) {
      return NextResponse.json(
        { error: "Agent id and name are required." },
        { status: 400 }
      );
    }

    const store = loadStore();
    const project = store.projects.find((entry) => entry.id === trimmedProjectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const result = await createDiscordChannelForAgent({
      agentId,
      agentName,
      guildId: guildId || undefined,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create Discord channel.";
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
