"use client";

import { useEffect, useState } from "react";

export type LiveSession = { arousal: number; state: "CALM" | "ELEVATED" | "HIGH"; heartRate: number; gsr: number; grip: number; elapsed: string; paused: boolean; ended: boolean; finisherEnabled: boolean; heartTrend: number[]; gsrTrend: number[]; events: { time: string; title: string; detail: string; delta?: string; kind: string }[] };

const initialSession: LiveSession = {
  arousal: 64, state: "ELEVATED", heartRate: 94, gsr: 3.8, grip: 76, elapsed: "12:48", paused: false, ended: false, finisherEnabled: false,
  heartTrend: [16, 19, 15, 24, 18, 29, 21, 36, 24, 32, 19, 38, 26, 33, 22, 43],
  gsrTrend: [9, 10, 8, 15, 13, 18, 22, 20, 29, 34, 31, 42, 44, 48, 51, 57],
  events: [
    { time: "18:15:31", title: "Footsteps introduced", detail: "Unity event · West corridor", kind: "accent" },
    { time: "18:15:38", title: "Arousal response detected", delta: "+18", detail: "Heart rate and GSR sustained", kind: "warning" },
    { time: "18:15:42", title: "Fear score updated", detail: "Footsteps → 88 / 100", kind: "neutral" },
    { time: "18:15:47", title: "Intensity escalated", detail: "Command sent to Unity", kind: "active" },
  ],
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clock = (elapsed: string) => { const [m, s] = elapsed.split(":").map(Number); const total = m * 60 + s + 1; return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; };

export function useLiveSession() {
  const [session, setSession] = useState<LiveSession>(initialSession);
  useEffect(() => { const timer = window.setInterval(() => setSession(current => { if (current.paused || current.ended) return current; const arousal = clamp(current.arousal + Math.round((Math.random() - .43) * 8), 42, 88); const heartRate = clamp(current.heartRate + Math.round((Math.random() - .46) * 7), 82, 111); const gsr = clamp(current.gsr + (Math.random() - .43) * .35, 2.3, 5.2); const grip = clamp(current.grip + Math.round((Math.random() - .55) * 12), 15, 100); return { ...current, arousal, heartRate, gsr, grip, elapsed: clock(current.elapsed), state: arousal > 77 ? "HIGH" : arousal > 53 ? "ELEVATED" : "CALM", heartTrend: [...current.heartTrend.slice(1), clamp(heartRate - 52 + (Math.random() - .5) * 7, 6, 58)], gsrTrend: [...current.gsrTrend.slice(1), clamp((gsr - 1.4) * 16 + (Math.random() - .5) * 6, 4, 60)] }; }), 2500); return () => window.clearInterval(timer); }, []);
  return { session, pause: () => setSession(s => ({ ...s, paused: !s.paused })), endSession: () => setSession(s => ({ ...s, ended: true, paused: true })), setFinisherEnabled: (finisherEnabled: boolean) => setSession(s => ({ ...s, finisherEnabled })) };
}
