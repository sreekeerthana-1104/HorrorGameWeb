"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CalibrationPhase = "idle" | "relax" | "squeeze" | "release" | "complete" | "error";

type EmgMessage = {
  type: "emg" | "calibration" | "calibrationComplete" | "error";
  envelope?: number;
  armed?: boolean;
  calibrated?: boolean;
  threshold?: number;
  baseline?: number;
  phase?: CalibrationPhase;
  remaining?: number;
  message?: string;
  heartRate?: number;
  fingerDetected?: boolean;
  maxSensorFound?: boolean;
  gsr?: number;
};

const TREND_LENGTH = 40;
const TREND_SAMPLE_MS = 500; // one point every 500ms -> ~20s of real history per trend

export type EmgBridge = {
  address: string;
  setAddress: (address: string) => void;
  connected: boolean;
  envelope: number;
  threshold: number;
  baseline: number;
  armed: boolean;
  phase: CalibrationPhase;
  remaining: number;
  error: string;
  connect: () => void;
  startCalibration: () => void;
  heartRate: number;
  fingerDetected: boolean;
  maxSensorFound: boolean;
  gsr: number;
  heartRateTrend: number[];
  gsrTrend: number[];
};

const defaultAddress = "ws://172.20.10.2/ws";

export function useEmgBridge(): EmgBridge {
  const [address, setAddress] = useState(defaultAddress);
  const [connected, setConnected] = useState(false);
  const [envelope, setEnvelope] = useState(0);
  const [threshold, setThreshold] = useState(0);
  const [baseline, setBaseline] = useState(0);
  const [armed, setArmed] = useState(false);
  const [phase, setPhase] = useState<CalibrationPhase>("idle");
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState("");
  const [heartRate, setHeartRate] = useState(0);
  const [fingerDetected, setFingerDetected] = useState(false);
  const [maxSensorFound, setMaxSensorFound] = useState(false);
  const [gsr, setGsr] = useState(0);
  const [heartRateTrend, setHeartRateTrend] = useState<number[]>([]);
  const [gsrTrend, setGsrTrend] = useState<number[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const offlineTimerRef = useRef<number | null>(null);
  const shouldReconnectRef = useRef(false);
  const lastTrendSampleAtRef = useRef(0);

  const connect = useCallback(() => {
    shouldReconnectRef.current = true;
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
    if (offlineTimerRef.current !== null) window.clearTimeout(offlineTimerRef.current);
    socketRef.current?.close();
    setError("");
    setConnected(false);
    try {
      const socket = new WebSocket(address.trim());
      socketRef.current = socket;
      socket.onopen = () => {
        if (offlineTimerRef.current !== null) window.clearTimeout(offlineTimerRef.current);
        setConnected(true);
        setError("");
      };
      socket.onclose = () => {
        // Do not flash "offline" for a normal, short hotspot/WebSocket reconnect.
        if (offlineTimerRef.current !== null) window.clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = window.setTimeout(() => setConnected(false), 3500);
        if (shouldReconnectRef.current) {
          reconnectTimerRef.current = window.setTimeout(connect, 2000);
        }
      };
      socket.onerror = () => setError("Could not reach the ESP32. Check its Wi-Fi address and that this page is served over HTTP, not HTTPS.");
      socket.onmessage = ({ data }) => {
        let message: EmgMessage;
        try { message = JSON.parse(data as string) as EmgMessage; } catch { return; }
        if (message.type === "emg") {
          setEnvelope(message.envelope ?? 0);
          setArmed(Boolean(message.armed));
          if (message.threshold !== undefined) setThreshold(message.threshold);
          // The ESP32 keeps calibrating locally even when a phone-hotspot WebSocket
          // briefly drops. On reconnect, its state packet is enough to restore the UI.
          if (message.calibrated) setPhase("complete");
          else if (message.phase && message.phase !== "complete") {
            setPhase(message.phase);
            setRemaining(Math.ceil(message.remaining ?? 0));
          }

          const nextHeartRate = message.heartRate ?? 0;
          const nextGsr = message.gsr ?? 0;
          setHeartRate(nextHeartRate);
          setFingerDetected(Boolean(message.fingerDetected));
          setMaxSensorFound(Boolean(message.maxSensorFound));
          setGsr(nextGsr);

          // Real readings only, sampled at a fixed cadence (not every ~50ms packet)
          // so the trend covers a meaningful stretch of time instead of a jittery blur.
          const now = Date.now();
          if (now - lastTrendSampleAtRef.current >= TREND_SAMPLE_MS) {
            lastTrendSampleAtRef.current = now;
            setHeartRateTrend((prev) => [...prev, nextHeartRate].slice(-TREND_LENGTH));
            setGsrTrend((prev) => [...prev, nextGsr].slice(-TREND_LENGTH));
          }
        }
        if (message.type === "calibration") {
          setPhase(message.phase ?? "idle");
          setRemaining(Math.ceil(message.remaining ?? 0));
        }
        if (message.type === "calibrationComplete") {
          setPhase("complete");
          setRemaining(0);
          setBaseline(message.baseline ?? 0);
          setThreshold(message.threshold ?? 0);
        }
        if (message.type === "error") setError(message.message ?? "ESP32 reported an error.");
      };
    } catch {
      setError("The ESP32 address is not a valid WebSocket URL.");
    }
  }, [address]);

  const startCalibration = useCallback(() => {
    setError("");
    setPhase("relax");
    setRemaining(5);
    // HTTP avoids losing the calibration command during a short WebSocket reconnect.
    try {
      const endpoint = new URL(address.trim());
      endpoint.protocol = endpoint.protocol === "wss:" ? "https:" : "http:";
      endpoint.pathname = "/calibrate";
      endpoint.search = "";
      fetch(endpoint.toString(), { method: "POST" }).catch(() => {
        setError("Could not start calibration. Check that the ESP32 is reachable.");
        setPhase("idle");
      });
    } catch {
      setError("The ESP32 address is not valid.");
      setPhase("idle");
    }
  }, [address]);

  useEffect(() => () => {
    shouldReconnectRef.current = false;
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
    if (offlineTimerRef.current !== null) window.clearTimeout(offlineTimerRef.current);
    socketRef.current?.close();
  }, []);

  return {
    address, setAddress, connected, envelope, threshold, baseline, armed, phase, remaining, error, connect, startCalibration,
    heartRate, fingerDetected, maxSensorFound, gsr, heartRateTrend, gsrTrend,
  };
}
