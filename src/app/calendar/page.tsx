"use client";

import { useGatewayConnectionContext } from "@/lib/gateway/GatewayConnectionContext";
import { useCalendar } from "@/features/calendar/useCalendar";
import { WeeklyGrid } from "@/features/calendar/components/WeeklyGrid";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatShortDate } from "@/lib/datetime/format";

export default function CalendarPage() {
  const { client, status } = useGatewayConnectionContext();
  const {
    weekStart,
    days,
    jobs,
    loading,
    error,
    goToPrevWeek,
    goToNextWeek,
    goToThisWeek,
    runJob,
    deleteJob,
  } = useCalendar(status === "connected" ? client : null);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <header className="px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-zinc-100">Calendar</h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              Cron job schedule • {jobs.length} job{jobs.length !== 1 ? "s" : ""}
              {status !== "connected" && (
                <span className="ml-2 text-yellow-500">• Disconnected</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={goToPrevWeek}
              className="p-1 text-zinc-400 hover:text-zinc-200 transition-colors"
              aria-label="Previous week"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={goToThisWeek}
              className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
            >
              Today
            </button>
            <button
              onClick={goToNextWeek}
              className="p-1 text-zinc-400 hover:text-zinc-200 transition-colors"
              aria-label="Next week"
            >
              <ChevronRight size={18} />
            </button>
            <span className="text-sm text-zinc-300 ml-2">
              {formatShortDate(weekStart.getTime())} – {formatShortDate(weekEnd.getTime())}
            </span>
          </div>
        </div>
      </header>

      {error && (
        <div className="px-4 py-2 bg-red-950/50 border-b border-red-900 text-red-400 text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center flex-1 text-zinc-500 text-sm">
          Loading cron jobs…
        </div>
      ) : (
        <WeeklyGrid days={days} onRunJob={runJob} onDeleteJob={deleteJob} />
      )}
    </div>
  );
}
