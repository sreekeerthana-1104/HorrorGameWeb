"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../hooks/use-session";
import { useEmgBridge } from "../hooks/use-emg-bridge";

const triggerNames = ["Footsteps", "Pursuit", "Darkness", "Shadows", "Isolation"] as const;

function Trend({ points, color }: { points: number[]; color: "red" | "amber" }) {
  const path = useMemo(() => {
    if (points.length < 2) return "";
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    return points
      .map((point, i) => `${i ? "L" : "M"}${(i / (points.length - 1)) * 280} ${58 - ((point - min) / range) * 52}`)
      .join(" ");
  }, [points]);
  return <svg className={`trend ${color}`} viewBox="0 0 280 64" preserveAspectRatio="none" aria-hidden="true">{path && <path d={path} />}</svg>;
}

export function Dashboard() {
  const session = useSession();
  const emg = useEmgBridge();
  const [notice, setNotice] = useState("");
  const [showCalibration, setShowCalibration] = useState(true);
  const [testTearPending, setTestTearPending] = useState(false);
  const showNotice = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 2600); };
  const grip = emg.connected ? Math.min(100, Math.round((emg.envelope / Math.max(emg.threshold * 1.45, 1)) * 100)) : 0;

  const triggerUnityTearTest = async () => {
    setTestTearPending(true);
    const configured = process.env.NEXT_PUBLIC_REALTIME_GATEWAY_URL;
    // A localhost/unset gateway only resolves on the laptop itself. Fall back to the host
    // that served this page so the button also works from a phone or the Quest browser.
    const remoteConfigured =
      configured && !/\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(configured)
        ? configured.replace(/^ws/i, "http").replace(/\/$/, "")
        : "";
    const relayBase = remoteConfigured || `http://${window.location.hostname}:3001`;
    try {
      const response = await fetch(`${relayBase}/emg/test-tear?durationMs=8000`, { method: "POST" });
      if (!response.ok) throw new Error(`Relay returned ${response.status}`);
      showNotice("Test tear window sent to Unity for 8 seconds — grab the head now.");
      session.logEvent("Test tear window sent", "Relay armed Unity for 8 seconds", "warning");
    } catch {
      showNotice("Could not reach the laptop relay. Start npm run relay, then try again.");
    } finally {
      setTestTearPending(false);
    }
  };

  useEffect(() => { if (emg.phase === "complete") setShowCalibration(false); }, [emg.phase]);

  // Real system events only, logged on actual state transitions — no scripted/fake beats.
  const prevConnected = useRef(emg.connected);
  useEffect(() => {
    if (emg.connected !== prevConnected.current) {
      session.logEvent(emg.connected ? "ESP32 connected" : "ESP32 disconnected", emg.address, emg.connected ? "active" : "accent");
      prevConnected.current = emg.connected;
    }
  }, [emg.connected]); // eslint-disable-line react-hooks/exhaustive-deps

  const prevPhase = useRef(emg.phase);
  useEffect(() => {
    if (emg.phase !== prevPhase.current) {
      if (emg.phase === "relax") session.logEvent("Calibration started", undefined, "neutral");
      if (emg.phase === "complete") session.logEvent("Calibration complete", `Threshold locked at ${emg.threshold.toFixed(0)}`, "active");
      prevPhase.current = emg.phase;
    }
  }, [emg.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const prevArmed = useRef(emg.armed);
  useEffect(() => {
    if (emg.armed && !prevArmed.current) {
      session.logEvent("Grip threshold crossed", `Envelope ${emg.envelope.toFixed(0)} / threshold ${emg.threshold.toFixed(0)}`, "warning");
    }
    prevArmed.current = emg.armed;
  }, [emg.armed]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#overview"><span className="brand-mark" /><span>NOCTURNE</span></a>
      <nav className="nav-list" aria-label="Dashboard navigation">
        <a className="nav-link active" href="#overview"><span>⌁</span>Overview</a>
        <a className="nav-link" href="#telemetry"><span>⌇</span>Telemetry</a>
        <a className="nav-link" href="#profile"><span>◒</span>Fear profile</a>
        <a className="nav-link" href="#events"><span>↯</span>Event log</a>
      </nav>
      <div className="side-bottom"><div className="operator"><span className="avatar">OP</span><div><strong>Operator</strong><small>Session control</small></div></div></div>
    </aside>

    <main className="main-content" id="overview">
      <header className="topbar"><div className="breadcrumb">SESSIONS <i>/</i> <strong>LIVE SESSION</strong></div><div className="actions"><span className={`live-pill ${session.ended ? "ended" : ""}`}><i />{session.ended ? "ENDED" : "LIVE"}</span><button className="pause-button" onClick={session.pause} aria-label={session.paused ? "Resume session" : "Pause session"}>{session.paused ? "▶" : "Ⅱ"}</button><button className="end-button" onClick={() => { session.endSession(); showNotice("Session ended."); }}>End session</button></div></header>
      <section className="session-heading"><div><p className="eyebrow">ADAPTIVE HORROR SESSION</p><h1>Subject <span>01</span></h1><p className="session-meta"><i className={emg.connected ? "" : "offline"} />{emg.connected ? "ESP32 connected" : "ESP32 disconnected"}<b>•</b>{session.elapsed} elapsed</p></div><button className="calibration calibration-button" onClick={() => setShowCalibration(true)}><span>{emg.phase === "complete" ? "✓" : "!"}</span><div><strong>{emg.phase === "complete" ? "Calibration complete" : "Calibration required"}</strong><small>{emg.phase === "complete" ? `Threshold ${emg.threshold.toFixed(0)} locked` : "Set up BioAmp EXG Pill"}</small></div></button></section>

      <section className="metrics" id="telemetry">
        <article className="metric-card"><p className="label">HEART RATE <em className={emg.fingerDetected ? "" : "muted-dot"}>●</em></p><div className="number"><strong>{emg.heartRate > 0 ? emg.heartRate.toFixed(0) : "—"}</strong><span>BPM</span></div><Trend points={emg.heartRateTrend} color="red" /><small>{!emg.connected ? "Awaiting ESP32" : !emg.maxSensorFound ? "MAX30102 not detected" : emg.fingerDetected ? "Finger detected" : "Place finger on sensor"}</small></article>
        <article className="metric-card"><p className="label">SKIN RESPONSE <em className={emg.connected ? "" : "muted-dot"}>●</em></p><div className="number"><strong>{emg.connected ? emg.gsr.toFixed(0) : "—"}</strong><span>raw</span></div><Trend points={emg.gsrTrend} color="amber" /><small>Grove GSR, unfiltered ADC scale — baseline calibration comes later</small></article>
        <article className="metric-card"><p className="label">CONTROLLER GRIP <em className={emg.connected ? "" : "muted-dot"}>●</em></p><div className="number"><strong>{grip}</strong><span>%</span></div><div className="grip-bars">{Array.from({ length: 8 }, (_, i) => <i key={i} className={i < Math.ceil(grip / 12.5) ? "filled" : ""} />)}</div><small>{emg.connected ? `envelope ${emg.envelope.toFixed(0)} / threshold ${emg.threshold.toFixed(0)}` : "Awaiting ESP32"}</small></article>
      </section>

      <section className="command-grid">
        <article className="ability-card"><div className="card-header"><div><p className="eyebrow">PHYSICAL INTERACTION</p><h2>Controller response</h2></div><span className="tag emg">EMG</span></div><div className="ability-body"><span className="ability-icon">✦</span><div><strong>{emg.armed ? "Tear action armed" : emg.phase === "complete" ? "Squeeze to arm tear" : "Calibration required"}</strong><p>{emg.armed ? "Unity receives a fresh tear-ready signal from the ESP32." : emg.phase === "complete" ? "Grab the head, then squeeze firmly to tear it off." : "Calibrate your BioAmp before the head can be torn."}</p></div></div><button className="ability-button" onClick={triggerUnityTearTest} disabled={testTearPending}><span>⚡</span>{testTearPending ? "Sending test…" : "Test laptop → Unity tear (8s)"}</button><button className="ability-button" onClick={() => setShowCalibration(true)}><span>{emg.armed ? "✓" : "↯"}</span>{emg.armed ? "Live signal is armed" : "Open EMG calibration"}</button></article>
        <article className="arousal-card inactive"><p className="label">LIVE AROUSAL</p><div className="arousal-value"><div><strong>—</strong><span>/ 100</span></div><i className="orb inactive" /></div><b className="state inactive">NOT ACTIVE</b><div className="meter"><i style={{ width: "0%" }} /></div><small>Wire up baseline calibration + HR/GSR weighting to activate this panel (build order step 2).</small></article>
      </section>

      <section className="lower-grid">
        <article className="panel" id="profile"><div className="panel-header"><div><p className="eyebrow">LEARNED RESPONSE PROFILE</p><h2>What is working</h2></div><span className="tag">NOT ACTIVE</span></div><div className="profile-bars">{triggerNames.map((name) => <div className="profile-row" key={name}><span>{name}</span><div><i style={{ width: "0%" }} /></div><b>—</b></div>)}</div><p className="panel-note"><span>○</span>Scores populate once Unity tags game beats and the web engine scores them (build order step 3).</p></article>
        <article className="panel" id="events"><div className="panel-header"><div><p className="eyebrow">SESSION TIMELINE</p><h2>Recent events</h2></div></div><div className="timeline">{session.events.length === 0 ? <p className="panel-empty">No events yet — connect the ESP32 to begin.</p> : session.events.map((event, index) => <div className="event" key={`${event.time}-${index}`}><time>{event.time}</time><i className={event.kind} /><div><strong>{event.title}</strong>{event.detail && <p>{event.detail}</p>}</div>{index < session.events.length - 1 && <span className="line" />}</div>)}</div></article>
      </section>
    </main>
    {showCalibration && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="calibration-title"><section className="calibration-modal"><p className="eyebrow">BIOAMP EXG PILL</p><h2 id="calibration-title">Calibrate controller squeeze</h2><p className="modal-copy">Keep the electrodes still. We capture relaxed muscle activity first, then learn from three deliberate squeeze–release cycles. This threshold is personal to this session.</p><label className="address-label">ESP32 WebSocket address<input value={emg.address} onChange={(event) => emg.setAddress(event.target.value)} placeholder="ws://192.168.1.50/ws" autoComplete="off" /></label><div className="modal-actions"><button className="connect-button" onClick={emg.connect}>{emg.connected ? "Reconnect" : "Connect ESP32"}</button><button className="start-button" onClick={emg.startCalibration}>{emg.phase === "relax" ? `Relax — ${emg.remaining}s` : emg.phase === "squeeze" ? `Squeeze — ${emg.remaining}s` : emg.phase === "release" ? `Release — ${emg.remaining}s` : "Start calibration"}</button></div><div className="calibration-live"><div><span>LIVE ENVELOPE</span><strong>{emg.envelope.toFixed(0)}</strong></div><div><span>STATUS</span><strong className={emg.armed ? "armed-text" : ""}>{emg.armed ? "ARMED" : emg.phase === "complete" ? "READY" : emg.connected ? "CONNECTED" : "OFFLINE"}</strong></div></div>{emg.phase === "relax" && <p className="instruction">Relax your hand completely. Do not move the electrodes.</p>}{emg.phase === "squeeze" && <p className="instruction squeeze">Squeeze firmly and hold for the full three seconds. Repeat for all three prompts.</p>}{emg.phase === "release" && <p className="instruction">Release and relax for three seconds. The next squeeze follows shortly.</p>}{emg.phase === "complete" && <button className="done-button" onClick={() => setShowCalibration(false)}>Calibration complete — continue</button>}{emg.error && <p className="emg-error">{emg.error}</p>}<p className="modal-note">You can follow the prompt even during a momentary WebSocket reconnect; the ESP32 tracks calibration locally.</p></section></div>}
    <div className={`toast ${notice ? "show" : ""}`} role="status">{notice}</div>
  </div>;
}
