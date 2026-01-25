import type React from "react";
import { useCallback, useMemo, useRef } from "react";
import type { AgentTile, CanvasTransform, TilePosition, TileSize } from "../state/store";
import { AgentTile as AgentTileComponent } from "./AgentTile";

type CanvasViewportProps = {
  tiles: AgentTile[];
  transform: CanvasTransform;
  selectedTileId: string | null;
  canSend: boolean;
  onSelectTile: (id: string | null) => void;
  onMoveTile: (id: string, position: TilePosition) => void;
  onResizeTile: (id: string, size: TileSize) => void;
  onDeleteTile: (id: string) => void;
  onRenameTile: (id: string, name: string) => Promise<boolean>;
  onDraftChange: (id: string, value: string) => void;
  onSend: (id: string, sessionKey: string, message: string) => void;
  onModelChange: (id: string, sessionKey: string, value: string | null) => void;
  onThinkingChange: (id: string, sessionKey: string, value: string | null) => void;
  onUpdateTransform: (patch: Partial<CanvasTransform>) => void;
};

export const CanvasViewport = ({
  tiles,
  transform,
  selectedTileId,
  canSend,
  onSelectTile,
  onMoveTile,
  onResizeTile,
  onDeleteTile,
  onRenameTile,
  onDraftChange,
  onSend,
  onModelChange,
  onThinkingChange,
  onUpdateTransform,
}: CanvasViewportProps) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panState = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    active: boolean;
  }>({ startX: 0, startY: 0, originX: 0, originY: 0, active: false });

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-tile]")) {
        return;
      }
      onSelectTile(null);
      panState.current = {
        startX: event.clientX,
        startY: event.clientY,
        originX: transform.offsetX,
        originY: transform.offsetY,
        active: true,
      };
      const handleMove = (moveEvent: PointerEvent) => {
        if (!panState.current.active) return;
        const dx = moveEvent.clientX - panState.current.startX;
        const dy = moveEvent.clientY - panState.current.startY;
        onUpdateTransform({
          offsetX: panState.current.originX + dx,
          offsetY: panState.current.originY + dy,
        });
      };
      const handleUp = () => {
        panState.current.active = false;
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [onSelectTile, onUpdateTransform, transform.offsetX, transform.offsetY]
  );

  const scaledStyle = useMemo(() => {
    return {
      transform: `translate(${transform.offsetX}px, ${transform.offsetY}px) scale(${transform.zoom})`,
      transformOrigin: "0 0",
    } as const;
  }, [transform.offsetX, transform.offsetY, transform.zoom]);

  return (
    <div
      ref={viewportRef}
      className="canvas-surface relative h-full w-full overflow-hidden"
      onPointerDown={handlePointerDown}
    >
      <div className="absolute inset-0" style={scaledStyle}>
        {tiles.map((tile) => (
          <AgentTileComponent
            key={`${tile.id}-${tile.name}`}
            tile={tile}
            zoom={transform.zoom}
            isSelected={tile.id === selectedTileId}
            canSend={canSend}
            onSelect={() => onSelectTile(tile.id)}
            onMove={(position) => onMoveTile(tile.id, position)}
            onResize={(size) => onResizeTile(tile.id, size)}
            onDelete={() => onDeleteTile(tile.id)}
            onNameChange={(name) => onRenameTile(tile.id, name)}
            onDraftChange={(value) => onDraftChange(tile.id, value)}
            onSend={(message) => onSend(tile.id, tile.sessionKey, message)}
            onModelChange={(value) => onModelChange(tile.id, tile.sessionKey, value)}
            onThinkingChange={(value) => onThinkingChange(tile.id, tile.sessionKey, value)}
          />
        ))}
      </div>
    </div>
  );
};
