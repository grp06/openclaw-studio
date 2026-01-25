const normalizeSegment = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

export const generateAgentId = ({
  projectSlug,
  tileName,
}: {
  projectSlug: string;
  tileName: string;
}): string => {
  const projectSegment = normalizeSegment(projectSlug);
  const tileSegment = normalizeSegment(tileName);
  if (!tileSegment) {
    throw new Error("Agent name produced an empty id.");
  }
  const base = projectSegment ? `proj-${projectSegment}-${tileSegment}` : `proj-${tileSegment}`;
  if (base.length <= 64) {
    return base;
  }
  const suffix = `-${tileSegment}`;
  const maxProjectLength = Math.max(0, 64 - ("proj".length + suffix.length + 1));
  const trimmedProject = projectSegment.slice(0, maxProjectLength);
  const trimmedBase = trimmedProject
    ? `proj-${trimmedProject}-${tileSegment}`
    : `proj-${tileSegment}`;
  if (trimmedBase.length <= 64) {
    return trimmedBase;
  }
  const maxTileLength = Math.max(1, 64 - ("proj".length + 1));
  const trimmedTile = tileSegment.slice(0, maxTileLength);
  return `proj-${trimmedTile}`;
};
