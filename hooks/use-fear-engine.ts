"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { getRelayHttpBase } from "../lib/relay";
import { ensureSignedIn, getSupabase } from "../lib/supabase";

export const TRIGGER_IDS = ["footsteps", "flicker_lights", "play_scream"] as const;
export type TriggerId = (typeof TRIGGER_IDS)[number];
export type ArousalState = "CALM" | "ELEVATED" | "HIGH";
export type CalibrationPhase = "idle" | "collecting" | "done";

type FearSnapshot = {
  calibrated: boolean;
  calibration: { phase: CalibrationPhase; remaining: number; calibrated: boolean };
  usingHeartRate: boolean;
  usingGsr: boolean;
  arousal: number;
  state: ArousalState;
  triggerScores: Record<TriggerId, number>;
  totalFires: number;
  peakArousal: number;
  peakArousalTrigger: TriggerId | null;
};

type FearFireEvent = { type: "fired"; trigger: TriggerId; firedAt: number; arousalAtFire: number; intensity: number };
type FearResolveEvent = { type: "resolved"; trigger: TriggerId; firedAt: number; arousalAtFire: number; intensity: number; responseObserved: boolean; resolvedAt: number };
type FearEvent = FearFireEvent | FearResolveEvent;

const triggerLabel: Record<TriggerId, string> = { footsteps: "Footsteps", flicker_lights: "Flicker lights", play_scream: "Scream" };

// Supabase/Postgrest errors don't always print anything useful from a bare `console.error(x, error)`
// — pull out the fields that actually carry the reason (a missing table, an RLS denial, a bad
// column name all show up in `message`/`code`, not as own-enumerable props Chrome prints nicely).
function logSupabaseError(context: string, error: unknown) {
  const err = error as { message?: string; code?: string; details?: string; hint?: string } | null;
  console.error(`[fear-engine] ${context}:`, {
    message: err?.message ?? String(error),
    code: err?.code,
    details: err?.details,
    hint: err?.hint,
  });
}

