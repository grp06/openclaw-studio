import { fetchJson } from "@/lib/http";
import type { SkillRemoveRequest, SkillRemoveResult } from "@/lib/skills/types";

const normalizeRequired = (value: string, field: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} is required.`);
  }
  return trimmed;
};

export const removeSkillFromGateway = async (
  request: SkillRemoveRequest
): Promise<SkillRemoveResult> => {
  const payload: SkillRemoveRequest = {
    skillKey: normalizeRequired(request.skillKey, "skillKey"),
    source: request.source,
    baseDir: normalizeRequired(request.baseDir, "baseDir"),
    workspaceDir: normalizeRequired(request.workspaceDir, "workspaceDir"),
    managedSkillsDir: normalizeRequired(request.managedSkillsDir, "managedSkillsDir"),
  };

  const response = await fetchJson<{ result: SkillRemoveResult }>("/api/intents/skills-remove", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.result;
};
