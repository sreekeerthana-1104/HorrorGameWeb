// Deterministic arousal scoring + per-trigger effectiveness scoring, driven by
// live heart rate + GSR from the ESP32. No LLM, no bandit math: a rolling
// baseline, a weighted score, a sustained-elevation gate before escalating,
// and a simple rotate-then-bias trigger picker. See integration/LESSONS-LEARNED.md
// for the wider hardware -> engine -> web pattern this plugs into.
//
// Judgment calls made here that the spec left open (flagging them so they're
// easy to retune, not because they're load-bearing):
//   - normalization denominators for HR rise / GSR response (baseline std-dev
//     scaled, with a floor so a very calm/steady baseline doesn't make the
//     engine hypersensitive)
//   - decay pulls trigger scores back toward the neutral 0.5, not toward 0
//   - intensity blends arousal and trigger-effectiveness 50/50
//   - ELEVATED_THRESHOLD / SUSTAIN_SAMPLES / RESPONSE_RISE are reasonable
//     first guesses, not tuned against a real person yet

export const TRIGGERS = ["footsteps", "flicker_lights", "play_scream"];
const ACTION_BY_TRIGGER = { footsteps: "play_footsteps", flicker_lights: "flicker_lights", play_scream: "play_scream" };

const ROLL_MS = 7000;          // 5-10s rolling average window (GSR responds slower than HR)
const BASELINE_MS = 45000;     // still/calm capture window, within the 30-60s spec
const SUSTAIN_SAMPLES = 3;     // consecutive ~1s ticks above threshold before the engine treats a rise as real
const ELEVATED_THRESHOLD = 55; // 0-100 arousal score that counts as "elevated enough to escalate"
const COOLDOWN_MS = 6000;      // minimum gap between fired triggers
const RESPONSE_WINDOW_MS = 8000;
const RESPONSE_RISE = 8;       // arousal must rise by at least this many points within the window to count as "worked"
const SCORE_UP = 0.15;
const SCORE_DOWN = 0.05;
const DECAY_INTERVAL_MS = 60000;
const DECAY_FACTOR = 0.98;
const EXPLORE_CHANCE = 0.2;

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function mean(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function stdDev(values, avg) { return values.length ? Math.sqrt(mean(values.map((v) => (v - avg) ** 2))) : 0; }

export function createFearEngine({ onFire, onResolve, log = () => {} } = {}) {
  let baseline = null; // { hrMean, hrStd, gsrMean, gsrStd }
  let calibration = { phase: "idle", startedAt: 0, hrSamples: [], gsrSamples: [] };

  let hrHistory = [];  // [{ t, v }]
  let gsrHistory = [];

  let arousal = 0;      // last emitted, gated value (0-100) -- what the dashboard/engine act on
  let sustainCount = 0;
  let lastFiredAt = 0;

  const triggerScores = Object.fromEntries(TRIGGERS.map((t) => [t, 0.5]));
  let totalFires = 0;
  let pendingWindows = []; // [{ trigger, firedAt, arousalAtFire, intensity }]
  let lastDecayAt = Date.now();

  let peakArousal = 0;
  let peakArousalTrigger = null;
  const sessionStartedAt = Date.now();

  function ingest({ heartRate, gsr, fingerDetected, connected }) {
    const now = Date.now();
    if (connected && fingerDetected && heartRate > 0) hrHistory.push({ t: now, v: heartRate });
    if (connected && Number.isFinite(gsr)) gsrHistory.push({ t: now, v: gsr });
    const cutoff = now - ROLL_MS * 4;
    hrHistory = hrHistory.filter((s) => s.t >= cutoff);
    gsrHistory = gsrHistory.filter((s) => s.t >= cutoff);

    if (calibration.phase === "collecting") {
      if (connected && fingerDetected && heartRate > 0) calibration.hrSamples.push(heartRate);
      if (connected && Number.isFinite(gsr)) calibration.gsrSamples.push(gsr);
      if (now - calibration.startedAt >= BASELINE_MS) finishCalibration();
    }
  }

  function startCalibration() {
    calibration = { phase: "collecting", startedAt: Date.now(), hrSamples: [], gsrSamples: [] };
    baseline = null;
    log("baseline calibration started");
    return calibrationStatus();
  }

  // Baselines HR and GSR independently -- either one alone is enough to calibrate (arousal just
  // runs 100% on whichever signal(s) are actually available, live, moment to moment; see tick()).
  // Only fails outright if NEITHER sensor produced enough samples.
  function finishCalibration() {
    const hasHr = calibration.hrSamples.length >= 5;
    const hasGsr = calibration.gsrSamples.length >= 5;
    if (!hasHr && !hasGsr) {
      calibration.phase = "idle";
      log("baseline calibration failed - no usable samples from either sensor (check finger placement / GSR contact)");
      return;
    }
    const hrMean = hasHr ? mean(calibration.hrSamples) : null;
    const gsrMean = hasGsr ? mean(calibration.gsrSamples) : null;
    baseline = {
      hrMean, hrStd: hasHr ? Math.max(stdDev(calibration.hrSamples, hrMean), 1) : null,
      gsrMean, gsrStd: hasGsr ? Math.max(stdDev(calibration.gsrSamples, gsrMean), 1) : null,
    };
    calibration.phase = "done";
    const hrLabel = hasHr ? `HR ${hrMean.toFixed(0)} +/-${baseline.hrStd.toFixed(1)}` : "HR not available";
    const gsrLabel = hasGsr ? `GSR ${gsrMean.toFixed(0)} +/-${baseline.gsrStd.toFixed(1)}` : "GSR not available";
    log(`baseline captured: ${hrLabel}, ${gsrLabel}`);
  }

  function calibrationStatus() {
    const remaining = calibration.phase === "collecting" ? Math.max(0, BASELINE_MS - (Date.now() - calibration.startedAt)) / 1000 : 0;
    return { phase: calibration.phase, remaining, calibrated: baseline !== null };
  }

  function rollingAvg(history, sinceMsAgo, untilMsAgo = 0) {
    const now = Date.now();
    const windowed = history.filter((s) => now - s.t <= sinceMsAgo && now - s.t >= untilMsAgo);
    return windowed.length ? mean(windowed.map((s) => s.v)) : null;
  }

  // Call on a steady ~1s tick.
  function tick() {
    const now = Date.now();

    if (now - lastDecayAt >= DECAY_INTERVAL_MS) {
      lastDecayAt = now;
      for (const t of TRIGGERS) triggerScores[t] = 0.5 + (triggerScores[t] - 0.5) * DECAY_FACTOR;
    }

    if (!baseline) { arousal = 0; sustainCount = 0; return snapshot(); }

    // Each signal only contributes if its baseline exists AND it's actually reporting right now
    // (finger off the sensor, GSR unplugged, etc. all fall out of this rather than being silently
    // treated as "calm"). Weights re-normalize to whatever's actually live -- one working sensor
    // still drives arousal correctly on its own, not at half strength.
    const hrNow = baseline.hrMean !== null ? rollingAvg(hrHistory, ROLL_MS) : null;
    const gsrNow = baseline.gsrMean !== null ? rollingAvg(gsrHistory, ROLL_MS) : null;
    const gsrPrev = baseline.gsrMean !== null ? rollingAvg(gsrHistory, ROLL_MS * 2, ROLL_MS) : null;

    const hrRise = hrNow === null ? null : clamp((hrNow - baseline.hrMean) / Math.max(baseline.hrStd * 3, 15), 0, 1);
    let gsrResponse = null;
    if (gsrNow !== null) {
      const gsrLevel = clamp((gsrNow - baseline.gsrMean) / Math.max(baseline.gsrStd * 3, 40), 0, 1);
      const gsrSlope = gsrPrev !== null ? clamp((gsrNow - gsrPrev) / Math.max(baseline.gsrStd * 2, 25), 0, 1) : 0;
      gsrResponse = clamp(gsrSlope * 0.7 + gsrLevel * 0.3, 0, 1);
    }

    let arousalRaw;
    if (hrRise !== null && gsrResponse !== null) arousalRaw = clamp(0.55 * hrRise + 0.45 * gsrResponse, 0, 1) * 100;
    else if (hrRise !== null) arousalRaw = clamp(hrRise, 0, 1) * 100;
    else if (gsrResponse !== null) arousalRaw = clamp(gsrResponse, 0, 1) * 100;
    else arousalRaw = 0; // baseline exists but neither signal is reporting right now

    if (arousalRaw >= ELEVATED_THRESHOLD) sustainCount = Math.min(sustainCount + 1, SUSTAIN_SAMPLES);
    else sustainCount = 0;

    // A rise only counts once it's been sustained for SUSTAIN_SAMPLES ticks (rejects a single
    // noisy spike); a fall is never delayed, so the gauge still reads honestly moment to moment.
    if (sustainCount >= SUSTAIN_SAMPLES || arousalRaw < arousal) arousal = arousalRaw;

    if (arousal > peakArousal) peakArousal = arousal;

    resolveResponseWindows(now);

    const canFire = sustainCount >= SUSTAIN_SAMPLES && now - lastFiredAt >= COOLDOWN_MS;
    if (canFire) fire(now);

    return snapshot();
  }

  function pickTrigger() {
    if (totalFires < TRIGGERS.length) return TRIGGERS[totalFires % TRIGGERS.length];
    if (Math.random() < EXPLORE_CHANCE) return TRIGGERS[Math.floor(Math.random() * TRIGGERS.length)];
    return TRIGGERS.slice().sort((a, b) => triggerScores[b] - triggerScores[a])[0];
  }

  function fire(now) {
    const trigger = pickTrigger();
    const intensity = Number(clamp(0.5 * (arousal / 100) + 0.5 * triggerScores[trigger], 0, 1).toFixed(2));
    lastFiredAt = now;
    sustainCount = 0; // require a fresh sustained rise before this can fire again
    totalFires++;
    if (arousal >= peakArousal) peakArousalTrigger = trigger;

    const command = { activeTrigger: trigger, intensity, mode: "escalating", actions: [ACTION_BY_TRIGGER[trigger]] };
    const event = { trigger, firedAt: now, arousalAtFire: arousal, intensity };
    pendingWindows.push(event);
    log(`FIRE ${trigger} intensity=${intensity} arousal=${arousal.toFixed(0)} score=${triggerScores[trigger].toFixed(2)}`);
    onFire?.(command, event);
  }

  function resolveResponseWindows(now) {
    pendingWindows = pendingWindows.filter((w) => {
      const rose = arousal - w.arousalAtFire >= RESPONSE_RISE;
      if (rose) {
        triggerScores[w.trigger] = clamp(triggerScores[w.trigger] + SCORE_UP, 0, 1);
        log(`RESOLVE ${w.trigger} -> worked (arousal ${w.arousalAtFire.toFixed(0)} -> ${arousal.toFixed(0)}) score=${triggerScores[w.trigger].toFixed(2)}`);
        onResolve?.({ ...w, responseObserved: true, resolvedAt: now });
        return false;
      }
      if (now - w.firedAt >= RESPONSE_WINDOW_MS) {
        triggerScores[w.trigger] = clamp(triggerScores[w.trigger] - SCORE_DOWN, 0, 1);
        log(`RESOLVE ${w.trigger} -> no response, score=${triggerScores[w.trigger].toFixed(2)}`);
        onResolve?.({ ...w, responseObserved: false, resolvedAt: now });
        return false;
      }
      return true; // still inside its 8s window
    });
  }

  function snapshot() {
    return {
      calibrated: baseline !== null,
      calibration: calibrationStatus(),
      usingHeartRate: baseline?.hrMean != null,
      usingGsr: baseline?.gsrMean != null,
      arousal: Math.round(arousal),
      state: arousal >= 70 ? "HIGH" : arousal >= 35 ? "ELEVATED" : "CALM",
      triggerScores: { ...triggerScores },
      totalFires,
      peakArousal: Math.round(peakArousal),
      peakArousalTrigger,
      sessionStartedAt,
    };
  }

  return { ingest, startCalibration, tick, snapshot };
}
