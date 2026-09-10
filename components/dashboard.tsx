"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveSession } from "../hooks/use-live-session";
import { useEmgBridge } from "../hooks/use-emg-bridge";

const profile = [
  ["Footsteps", 88], ["Pursuit", 74], ["Darkness", 61], ["Shadows", 39], ["Isolation", 23],
] as const;

function Trend({ points, color }: { points: number[]; color: "red" | "amber" }) {
  const path = useMemo(() => points.map((point, i) => `${i ? "L" : "M"}${(i / (points.length - 1)) * 280} ${60 - point}`).join(" "), [points]);
  return <svg className={`trend ${color}`} viewBox="0 0 280 64" preserveAspectRatio="none" aria-hidden="true"><path d={path} /></svg>;
}

export function Dashboard() {
  const { session, pause, endSession } = useLiveSession();
  const emg = useEmgBridge();
  const [notice, setNotice] = useState("");
  const [showCalibration, setShowCalibration] = useState(true);
  const showNotice = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 2600); };
  const grip = emg.connected ? Math.min(100, Math.round((emg.envelope / Math.max(emg.threshold * 1.45, 1)) * 100)) : 0;

  useEffect(() => { if (emg.phase === "complete") setShowCalibration(false); }, [emg.phase]);

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#overview"><span className="brand-mark" /><span>NOCTURNE</span></a>
      <nav className="nav-list" aria-label="Dashboard navigation">
        <a className="nav-link active" href="#overview"><span>⌁</span>Overview</a>
        <a className="nav-link" href="#telemetry"><span>⌇</span>Telemetry</a>
        <a className="nav-link" href="#profile"><span>◒</span>Fear profile</a>
        <a className="nav-link" href="#events"><span>↯</span>Event log</a>
      </nav>
      <div className="side-bottom"><button className="subtle-button" onClick={() => showNotice("Session settings will open here.")}>⚙ Session settings</button><div className="operator"><span className="avatar">K</span><div><strong>Keerthana</strong><small>Operator</small></div><button aria-label="More options">•••</button></div></div>
    </aside>

    <main className="main-content" id="overview">
      <header className="topbar"><div className="breadcrumb">SESSIONS <i>/</i> <strong>LIVE SESSION</strong></div><div className="actions"><span className={`live-pill ${session.ended ? "ended" : ""}`}><i />{session.ended ? "ENDED" : "LIVE"}</span><button className="pause-button" onClick={pause} aria-label={session.paused ? "Resume session" : "Pause session"}>{session.paused ? "▶" : "Ⅱ"}</button><button className="end-button" onClick={() => { endSession(); showNotice("Session ended. Summary is ready to save."); }}>End session</button></div></header>
      <section className="session-heading"><div><p className="eyebrow">ADAPTIVE HORROR SESSION</p><h1>Subject <span>01</span></h1><p className="session-meta"><i className={emg.connected ? "" : "offline"} />{emg.connected ? "EMG sensor connected" : "EMG sensor disconnected"}<b>•</b>{session.elapsed} elapsed</p></div><button className="calibration calibration-button" onClick={() => setShowCalibration(true)}><span>{emg.phase === "complete" ? "✓" : "!"}</span><div><strong>{emg.phase === "complete" ? "Calibration complete" : "Calibration required"}</strong><small>{emg.phase === "complete" ? `Threshold ${emg.threshold.toFixed(0)} locked` : "Set up BioAmp EXG Pill"}</small></div></button></section>

      <section className="metrics" id="telemetry">
        <article className="arousal-card"><p className="label">LIVE AROUSAL</p><div className="arousal-value"><div><strong>{session.arousal}</strong><span>/ 100</span></div><i className={`orb ${session.state.toLowerCase()}`} /></div><b className={`state ${session.state.toLowerCase()}`}>{session.state}</b><div className="meter"><i style={{ width: `${session.arousal}%` }} /></div><small>+12 in the last 30 seconds</small></article>
        <article className="metric-card"><p className="label">HEART RATE <em>●</em></p><div className="number"><strong>{session.heartRate}</strong><span>BPM</span></div><Trend points={session.heartTrend} color="red" /><small>Baseline 72 BPM <b>↑ {session.heartRate - 72}</b></small></article>
        <article className="metric-card"><p className="label">SKIN RESPONSE <em>●</em></p><div className="number"><strong>{session.gsr.toFixed(1)}</strong><span>µS</span></div><Trend points={session.gsrTrend} color="amber" /><small>Baseline 1.9 µS <b>↑ {(session.gsr - 1.9).toFixed(1)}</b></small></article>
        <article className="metric-card"><p className="label">MUSCLE FORCE <em className={emg.connected ? "" : "muted-dot"}>●</em></p><div className="number"><strong>{grip}</strong><span>%</span></div><div className="grip-bars">{Array.from({ length: 8 }, (_, i) => <i key={i} className={i < Math.ceil(grip / 12.5) ? "filled" : ""} />)}</div><small>EMG envelope {emg.connected ? `${emg.envelope.toFixed(0)} / threshold ${emg.threshold.toFixed(0)}` : "Awaiting ESP32"}</small></article>
      </section>

      <section className="command-grid">
        <article className="command-card"><div className="card-header"><div><p className="eyebrow">UNITY COMMAND</p><h2>Escalating <i className="command-dot" /></h2></div><span className="tag">CMD 0247</span></div><div className="command-body"><span className="command-icon">♬</span><div><strong>Directional footsteps</strong><p>Move audio source closer · 72% intensity</p></div></div><footer>Awaiting scene acknowledgement <b>Sent ✓</b></footer></article>
        <article className="ability-card"><div className="card-header"><div><p className="eyebrow">PHYSICAL INTERACTION</p><h2>Controller response</h2></div><span className="tag emg">EMG</span></div><div className="ability-body"><span className="ability-icon">✦</span><div><strong>{emg.armed ? "Tear action armed" : emg.phase === "complete" ? "Squeeze to arm tear" : "Calibration required"}</strong><p>{emg.armed ? "Unity receives a fresh tear-ready signal from the ESP32." : emg.phase === "complete" ? "Grab the head, then squeeze firmly to tear it off." : "Calibrate your BioAmp before the head can be torn."}</p></div></div><button className="ability-button" onClick={() => setShowCalibration(true)}><span>{emg.armed ? "✓" : "↯"}</span>{emg.armed ? "Live signal is armed" : "Open EMG calibration"}</button></article>
      </section>

      <section className="lower-grid"><article className="panel" id="profile"><div className="panel-header"><div><p className="eyebrow">LEARNED RESPONSE PROFILE</p><h2>What is working</h2></div><button>View details →</button></div><div className="profile-bars">{profile.map(([name, score]) => <div className="profile-row" key={name}><span>{name}</span><div><i style={{ width: `${score}%` }} /></div><b>{score}</b></div>)}</div><p className="panel-note"><span>↗</span>Footsteps are producing the strongest sustained response.</p></article>
      <article className="panel" id="events"><div className="panel-header"><div><p className="eyebrow">SESSION TIMELINE</p><h2>Recent events</h2></div><button>Open log →</button></div><div className="timeline">{session.events.map((event, index) => <div className="event" key={event.time}><time>{event.time}</time><i className={event.kind} /><div><strong>{event.title}{event.delta && <em>{event.delta}</em>}</strong><p>{event.detail}</p></div>{index < session.events.length - 1 && <span className="line" />}</div>)}</div></article></section>
    </main>
    {showCalibration && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="calibration-title"><section className="calibration-modal"><p className="eyebrow">BIOAMP EXG PILL</p><h2 id="calibration-title">Calibrate controller squeeze</h2><p className="modal-copy">Keep the electrodes still. We capture relaxed muscle activity first, then learn from five short squeeze–release cycles. This threshold is personal to this session.</p><label className="address-label">ESP32 WebSocket address<input value={emg.address} onChange={(event) => emg.setAddress(event.target.value)} placeholder="ws://192.168.1.50/ws" autoComplete="off" /></label><div className="modal-actions"><button className="connect-button" onClick={emg.connect}>{emg.connected ? "Reconnect" : "Connect ESP32"}</button><button className="start-button" onClick={emg.startCalibration} disabled={!emg.connected}>{emg.phase === "relax" ? `Relax — ${emg.remaining}s` : emg.phase === "squeeze" ? `Squeeze — ${emg.remaining}s` : emg.phase === "release" ? `Release — ${emg.remaining}s` : "Start calibration"}</button></div><div className="calibration-live"><div><span>LIVE ENVELOPE</span><strong>{emg.envelope.toFixed(0)}</strong></div><div><span>STATUS</span><strong className={emg.armed ? "armed-text" : ""}>{emg.armed ? "ARMED" : emg.phase === "complete" ? "READY" : emg.connected ? "CONNECTED" : "OFFLINE"}</strong></div></div>{emg.phase === "relax" && <p className="instruction">Relax your hand completely. Do not move the electrodes.</p>}{emg.phase === "squeeze" && <p className="instruction squeeze">Squeeze firmly now. Do this for each of the five short squeeze prompts.</p>}{emg.phase === "release" && <p className="instruction">Release and relax now. The next squeeze prompt follows shortly.</p>}{emg.phase === "complete" && <button className="done-button" onClick={() => setShowCalibration(false)}>Calibration complete — continue</button>}{emg.error && <p className="emg-error">{emg.error}</p>}<p className="modal-note">For safety and consistency, recalibrate after moving the electrodes or changing the strap pressure.</p></section></div>}
    <div className={`toast ${notice ? "show" : ""}`} role="status">{notice}</div>
  </div>;
}
