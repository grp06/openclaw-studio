import { redirect } from "next/navigation";

import { buildSettingsRouteHref } from "@/features/agents/operations/settingsRouteWorkflow";

export default async function AgentSettingsPage({
  params,
}: {
  params: Promise<{ agentId?: string }> | { agentId?: string };
}) {
  const resolvedParams = await params;
  const agentId = (resolvedParams?.agentId ?? "").trim();
  if (!agentId) {
    redirect("/");
  }
  redirect(buildSettingsRouteHref(agentId));
}
