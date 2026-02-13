import type { AgentFileName } from "@/lib/agents/agentFiles";
import {
  createGatewayAgent,
  type GatewayAgentOverrides,
  updateGatewayAgentOverrides,
} from "@/lib/gateway/agentConfig";
import {
  upsertGatewayAgentExecApprovals,
  type GatewayExecApprovalAsk,
  type GatewayExecApprovalSecurity,
} from "@/lib/gateway/execApprovals";
import { writeGatewayAgentFiles } from "@/lib/gateway/agentFiles";
import type { GatewayClient } from "@/lib/gateway/GatewayClient";

export type AgentGuidedSetup = {
  agentOverrides: GatewayAgentOverrides;
  files: Partial<Record<AgentFileName, string>>;
  execApprovals:
    | {
        security: GatewayExecApprovalSecurity;
        ask: GatewayExecApprovalAsk;
        allowlist: Array<{ pattern: string }>;
      }
    | null;
};

export const applyGuidedAgentSetup = async (params: {
  client: GatewayClient;
  agentId: string;
  setup: AgentGuidedSetup;
  includeAgentOverrides?: boolean;
}): Promise<void> => {
  const agentId = params.agentId.trim();
  if (!agentId) {
    throw new Error("Agent id is required.");
  }
  await writeGatewayAgentFiles({
    client: params.client,
    agentId,
    files: params.setup.files,
  });
  await upsertGatewayAgentExecApprovals({
    client: params.client,
    agentId,
    policy: params.setup.execApprovals,
  });
  if (params.includeAgentOverrides !== false) {
    await updateGatewayAgentOverrides({
      client: params.client,
      agentId,
      overrides: params.setup.agentOverrides,
    });
  }
};

export const createAgentWithOptionalSetup = async (params: {
  client: GatewayClient;
  name: string;
  setup: AgentGuidedSetup | null;
  isLocalGateway: boolean;
}): Promise<{
  agentId: string;
  setupApplied: boolean;
  awaitingRestart: boolean;
}> => {
  const created = await createGatewayAgent({
    client: params.client,
    name: params.name,
  });
  if (params.isLocalGateway) {
    if (params.setup) {
      await applyGuidedAgentSetup({
        client: params.client,
        agentId: created.id,
        setup: params.setup,
      });
    }
    return {
      agentId: created.id,
      setupApplied: Boolean(params.setup),
      awaitingRestart: false,
    };
  }
  return {
    agentId: created.id,
    setupApplied: false,
    awaitingRestart: true,
  };
};