// NOTE: table/column names below are inferred from the fear-engine spec text, not verified
// against the live Supabase schema (no DB introspection available here). Treat as a first pass —
// worth a quick check against the real `game_sessions` / `trigger_events` columns before trusting
// this actually persists correctly. All writes are best-effort and never break the live session.
export function useFearEngine(options?: { onEvent?: (title: string, detail?: string, kind?: "accent" | "warning" | "neutral" | "active") => void }) {
  const onEvent = options?.onEvent;
  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<FearSnapshot>({
    calibrated: false,
    calibration: { phase: "idle", remaining: 0, calibrated: false },
    arousal: 0,
    state: "CALM",
    triggerScores: { footsteps: 0.5, flicker_lights: 0.5, play_scream: 0.5 },
    totalFires: 0,
    peakArousal: 0,
    peakArousalTrigger: null,
  });
  const [consentGiven, setConsentGiven] = useState(false);
  const [baselinePending, setBaselinePending] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const gameSessionIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const eventRowsRef = useRef(new Map<string, string>()); // "trigger|firedAt" -> trigger_events row id
  const peakArousalRef = useRef(0);
  const totalFiresRef = useRef(0);
  const peakTriggerRef = useRef<TriggerId | null>(null);

  useEffect(() => {
    const socket = io(getRelayHttpBase(), { transports: ["websocket", "polling"] });
    socketRef.current = socket;
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("fear:state", (next: FearSnapshot) => {
      setSnapshot(next);
      peakArousalRef.current = next.peakArousal;
      totalFiresRef.current = next.totalFires;
      peakTriggerRef.current = next.peakArousalTrigger;
    });
    socket.on("fear:event", (event: FearEvent) => {
      if (event.type === "fired") {
        onEvent?.(`Triggered: ${triggerLabel[event.trigger]}`, `intensity ${event.intensity.toFixed(2)} · arousal ${event.arousalAtFire}`, "warning");
        void logTriggerFired(event);
      } else {
        onEvent?.(
          event.responseObserved ? `${triggerLabel[event.trigger]} landed` : `${triggerLabel[event.trigger]} — no response`,
          undefined,
          event.responseObserved ? "active" : "neutral",
        );
        void logTriggerResolved(event);
      }
    });
    return () => { socket.disconnect(); socketRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logTriggerFired(event: FearFireEvent) {
    const supabase = getSupabase();
    if (!supabase || !gameSessionIdRef.current) return;
    try {
      const { data, error } = await supabase
        .from("trigger_events")
        .insert({
          game_session_id: gameSessionIdRef.current,
          trigger_type: event.trigger,
          fired_at: new Date(event.firedAt).toISOString(),
          intensity: event.intensity,
          arousal_at_fire: event.arousalAtFire,
        })
        .select("id")
        .single();
      if (error) throw error;
      if (data?.id) eventRowsRef.current.set(`${event.trigger}|${event.firedAt}`, data.id);
    } catch (error) {
      logSupabaseError("Could not log trigger_events row", error);
    }
  }

  async function logTriggerResolved(event: FearResolveEvent) {
    const supabase = getSupabase();
    const rowId = eventRowsRef.current.get(`${event.trigger}|${event.firedAt}`);
    if (!supabase || !rowId) return;
    try {
      const { error } = await supabase.from("trigger_events").update({ response_observed: event.responseObserved }).eq("id", rowId);
      if (error) throw error;
      eventRowsRef.current.delete(`${event.trigger}|${event.firedAt}`);
    } catch (error) {
      logSupabaseError("Could not update trigger_events.response_observed", error);
    }
  }

  const startSession = useCallback(async () => {
    const userId = await ensureSignedIn();
    userIdRef.current = userId;
    const supabase = getSupabase();
    if (!supabase || !userId) return;
    try {
      const { data, error } = await supabase
        .from("game_sessions")
        .insert({ player_id: userId, started_at: new Date().toISOString(), consent_given: true })
        .select("id")
        .single();
      if (error) throw error;
      gameSessionIdRef.current = data?.id ?? null;
    } catch (error) {
      logSupabaseError("Could not create game_sessions row", error);
    }
  }, []);

  const endSession = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase || !gameSessionIdRef.current) return;
    try {
      const { error } = await supabase
        .from("game_sessions")
        .update({
          ended_at: new Date().toISOString(),
          peak_arousal: peakArousalRef.current,
          session_summary: {
            top_trigger: peakTriggerRef.current,
            total_scares_fired: totalFiresRef.current,
            peak_arousal_trigger: peakTriggerRef.current,
          },
        })
        .eq("id", gameSessionIdRef.current);
      if (error) throw error;
    } catch (error) {
      logSupabaseError("Could not write session_summary", error);
    }
  }, []);

  // Best-effort "at session end": periodically while the tab is open, and once when it's hidden
  // (closed/backgrounded) -- there's no explicit End Session control in this UI anymore.
  useEffect(() => {
    if (!consentGiven) return;
    const interval = window.setInterval(() => { void endSession(); }, 60000);
    const onVisibility = () => { if (document.visibilityState === "hidden") void endSession(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisibility); };
  }, [consentGiven, endSession]);

  const giveConsent = useCallback(async () => {
    setConsentGiven(true);
    await startSession();
  }, [startSession]);

  const startBaseline = useCallback(async () => {
    setBaselinePending(true);
    try {
      const response = await fetch(`${getRelayHttpBase()}/fear/baseline/start`, { method: "POST" });
      if (!response.ok) throw new Error(`Relay returned ${response.status}`);
      onEvent?.("Baseline calibration started", "Sit still for ~45 seconds", "neutral");
    } catch {
      onEvent?.("Could not start baseline calibration", "Check that npm run relay is running", "accent");
    } finally {
      setBaselinePending(false);
    }
  }, [onEvent]);

  return {
    connected,
    arousal: snapshot.arousal,
    arousalState: snapshot.state,
    calibrated: snapshot.calibrated,
    calibrationPhase: snapshot.calibration.phase,
    calibrationRemaining: snapshot.calibration.remaining,
    triggerScores: snapshot.triggerScores,
    totalFires: snapshot.totalFires,
    peakArousal: snapshot.peakArousal,
    peakArousalTrigger: snapshot.peakArousalTrigger,
    consentGiven,
    giveConsent,
    startBaseline,
    baselinePending,
  };
}
