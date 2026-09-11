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

These are wired and streaming to the dashboard now (`heartRate`, `fingerDetected`, `gsr` in the same
`/state` JSON and WebSocket packets), showing real numbers only — no arousal scoring, baseline,
or fear-profile logic yet. That's intentional; it gets built in later steps, per the adaptive
fear engine plan (calibration/arousal, then event tagging, then the fear profile).

- Heart rate comes from a simple beat-detector on the MAX30102's IR channel: a slow low-pass
  tracks the "no pulse" baseline, and a beat is counted each time the signal above that baseline
  crosses upward through zero. It's tuned for a live BPM readout, not medical-grade accuracy.
  Reports `0` (and `fingerDetected:false`) until a finger is actually on the sensor.
- GSR is the Grove sensor's raw analog reading, smoothed with a simple moving average — not yet
  converted to microsiemens or normalized to a personal baseline.
- If the dashboard shows "MAX30102 not detected," check the Serial Monitor at boot and the I2C
  wiring; the firmware keeps running fine without it, heart rate just stays at 0.
