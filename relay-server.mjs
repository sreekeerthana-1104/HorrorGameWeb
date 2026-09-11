import http from "node:http";
import { Server } from "socket.io";

const port = Number(process.env.RELAY_PORT ?? 3001);
const esp32StateUrl = process.env.ESP32_STATE_URL ?? "http://192.168.1.50/state";
const pollMs = Math.max(50, Number(process.env.EMG_POLL_MS ?? 100));
const room = "emg-room";

let state = { armed: false, calibrated: false, envelope: 0, threshold: 0, connected: false, updatedAt: null, error: "Relay is starting" };
let isPolling = false;
let manualTearUntil = 0;

// --- request visibility so the pipeline can be debugged from this terminal, no headset logs needed ---
const stateClients = new Map(); // ip -> { count, lastSeen }
let lastClientReport = 0;

function noteStateRequest(ip) {
  const now = Date.now();
  const isNew = !stateClients.has(ip);
  const entry = stateClients.get(ip) ?? { count: 0, lastSeen: now };
  entry.count++;
  entry.lastSeen = now;
  stateClients.set(ip, entry);
  if (isNew) console.log(`[relay] NEW /emg/state poller: ${ip}`);
  if (now - lastClientReport > 2000) {
    lastClientReport = now;
    const active = [...stateClients.entries()]
      .filter(([, e]) => now - e.lastSeen < 5000)
      .map(([cip, e]) => `${cip} (${e.count})`);
    const s = currentState();
    console.log(`[relay] pollers(5s): ${active.length ? active.join(", ") : "NONE"} | serving armed=${s.armed} calibrated=${s.calibrated} manualTest=${s.manualTest}`);
  }
}

function currentState() {
  const testActive = Date.now() < manualTearUntil;
  return testActive
    ? { ...state, armed: true, calibrated: true, connected: true, manualTest: true, updatedAt: new Date().toISOString(), error: "" }
    : { ...state, manualTest: false };
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const ip = (request.headers["x-forwarded-for"]?.split(",")[0] ?? request.socket.remoteAddress ?? "?").replace(/^::ffff:/, "");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (url.pathname === "/emg/state") {
    noteStateRequest(ip);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(currentState()));
    return;
  }
  if (url.pathname === "/emg/test-tear" && request.method === "POST") {
    const requestedMs = Number(url.searchParams.get("durationMs") ?? 8000);
    const durationMs = Math.max(1000, Math.min(30000, Number.isFinite(requestedMs) ? requestedMs : 8000));
    manualTearUntil = Date.now() + durationMs;
    const responseState = currentState();
    console.log(`[relay] TEST-TEAR from ${ip}: forcing armed=true for ${durationMs}ms`);
    publish();
    setTimeout(publish, durationMs + 20);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, durationMs, state: responseState }));
    return;
  }
  if (url.pathname === "/health") {
    response.writeHead(state.connected ? 200 : 503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: state.connected, esp32StateUrl }));
    return;
  }
  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: "Not found. Use /emg/state or /health." }));
});

const io = new Server(server, { cors: { origin: "*" } });

function publish() { io.to(room).emit("emg:state", currentState()); }

io.on("connection", (socket) => {
  socket.join(room);
  socket.emit("emg:state", currentState());
});

async function pollEsp32() {
  if (isPolling) return;
  isPolling = true;
  const wasConnected = state.connected;
  const wasArmed = state.armed;
  try {
    const response = await fetch(esp32StateUrl, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw new Error(`ESP32 returned HTTP ${response.status}`);
    const emg = await response.json();
    state = { armed: Boolean(emg.armed), calibrated: Boolean(emg.calibrated), envelope: Number(emg.envelope) || 0, threshold: Number(emg.threshold) || 0, connected: true, updatedAt: new Date().toISOString(), error: "" };
    if (!wasConnected) console.log(`[relay] ESP32 connected (${esp32StateUrl})`);
    if (state.armed !== wasArmed) console.log(`[relay] ESP32 armed -> ${state.armed} (envelope ${state.envelope.toFixed(0)} / threshold ${state.threshold.toFixed(0)})`);
  } catch (error) {
    state = { ...state, armed: false, connected: false, updatedAt: new Date().toISOString(), error: error.message };
    if (wasConnected) console.log(`[relay] ESP32 DISCONNECTED: ${error.message}`);
  } finally {
    isPolling = false;
  }
  publish();
}

server.listen(port, "0.0.0.0", () => {
  console.log(`EMG relay listening on http://0.0.0.0:${port}`);
  console.log(`Polling ESP32 at ${esp32StateUrl}`);
  pollEsp32();
  setInterval(pollEsp32, pollMs);
});
