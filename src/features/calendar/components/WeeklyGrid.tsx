"use client";

import type { CalendarDay, CalendarSlot } from "../types";
import { formatDayHeader, formatTime } from "@/lib/datetime/format";
import { Play, Trash2 } from "lucide-react";

type SlotCardProps = {
  slot: CalendarSlot;
  onRun: (jobId: string) => void;
  onDelete: (jobId: string) => void;
};

function SlotCard({ slot, onRun, onDelete }: SlotCardProps) {
  return (
    <div
      className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs mb-1 group"
      data-testid="calendar-slot"
    >
      <div className="flex items-center justify-between">
        <span className="text-zinc-300 truncate">{slot.label}</span>
        <span className="text-zinc-500 shrink-0 ml-2">
          {formatTime(slot.startMs)}
        </span>
      </div>
      <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onRun(slot.job.id)}
          className="text-green-400 hover:text-green-300 p-0.5"
          title="Run now"
          aria-label={`Run ${slot.label}`}
          data-testid="calendar-run-job"
        >
          <Play size={12} />
        </button>
        <button
          onClick={() => onDelete(slot.job.id)}
          className="text-red-400 hover:text-red-300 p-0.5"
          title="Delete"
          aria-label={`Delete ${slot.label}`}
          data-testid="calendar-delete-job"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

type WeeklyGridProps = {
  days: CalendarDay[];
  onRunJob: (jobId: string) => void;
  onDeleteJob: (jobId: string) => void;
};

export function WeeklyGrid({ days, onRunJob, onDeleteJob }: WeeklyGridProps) {
  return (
    <div
      className="grid grid-cols-7 gap-px bg-zinc-800 flex-1 overflow-auto"
      data-testid="calendar-grid"
    >
      {days.map((day) => (
        <div
          key={day.date.toISOString()}
          className="bg-zinc-950 p-2 min-h-[200px]"
          data-testid="calendar-day"
        >
          <div className="text-xs font-medium text-zinc-400 mb-2 sticky top-0 bg-zinc-950 pb-1">
            {formatDayHeader(day.date)}
          </div>
          <div>
            {day.slots.length === 0 ? (
              <div className="text-xs text-zinc-600 text-center mt-4">—</div>
            ) : (
              day.slots.map((slot, i) => (
                <SlotCard
                  key={`${slot.job.id}-${slot.startMs}-${i}`}
                  slot={slot}
                  onRun={onRunJob}
                  onDelete={onDeleteJob}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
