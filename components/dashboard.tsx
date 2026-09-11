"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Ghost, Gauge, Activity, Radar, ListTree, Clock, HeartPulse, Waves, Hand,
  CheckCircle2, AlertTriangle, Zap, Lock, SlidersHorizontal, Info, X, Plug, Play,
  ShieldCheck, Hourglass,
} from "lucide-react";
import { useSession } from "../hooks/use-session";
import { useEmgBridge } from "../hooks/use-emg-bridge";
import { useFearEngine, TRIGGER_IDS, type TriggerId } from "../hooks/use-fear-engine";

const triggerLabels: Record<TriggerId, string> = { footsteps: "Footsteps", flicker_lights: "Flicker lights", play_scream: "Scream" };
const arousalTone = (state: "CALM" | "ELEVATED" | "HIGH") => (state === "HIGH" ? "high" : state === "ELEVATED" ? "elevated" : "calm");

const navItems = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "telemetry", label: "Telemetry", icon: Activity },
  { id: "profile", label: "Fear profile", icon: Radar },
  { id: "events", label: "Event log", icon: ListTree },
] as const;

function Dot({ state }: { state: "ok" | "warn" | "danger" | "off" }) {
  return <i className={`dot dot--${state}`} />;
}

function Trend({ points, tone }: { points: number[]; tone: "danger" | "warning" }) {
  const gradientId = useId();
  const stroke = tone === "danger" ? "#e5484d" : "#f5a623";
  const { line, area } = useMemo(() => {
    if (points.length < 2) return { line: "", area: "" };
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const coords = points.map((point, i) => [(i / (points.length - 1)) * 280, 58 - ((point - min) / range) * 52] as const);
    const line = coords.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
    const [lastX] = coords[coords.length - 1];
    const [firstX] = coords[0];
    return { line, area: `${line} L${lastX} 64 L${firstX} 64 Z` };
  }, [points]);

  if (!line) return <svg className="trend" viewBox="0 0 280 64" aria-hidden="true" />;
  return (
    <svg className="trend" viewBox="0 0 280 64" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.32" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} stroke="none" />
      <path d={line} fill="none" stroke={stroke} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Dashboard() {
  const session = useSession();
  const emg = useEmgBridge();
  const fear = useFearEngine({ onEvent: session.logEvent });
  const [showCalibration, setShowCalibration] = useState(true);
  const [activeSection, setActiveSection] = useState<string>("overview");
  const grip = emg.connected ? Math.min(100, Math.round((emg.envelope / Math.max(emg.threshold * 1.45, 1)) * 100)) : 0;

  useEffect(() => { if (emg.phase === "complete") setShowCalibration(false); }, [emg.phase]);

  // Scroll-spy: the sidebar nav tracks which section is actually in view,
  // instead of a hardcoded "active" class on the first item.
  useEffect(() => {
    const sections = navItems.map((item) => document.getElementById(item.id)).filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActiveSection(visible[0].target.id);
      },
      { rootMargin: "-15% 0px -55% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

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

  const heartRateState: "ok" | "warn" | "off" = !emg.connected || !emg.maxSensorFound ? "off" : emg.fingerDetected ? "ok" : "warn";
  const calibrationState: "ok" | "warn" | "off" = emg.phase === "complete" ? "ok" : emg.phase !== "idle" ? "warn" : "off";

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#overview"><Ghost className="brand-mark" size={18} /><span>NOCTURNE</span></a>
      <nav className="nav" aria-label="Dashboard navigation">
        {navItems.map(({ id, label, icon: Icon }) => (
          <a key={id} className={`nav-link ${activeSection === id ? "active" : ""}`} href={`#${id}`}><Icon size={16} strokeWidth={2} />{label}</a>
        ))}
      </nav>
      <div className="sidebar-status">
        <p className="sidebar-status__title">SYSTEM</p>
        <div className="sidebar-status__list">
          <div className="sidebar-status__row"><Dot state={emg.connected ? "ok" : "off"} /><strong>ESP32</strong><small>{emg.connected ? "online" : "offline"}</small></div>
          <div className="sidebar-status__row"><Dot state={heartRateState} /><strong>MAX30102</strong><small>{!emg.maxSensorFound ? "not found" : emg.fingerDetected ? "reading" : "no finger"}</small></div>
          <div className="sidebar-status__row"><Dot state={emg.connected ? "ok" : "off"} /><strong>Grove GSR</strong><small>{emg.connected ? "reading" : "offline"}</small></div>
          <div className="sidebar-status__row"><Dot state={calibrationState} /><strong>EMG grip</strong><small>{emg.phase === "complete" ? "calibrated" : emg.phase !== "idle" ? "calibrating" : "idle"}</small></div>
        </div>
      </div>
    </aside>

    <main className="main-content" id="overview">
      <header className="topbar">
        <div className="breadcrumb">SESSIONS / <strong>LIVE SESSION</strong></div>
        <div className="topbar-clock"><Clock size={14} />{session.elapsed}</div>
      </header>

      <section className="session-heading">
        <div>
          <p className="eyebrow">Adaptive Horror Session</p>
          <h1>Subject <span>01</span></h1>
          <p className="session-meta"><Dot state={emg.connected ? "ok" : "off"} />{emg.connected ? "ESP32 connected" : "ESP32 disconnected"}<b>•</b>{session.elapsed} elapsed</p>
        </div>
        <button className={`calibration-chip ${emg.phase === "complete" ? "done" : "pending"}`} onClick={() => setShowCalibration(true)}>
          <span className="calibration-chip__icon">{emg.phase === "complete" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}</span>
          <div><strong>{emg.phase === "complete" ? "Calibration complete" : "Calibration required"}</strong><small>{emg.phase === "complete" ? `Threshold ${emg.threshold.toFixed(0)} locked` : "Set up BioAmp EXG Pill"}</small></div>
        </button>
      </section>

      <section className="metrics" id="telemetry">
        <article className="card metric-card">
          <div className="metric-card__head"><span className="metric-card__label"><HeartPulse size={13} />HEART RATE</span><Dot state={heartRateState} /></div>
          <div className="metric-card__value"><strong>{emg.heartRate > 0 ? emg.heartRate.toFixed(0) : "—"}</strong><span>BPM</span></div>
          <Trend points={emg.heartRateTrend} tone="danger" />
          <p className="metric-card__foot">{!emg.connected ? "Awaiting ESP32" : !emg.maxSensorFound ? "MAX30102 not detected" : emg.fingerDetected ? "Finger detected" : "Place finger on sensor"}</p>
        </article>
        <article className="card metric-card">
          <div className="metric-card__head"><span className="metric-card__label"><Waves size={13} />SKIN RESPONSE</span><Dot state={emg.connected ? "ok" : "off"} /></div>
          <div className="metric-card__value"><strong>{emg.connected ? emg.gsr.toFixed(0) : "—"}</strong><span>raw</span></div>
          <Trend points={emg.gsrTrend} tone="warning" />
          <p className="metric-card__foot">Grove GSR, unfiltered ADC scale — baseline calibration comes later</p>
        </article>
        <article className="card metric-card">
          <div className="metric-card__head"><span className="metric-card__label"><Hand size={13} />CONTROLLER GRIP</span><Dot state={emg.connected ? "ok" : "off"} /></div>
          <div className="metric-card__value"><strong>{grip}</strong><span>%</span></div>
          <div className="grip-bars">{Array.from({ length: 8 }, (_, i) => <i key={i} className={i < Math.ceil(grip / 12.5) ? "filled" : ""} />)}</div>
          <p className="metric-card__foot">{emg.connected ? `envelope ${emg.envelope.toFixed(0)} / threshold ${emg.threshold.toFixed(0)}` : "Awaiting ESP32"}</p>
        </article>
      </section>

      <section className="grid-2">
        <article className="card panel-card">
          <div className="panel-card__head"><div><p className="eyebrow">Physical interaction</p><h2>Controller response</h2></div><span className="badge emg">EMG</span></div>
          <div className="ability-row">
            <span className={`ability-icon ${emg.armed ? "armed" : "idle"}`}>{emg.armed ? <Zap size={18} /> : <Lock size={18} />}</span>
            <div><strong>{emg.armed ? "Tear action armed" : emg.phase === "complete" ? "Squeeze to arm tear" : "Calibration required"}</strong><p>{emg.armed ? "Unity receives a fresh tear-ready signal from the ESP32." : emg.phase === "complete" ? "Grab the head, then squeeze firmly to tear it off." : "Calibrate your BioAmp before the head can be torn."}</p></div>
          </div>
          <button className={`btn ${emg.armed ? "armed" : ""}`} onClick={() => setShowCalibration(true)}>{emg.armed ? <CheckCircle2 size={14} /> : <SlidersHorizontal size={14} />}{emg.armed ? "Live signal is armed" : "Open EMG calibration"}</button>
        </article>

        {!fear.consentGiven ? (
          <article className="card panel-card inactive">
            <p className="eyebrow">Live arousal</p>
            <div className="ability-row">
              <span className="ability-icon idle"><ShieldCheck size={18} /></span>
              <div><strong>Enable biometric monitoring</strong><p>Turns on real-time arousal scoring from heart rate + skin response. Nothing is recorded without this.</p></div>
            </div>
            <button className="btn" onClick={fear.giveConsent}><ShieldCheck size={14} />I consent — start monitoring</button>
          </article>
        ) : !fear.calibrated ? (
          <article className="card panel-card inactive">
            <p className="eyebrow">Live arousal</p>
            <div className="ability-row">
              <span className="ability-icon idle"><Hourglass size={18} /></span>
              <div><strong>{fear.calibrationPhase === "collecting" ? `Capturing baseline — ${Math.ceil(fear.calibrationRemaining)}s` : "Baseline required"}</strong><p>{fear.calibrationPhase === "collecting" ? "Sit still and relax — this only needs to happen once." : "Captures ~45s of calm heart rate + GSR before arousal scoring can start."}</p></div>
            </div>
            <button className="btn" onClick={fear.startBaseline} disabled={fear.baselinePending || fear.calibrationPhase === "collecting"}><Play size={14} />{fear.calibrationPhase === "collecting" ? "Capturing…" : "Start baseline capture"}</button>
          </article>
        ) : (
          <article className="card panel-card">
            <p className="eyebrow">Live arousal</p>
            <div className="arousal-face">
              <span className="arousal-value live">{fear.arousal}<span>/ 100</span></span>
              <span className={`arousal-orb ${arousalTone(fear.arousalState)}`}><Activity size={14} /></span>
            </div>
            <b className={`state ${arousalTone(fear.arousalState)}`}>{fear.arousalState}</b>
            <div className={`meter ${arousalTone(fear.arousalState)}`}><i style={{ width: `${fear.arousal}%` }} /></div>
            <p className="panel-note"><Info size={13} />Peak this session: {fear.peakArousal}/100{fear.peakArousalTrigger ? ` on ${triggerLabels[fear.peakArousalTrigger]}` : ""} · {fear.totalFires} scares fired</p>
          </article>
        )}
      </section>

      <section className="grid-2">
        <article className={`card panel-card ${fear.calibrated ? "" : "inactive"}`} id="profile">
          <div className="panel-card__head"><div><p className="eyebrow">Learned response profile</p><h2>What is working</h2></div><span className={`badge ${fear.calibrated ? "live" : "idle"}`}>{fear.calibrated ? "LIVE" : "NOT ACTIVE"}</span></div>
          <div className="profile-bars">{TRIGGER_IDS.map((id) => <div className={`profile-row ${fear.calibrated ? "live" : ""}`} key={id}><span>{triggerLabels[id]}</span><div><i style={{ width: `${fear.calibrated ? Math.round(fear.triggerScores[id] * 100) : 0}%` }} /></div><b>{fear.calibrated ? fear.triggerScores[id].toFixed(2) : "—"}</b></div>)}</div>
          <p className="panel-note"><Info size={13} />{fear.calibrated ? "Rotates through all three triggers, then favors whichever is raising your arousal." : "Scores populate once baseline calibration completes and triggers start firing."}</p>
        </article>

        <article className="card panel-card" id="events">
          <div className="panel-card__head"><div><p className="eyebrow">Session timeline</p><h2>Recent events</h2></div></div>
          <div className="timeline">
            {session.events.length === 0
              ? <p className="panel-empty">No events yet — connect the ESP32 to begin.</p>
              : session.events.map((event, index) => (
                <div className="event" key={`${event.time}-${index}`}>
                  <time>{event.time}</time><Dot state={event.kind === "active" ? "ok" : event.kind === "warning" ? "warn" : event.kind === "accent" ? "danger" : "off"} />
                  <div><strong>{event.title}</strong>{event.detail && <p>{event.detail}</p>}</div>
                  {index < session.events.length - 1 && <span className="line" />}
                </div>
              ))}
          </div>
        </article>
      </section>
    </main>

    {showCalibration && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="calibration-title" onClick={(event) => { if (event.target === event.currentTarget) setShowCalibration(false); }}>
      <section className="calibration-modal">
        <button className="modal-close" aria-label="Close calibration" onClick={() => setShowCalibration(false)}><X size={16} /></button>
        <p className="eyebrow">BioAmp EXG Pill</p>
        <h2 id="calibration-title">Calibrate controller squeeze</h2>
        <p className="modal-copy">Keep the electrodes still. We capture relaxed muscle activity first, then learn from three deliberate squeeze–release cycles. This threshold is personal to this session.</p>
        <label className="address-label">ESP32 WebSocket address<input value={emg.address} onChange={(event) => emg.setAddress(event.target.value)} placeholder="ws://192.168.1.50/ws" autoComplete="off" /></label>
        <div className="modal-actions">
          <button className="btn" onClick={emg.connect}><Plug size={14} />{emg.connected ? "Reconnect" : "Connect ESP32"}</button>
          <button className="btn primary" onClick={emg.startCalibration}><Play size={14} />{emg.phase === "relax" ? `Relax — ${emg.remaining}s` : emg.phase === "squeeze" ? `Squeeze — ${emg.remaining}s` : emg.phase === "release" ? `Release — ${emg.remaining}s` : "Start calibration"}</button>
        </div>
        <div className="calibration-live">
          <div><span>LIVE ENVELOPE</span><strong>{emg.envelope.toFixed(0)}</strong></div>
          <div><span>STATUS</span><strong className={emg.armed ? "armed-text" : ""}>{emg.armed ? "ARMED" : emg.phase === "complete" ? "READY" : emg.connected ? "CONNECTED" : "OFFLINE"}</strong></div>
        </div>
        {emg.phase === "relax" && <p className="instruction">Relax your hand completely. Do not move the electrodes.</p>}
        {emg.phase === "squeeze" && <p className="instruction squeeze">Squeeze firmly and hold for the full three seconds. Repeat for all three prompts.</p>}
        {emg.phase === "release" && <p className="instruction">Release and relax for three seconds. The next squeeze follows shortly.</p>}
        {emg.phase === "complete" && <button className="btn primary" onClick={() => setShowCalibration(false)}>Calibration complete — continue</button>}
        {emg.error && <p className="emg-error">{emg.error}</p>}
        <p className="modal-note">You can follow the prompt even during a momentary WebSocket reconnect; the ESP32 tracks calibration locally.</p>
      </section>
    </div>}
  </div>;
}
