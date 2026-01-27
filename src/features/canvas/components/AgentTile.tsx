import type React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentTile as AgentTileType, TilePosition, TileSize } from "@/features/canvas/state/store";
import { isTraceMarkdown, stripTraceMarkdown } from "@/lib/text/extractThinking";

const MIN_SIZE = { width: 560, height: 440 };

const clampSize = (size: TileSize): TileSize => ({
  width: Math.max(MIN_SIZE.width, size.width),
  height: Math.max(MIN_SIZE.height, size.height),
});

type AgentTileProps = {
  tile: AgentTileType;
  zoom: number;
  isSelected: boolean;
  canSend: boolean;
  onSelect: () => void;
  onMove: (position: TilePosition) => void;
  onResize: (size: TileSize) => void;
  onDelete: () => void;
  onNameChange: (name: string) => Promise<boolean>;
  onDraftChange: (value: string) => void;
  onSend: (message: string) => void;
  onModelChange: (value: string | null) => void;
  onThinkingChange: (value: string | null) => void;
};

export const AgentTile = ({
  tile,
  zoom,
  isSelected,
  canSend,
  onSelect,
  onMove,
  onResize,
  onDelete,
  onNameChange,
  onDraftChange,
  onSend,
  onModelChange,
  onThinkingChange,
}: AgentTileProps) => {
  const [nameDraft, setNameDraft] = useState(tile.name);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const scrollOutputToBottom = useCallback(() => {
    const el = outputRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(scrollOutputToBottom);
    return () => cancelAnimationFrame(raf);
  }, [scrollOutputToBottom, tile.outputLines, tile.streamText]);

  const handleDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    onSelect();
    if (event.button !== 0) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const origin = tile.position;

    const handleMove = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - startX) / zoom;
      const dy = (moveEvent.clientY - startY) / zoom;
      onMove({ x: origin.x + dx, y: origin.y + dy });
    };

    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const commitName = async () => {
    const next = nameDraft.trim();
    if (!next) {
      setNameDraft(tile.name);
      return;
    }
    if (next === tile.name) {
      return;
    }
    const ok = await onNameChange(next);
    if (!ok) {
      setNameDraft(tile.name);
    }
  };

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    onSelect();
    if (event.button !== 0) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const origin = tile.size;

    const handleMove = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - startX) / zoom;
      const dy = (moveEvent.clientY - startY) / zoom;
      onResize(clampSize({ width: origin.width + dx, height: origin.height + dy }));
    };

    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const statusColor =
    tile.status === "running"
      ? "bg-amber-200 text-amber-900"
      : tile.status === "error"
        ? "bg-rose-200 text-rose-900"
        : "bg-emerald-200 text-emerald-900";
  const showThinking = tile.status === "running" && Boolean(tile.thinkingTrace);

  return (
    <div
      data-tile
      className={`absolute flex flex-col overflow-hidden rounded-3xl border bg-white/80 shadow-xl backdrop-blur transition ${
        isSelected ? "border-slate-500" : "border-slate-200"
      }`}
      style={{
        left: tile.position.x,
        top: tile.position.y,
        width: tile.size.width,
        height: tile.size.height,
      }}
      onPointerDown={onSelect}
    >
      <div
        className="flex cursor-grab items-center justify-between gap-2 border-b border-slate-200 px-4 py-2"
        onPointerDown={handleDragStart}
      >
        <input
          className="w-full bg-transparent text-sm font-semibold text-slate-900 outline-none"
          value={nameDraft}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={() => {
            void commitName();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              setNameDraft(tile.name);
              event.currentTarget.blur();
            }
          }}
        />
        <span
          className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusColor}`}
        >
          {tile.status}
        </span>
        <button
          className="rounded-full border border-slate-300 px-2 py-1 text-[10px] font-semibold text-slate-600"
          type="button"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-4 py-3">
        <div
          ref={outputRef}
          className="flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white/60 p-3 text-xs text-slate-700"
        >
          {tile.outputLines.length === 0 && !tile.streamText && !showThinking ? (
            <p className="text-slate-500">No output yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {showThinking ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800">
                  <div className="agent-markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {tile.thinkingTrace}
                    </ReactMarkdown>
                  </div>
                </div>
              ) : null}
              {tile.outputLines.map((line, index) => (
                isTraceMarkdown(line) ? (
                  <details
                    key={`${tile.id}-line-${index}`}
                    className="rounded-xl border border-slate-200 bg-white/80 px-2 py-1 text-[11px] text-slate-600"
                  >
                    <summary className="cursor-pointer select-none font-semibold">
                      Trace
                    </summary>
                    <div className="agent-markdown mt-1 text-slate-700">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {stripTraceMarkdown(line)}
                      </ReactMarkdown>
                    </div>
                  </details>
                ) : (
                  <div key={`${tile.id}-line-${index}`} className="agent-markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{line}</ReactMarkdown>
                  </div>
                )
              ))}
              {tile.streamText ? (
                <div className="agent-markdown text-slate-500">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {tile.streamText}
                  </ReactMarkdown>
                </div>
              ) : null}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-slate-500">
          <label className="flex items-center gap-2">
            Model
            <select
              className="h-7 rounded-full border border-slate-200 bg-white/80 px-2 text-[11px] font-semibold text-slate-700"
              value={tile.model ?? ""}
              onChange={(event) => {
                const value = event.target.value.trim();
                onModelChange(value ? value : null);
              }}
            >
              <option value="openai-codex/gpt-5.2-codex">GPT-5.2 Codex</option>
              <option value="xai/grok-4-1-fast-reasoning">grok-4-1-fast-reasoning</option>
              <option value="xai/grok-4-1-fast-non-reasoning">
                grok-4-1-fast-non-reasoning
              </option>
              <option value="zai/glm-4.7">glm-4.7</option>
            </select>
          </label>
          {tile.model === "xai/grok-4-1-fast-non-reasoning" ? null : (
            <label className="flex items-center gap-2">
              Thinking
              <select
                className="h-7 rounded-full border border-slate-200 bg-white/80 px-2 text-[11px] font-semibold text-slate-700"
                value={tile.thinkingLevel ?? ""}
                onChange={(event) => {
                  const value = event.target.value.trim();
                  onThinkingChange(value ? value : null);
                }}
              >
                <option value="">Default</option>
                <option value="off">Off</option>
                <option value="minimal">Minimal</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="xhigh">XHigh</option>
              </select>
            </label>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            className="h-9 flex-1 rounded-full border border-slate-200 bg-white/80 px-3 text-xs text-slate-900 outline-none"
            value={tile.draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              if (!isSelected) return;
              if (!canSend || tile.status === "running") return;
              const message = tile.draft.trim();
              if (!message) return;
              event.preventDefault();
              onSend(message);
            }}
            placeholder="Send a command"
          />
          <button
            className="rounded-full bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
            type="button"
            onClick={() => onSend(tile.draft)}
            disabled={!canSend || tile.status === "running" || !tile.draft.trim()}
          >
            Send
          </button>
        </div>
      </div>
      <div
        className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
        onPointerDown={handleResizeStart}
      />
      <div
        className="absolute bottom-0 left-0 h-4 w-4 cursor-sw-resize"
        onPointerDown={handleResizeStart}
      />
      <div
        className="absolute top-0 right-0 h-4 w-4 cursor-ne-resize"
        onPointerDown={handleResizeStart}
      />
      <div
        className="absolute top-0 left-0 h-4 w-4 cursor-nw-resize"
        onPointerDown={handleResizeStart}
      />
    </div>
  );
};
