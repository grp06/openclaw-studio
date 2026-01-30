export const generateAgentId = ({ tileId }: { tileId: string }): string => {
  const trimmed = tileId.trim();
  if (!trimmed) {
    throw new Error("Tile id is required to generate an agent id.");
  }
  return `agent-${trimmed}`;
};
