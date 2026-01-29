"use client";

import { type Node, type NodeProps } from "@xyflow/react";
import type { AgentTile as AgentTileType, TileSize } from "@/features/canvas/state/store";
import { AgentTile } from "./AgentTile";

export type AgentTileNodeData = {
  tile: AgentTileType;
  projectId: string | null;
  canSend: boolean;
  onResize: (size: TileSize) => void;
  onDelete: () => void;
  onNameChange: (name: string) => Promise<boolean>;
  onDraftChange: (value: string) => void;
  onSend: (message: string) => void;
  onModelChange: (value: string | null) => void;
  onThinkingChange: (value: string | null) => void;
  onAvatarShuffle: () => void;
  onNameShuffle: () => void;
  onResizeEnd?: (size: TileSize) => void;
};

type AgentTileNodeType = Node<AgentTileNodeData>;

export const AgentTileNode = ({ data, selected }: NodeProps<AgentTileNodeType>) => {
  const {
    tile,
    projectId,
    canSend,
    onResize,
    onDelete,
    onNameChange,
    onDraftChange,
    onSend,
    onModelChange,
    onThinkingChange,
    onAvatarShuffle,
    onNameShuffle,
    onResizeEnd,
  } = data;

  return (
    <div className="h-full w-full">
      <AgentTile
        tile={tile}
        projectId={projectId}
        isSelected={selected}
        canSend={canSend}
        onDelete={onDelete}
        onNameChange={onNameChange}
        onDraftChange={onDraftChange}
        onSend={onSend}
        onModelChange={onModelChange}
        onThinkingChange={onThinkingChange}
        onAvatarShuffle={onAvatarShuffle}
        onNameShuffle={onNameShuffle}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />
    </div>
  );
};
