# BioAmp → web dashboard → Quest setup

1. In Arduino IDE, install **ESPAsyncWebServer**, **AsyncTCP**, and **SparkFun MAX3010x Pulse and Proximity Sensor Library** (Library Manager, search "MAX3010x"). Open `esp32/EmgTearBridge.ino`.
2. Duplicate `esp32/secrets.example.h` as `esp32/secrets.h`, and enter the ESP32's 2.4 GHz Wi-Fi credentials. Do not commit `secrets.h`.
3. Wiring: BioAmp analog output → GPIO 34; Grove GSR analog output → GPIO 35; MAX30102 → I2C (SDA → GPIO 21, SCL → GPIO 22, VIN → 3V3). Share ground across all of them, upload, then open Serial Monitor at 115200 to confirm "MAX30102 detected" and note the printed IP address.
4. Start this dashboard with `npm run dev`. Keep it on **HTTP** while using `ws://` to the ESP32; an HTTPS-hosted page will block insecure WebSockets.
5. On first page load, enter `ws://ESP32_IP/ws`, click **Connect ESP32**, then **Start calibration**. Relax for five seconds, then follow three deliberate prompts: squeeze firmly for three seconds, release for three seconds, and repeat. The ESP32 gives priority to the stronger rising/high values from those squeezes.
6. Follow `unity/HeadTearEmgChanges.md` in the Unity project. Put Quest and ESP32 on the same LAN.

The ESP32 is the source of truth. It reports `armed` as a live level gate: `armed` is true for as long as the calibrated squeeze stays above threshold (rise past `threshold` to arm, fall below `releaseThreshold` to disarm, 3-sample debounce), and false again the moment you relax — no latch, no two-second window, no wait-for-release. Grabbing the head in Unity tears it only while `armed` is true. The BOOT button still forces `armed` on for two seconds for wiring tests. The browser only controls calibration and shows telemetry; Unity polls `http://ESP32_IP/state`, so closing the dashboard does not make the Quest connection fail after calibration.

## Optional laptop relay (ESP32 → laptop → Unity/Quest)

Use this when a Quest cannot reliably reach the ESP32 directly. In `.env.local`, set `ESP32_STATE_URL` to the current ESP32 address, then run `npm run relay`. The relay listens on port 3001, polls the ESP32, broadcasts `emg:state` over Socket.IO, and also provides `GET /emg/state` for Unity's built-in HTTP client.

Find the laptop's Wi-Fi IPv4 address and, in Unity's `EmgTearGate`, enable **Use Laptop Relay** and set **Laptop Relay State Url** to `http://LAPTOP_WIFI_IP:3001/emg/state`. Do not use `localhost` on a Quest: it refers to the Quest itself. Visit `http://LAPTOP_WIFI_IP:3001/health` from another device to confirm the relay can reach the ESP32.

Calibration intentionally rejects a run where the squeeze is too close to rest. Re-seat electrodes, keep cables still, and calibrate again. This is more dependable than a fixed threshold, but no EMG threshold can be guaranteed until it is tested with the actual electrode placement, person, and controller strap.

## Heart rate (MAX30102) and skin response (Grove GSR)

These are wired and streaming to the dashboard (`heartRate`, `fingerDetected`, `gsr` in the same
`/state` JSON and WebSocket packets). The arousal/fear-profile engine described below consumes
them; the dashboard's own biometric cards show the raw numbers regardless of whether the engine
is calibrated.

- Heart rate comes from a simple beat-detector on the MAX30102's IR channel: a slow low-pass
  tracks the "no pulse" baseline, and a beat is counted each time the signal above that baseline
  crosses upward through zero. It's tuned for a live BPM readout, not medical-grade accuracy.
  Reports `0` (and `fingerDetected:false`) until a finger is actually on the sensor.
- GSR is the Grove sensor's raw analog reading, smoothed with a simple moving average — not yet
  converted to microsiemens; the fear engine normalizes it against your own baseline instead.
- If the dashboard shows "MAX30102 not detected," check the Serial Monitor at boot and the I2C
  wiring; the firmware keeps running fine without it, heart rate just stays at 0.

## Adaptive fear engine (heart rate + GSR → scripted Unity scares)

Lives in `fear-engine.mjs` (pure scoring logic) wired into `relay-server.mjs` (data source +
Unity command channel + dashboard broadcast). No LLM, no bandit math — a rolling baseline,
`arousal = 0.55*HR_rise + 0.45*GSR_response`, a sustained-elevation gate before escalating, and a
rotate-then-bias picker across three triggers (`footsteps`, `flicker_lights`, `play_scream`) that
tracks which one actually raises *this* player's arousal.

**Dashboard flow:** the "Live arousal" card gates on consent (a real checkbox action, nothing
fires without it) → "Start baseline capture" (~45s, sit still) → then shows live arousal,
state, and the fear-profile bars. `POST /fear/baseline/start` on the relay kicks off capture;
`fear:state` / `fear:event` over the existing Socket.IO connection drive everything live,
no polling on the browser side.

**Unity side:** new `FearEngineClient.cs` — **HTTP polling** of `GET /fear/command` via
`UnityWebRequest` (same proven pattern as `EmgTearGate`), not a WebSocket. On Quest/IL2CPP,
`System.Net.WebSockets.ClientWebSocket` has a real history of breaking (`PlatformNotSupportedException`);
given how much of this session went into getting *any* Unity networking reliable on this exact
device, polling was the safer call. Attach `FearEngineClient` once in the scene (e.g. alongside
`EmgTearBridge`), set **Command Url** to `http://LAPTOP_WIFI_IP:3001/fear/command`, and it'll find
`ZombieAudio`/`LightFlicker` automatically if left unassigned.

- `play_footsteps` / `play_scream` → `ZombieAudio.PlayFootstep()` / `PlayScream()` (new). Both
  now take an optional `intensity` (0-1) that scales playback volume. `PlayScream()` uses a new
  `scareClips[]` array if you've assigned one, else falls back to `attackClips` — no new audio
  required to try it.
- `flicker_lights` → new `LightFlicker.cs`. Drag the scene's tuned Point lights into its
  `lights` array; it captures their baseline intensity once and always restores it exactly —
  never a permanent lighting change. `intensity` scales flicker duration and how far the dip
  goes.
- If nothing fires: check `/fear/state` on the relay for `calibrated` and `arousal`, and the
  relay's own terminal for `[fear] ...` log lines (heartbeat-style, prints on every
  fire/resolve/decay).

**Supabase:** the *browser* does the writes (anonymous sign-in via the anon key, so RLS applies
as a real user — no service-role key anywhere in this app). See `lib/supabase.ts` and
`hooks/use-fear-engine.ts`. Table/column names (`game_sessions.player_id/started_at/ended_at/
consent_given/peak_arousal/session_summary`, `trigger_events.game_session_id/trigger_type/
fired_at/intensity/arousal_at_fire/response_observed`) are inferred from the spec, not verified
against the live schema — worth a quick check against the real tables before trusting it
persists correctly. Writes are all best-effort (try/caught, logged, never break the live
session) specifically because of that uncertainty. There's also no explicit "end session" button
anymore, so `game_sessions` gets updated on a 60s interval plus once when the tab is hidden, as
a stand-in for a real session-end event.
