"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CalibrationPhase = "idle" | "relax" | "squeeze" | "release" | "complete" | "error";

type EmgMessage = {
  type: "emg" | "calibration" | "calibrationComplete" | "error";
  envelope?: number;
  armed?: boolean;
  threshold?: number;
  baseline?: number;
  phase?: CalibrationPhase;
  remaining?: number;
  message?: string;
};

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
};

const defaultAddress = "ws://192.168.1.50/ws";

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
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const shouldReconnectRef = useRef(false);

  const connect = useCallback(() => {
    shouldReconnectRef.current = true;
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
    socketRef.current?.close();
    setError("");
    setConnected(false);
    try {
      const socket = new WebSocket(address.trim());
      socketRef.current = socket;
      socket.onopen = () => { setConnected(true); setError(""); };
      socket.onclose = () => {
        setConnected(false);
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
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setError("Connect to the ESP32 before starting calibration.");
      return;
    }
    setError("");
    socketRef.current.send(JSON.stringify({ type: "startCalibration" }));
  }, []);

  useEffect(() => () => {
    shouldReconnectRef.current = false;
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
    socketRef.current?.close();
  }, []);

  return { address, setAddress, connected, envelope, threshold, baseline, armed, phase, remaining, error, connect, startCalibration };
}
