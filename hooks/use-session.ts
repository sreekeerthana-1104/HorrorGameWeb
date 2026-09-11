"use client";

import { useCallback, useEffect, useState } from "react";

// Visual weight only — reuses the existing timeline dot styles (accent/warning/neutral/active).
export type SessionEventKind = "accent" | "warning" | "neutral" | "active";
export type SessionEvent = { time: string; title: string; detail?: string; kind: SessionEventKind };

const pad = (value: number) => String(value).padStart(2, "0");
const MAX_EVENTS = 24;

export function useSession() {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  const [ended, setEnded] = useState(false);
  const [events, setEvents] = useState<SessionEvent[]>([]);

  useEffect(() => {
    if (paused || ended) return;
    const timer = window.setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [paused, ended]);

  const elapsed = `${pad(Math.floor(elapsedSeconds / 60))}:${pad(elapsedSeconds % 60)}`;

  // Real system events only — connections, calibration, and actual triggers.
  // Newest first, capped so the log can't grow unbounded across a long session.
  const logEvent = useCallback((title: string, detail?: string, kind: SessionEventKind = "neutral") => {
    const time = new Date().toLocaleTimeString([], { hour12: false });
    setEvents((prev) => [{ time, title, detail, kind }, ...prev].slice(0, MAX_EVENTS));
  }, []);

  return {
    elapsed,
    paused,
    ended,
    events,
    pause: () => setPaused((p) => !p),
    endSession: () => { setEnded(true); setPaused(true); },
    logEvent,
  };
}
