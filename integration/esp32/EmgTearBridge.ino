

// Heart rate (MAX30102, I2C) needs the "SparkFun MAX3010x Pulse and Proximity
// Sensor Library" installed via Arduino Library Manager (search: MAX3010x).
// Wiring: MAX30102 VIN->3V3, GND->GND, SDA->GPIO21, SCL->GPIO22 (ESP32 default I2C pins).
// Grove GSR is a plain analog sensor: its signal pin -> GPIO35 (any free ADC1 pin), VCC/GND as usual.
#include <WiFi.h>
#include <esp_system.h>
#include <ESPAsyncWebServer.h>
#include <Wire.h>
#include "MAX30105.h"
#define WIFI_SSID "Aryan"
#define WIFI_PASSWORD "123456789"

#define SAMPLE_RATE 500
#define INPUT_PIN 34       // ADC1 pin
#define GSR_PIN 35         // ADC1 pin. Grove GSR sensor's analog output.
#define BUFFER_SIZE 64
#define PUBLISH_MS 50      // 20 state updates/sec for the web UI and Unity polling.
#define RELAX_MS 5000
#define SQUEEZE_MS 3000
#define RELEASE_MS 3000
#define SQUEEZE_CYCLES 3
#define TEAR_WINDOW_MS 2000
#define TEST_TEAR_BUTTON 0  // ESP32 BOOT button (GPIO 0). Temporary communication-test trigger.
#define CALIBRATION_SAMPLES 140
#define HR_SAMPLE_MS 20     // ~50Hz IR sampling for beat detection.
#define GSR_SAMPLE_MS 50    // ~20Hz. GSR changes slowly, no need to sample faster.
#define IR_FINGER_THRESHOLD 50000  // Below this raw IR reading, treat as "no finger on sensor."

AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// --- MAX30102 heart rate ---
MAX30105 particleSensor;
bool maxSensorFound = false;
float irDcBaseline = 0;
bool irDcInitialized = false;
float irAc = 0;
bool irAcRising = false;
unsigned long lastBeatAt = 0;
float beatIntervalsMs[4] = {0, 0, 0, 0};
uint8_t beatIntervalIndex = 0;
uint8_t beatIntervalCount = 0;
float heartRateBpm = 0;
bool fingerDetected = false;

// --- Grove GSR ---
float gsrFiltered = 0;

int circularBuffer[BUFFER_SIZE] = {0};
int dataIndex = 0;
long envelopeSum = 0;
float envelope = 0;
float baseline = 0;
float threshold = 0;
float releaseThreshold = 0;
bool calibrated = false;
bool armed = false;
bool waitingForRelease = false;
bool releasedSinceArm = false;
unsigned long tearWindowUntil = 0;
uint8_t aboveCount = 0;
uint8_t belowCount = 0;

enum CalibrationPhase { IDLE, RELAX, SQUEEZE, RELEASE, COMPLETE };
CalibrationPhase calibrationPhase = IDLE;
unsigned long phaseStartedAt = 0;
unsigned long lastPublishAt = 0;
float relaxSamples[CALIBRATION_SAMPLES];
float squeezeSamples[CALIBRATION_SAMPLES];
int relaxCount = 0;
int squeezeCount = 0;
int completedCycles = 0;
unsigned long lastWifiCheckAt = 0;
unsigned long lastWifiAttemptAt = 0;
bool wifiWasConnected = false;

const char *phaseName();

const char *wifiStatusName(wl_status_t status) {
  switch (status) {
    case WL_IDLE_STATUS: return "idle";
    case WL_NO_SSID_AVAIL: return "network not found";
    case WL_SCAN_COMPLETED: return "scan completed";
    case WL_CONNECTED: return "connected";
    case WL_CONNECT_FAILED: return "connection failed";
    case WL_CONNECTION_LOST: return "connection lost";
    case WL_DISCONNECTED: return "disconnected";
    default: return "unknown";
  }
}

const char *resetReasonName(esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_POWERON: return "power-on";
    case ESP_RST_EXT: return "external reset / EN button";
    case ESP_RST_SW: return "software reset";
    case ESP_RST_PANIC: return "panic (crash)";
    case ESP_RST_INT_WDT: return "interrupt watchdog";
    case ESP_RST_TASK_WDT: return "task watchdog";
    case ESP_RST_WDT: return "other watchdog";
    case ESP_RST_BROWNOUT: return "brownout (power voltage dropped)";
    case ESP_RST_SDIO: return "SDIO reset";
    default: return "unknown";
  }
}

void keepWifiConnected() {
  if (millis() - lastWifiCheckAt < 5000) return;
  lastWifiCheckAt = millis();

  wl_status_t status = WiFi.status();
  if (status == WL_CONNECTED) {
    if (!wifiWasConnected) {
      wifiWasConnected = true;
      Serial.print("Wi-Fi connected. ESP32 IP: ");
      Serial.println(WiFi.localIP());
    }
    return;
  }

  wifiWasConnected = false;
  // WiFi.begin() while the driver is already connecting produces
  // "sta is connecting, cannot set config" and can make reconnects less reliable.
  if (millis() - lastWifiAttemptAt < 15000) {
    Serial.print("Wi-Fi still connecting: ");
    Serial.println(wifiStatusName(status));
    return;
  }

  lastWifiAttemptAt = millis();
  if (status == WL_IDLE_STATUS) {
    Serial.println("Wi-Fi connection stalled -> reconnecting...");
    WiFi.reconnect();
    return;
  }

  Serial.print("Wi-Fi not connected: ");
  Serial.print(wifiStatusName(status));
  Serial.println(" -> retrying...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

// One IR read + a simple DC-removal beat detector: a slow low-pass tracks the
// "no pulse" baseline, the fast-varying part above/below that baseline is the
// pulse itself, and a beat is counted each time that pulse crosses upward
// through zero (with a refractory period so one beat can't be double-counted).
// This is intentionally simple — good enough for a live BPM readout, not a
// medical-grade HRV measurement.
void sampleHeartRate() {
  long irValue = particleSensor.getIR();
  fingerDetected = irValue > IR_FINGER_THRESHOLD;
  if (!fingerDetected) {
    irDcInitialized = false;
    heartRateBpm = 0;
    beatIntervalCount = 0;
    return;
  }

  if (!irDcInitialized) { irDcBaseline = irValue; irDcInitialized = true; }
  irDcBaseline += (irValue - irDcBaseline) * 0.02f;
  float instantAc = irValue - irDcBaseline;
  irAc += (instantAc - irAc) * 0.3f;

  bool rising = irAc > 0;
  unsigned long now = millis();
  if (rising && !irAcRising && (now - lastBeatAt) > 250) {
    if (lastBeatAt != 0) {
      float intervalMs = now - lastBeatAt;
      beatIntervalsMs[beatIntervalIndex] = intervalMs;
      beatIntervalIndex = (beatIntervalIndex + 1) % 4;
      if (beatIntervalCount < 4) beatIntervalCount++;
      float avgMs = 0;
      for (uint8_t i = 0; i < beatIntervalCount; i++) avgMs += beatIntervalsMs[i];
      avgMs /= beatIntervalCount;
      float bpm = 60000.0f / avgMs;
      if (bpm >= 35 && bpm <= 220) heartRateBpm = bpm;  // reject obvious misfires
    }
    lastBeatAt = now;
  }
  irAcRising = rising;
}

void sampleGsr() {
  gsrFiltered += (analogRead(GSR_PIN) - gsrFiltered) * 0.1f;  // simple EMA smoothing
}

float EMGFilter(float input) {
  float output = input;
  { static float z1, z2; float x = output - 0.05159732*z1 - 0.36347401*z2; output = 0.01856301*x + 0.03712602*z1 + 0.01856301*z2; z2 = z1; z1 = x; }
  { static float z1, z2; float x = output + 0.53945795*z1 - 0.39764934*z2; output = x - 2.0*z1 + z2; z2 = z1; z1 = x; }
  { static float z1, z2; float x = output - 0.47319594*z1 - 0.70744137*z2; output = x + 2.0*z1 + z2; z2 = z1; z1 = x; }
  { static float z1, z2; float x = output + 1.00211112*z1 - 0.74520226*z2; output = x - 2.0*z1 + z2; z2 = z1; z1 = x; }
  return output;
}

float getEnvelope(int absoluteEmg) {
  envelopeSum -= circularBuffer[dataIndex];
  envelopeSum += absoluteEmg;
  circularBuffer[dataIndex] = absoluteEmg;
  dataIndex = (dataIndex + 1) % BUFFER_SIZE;
  return (envelopeSum / (float)BUFFER_SIZE) * 2.0f;
}

float percentile(float *values, int count, float fraction) {
  if (count == 0) return 0;
  for (int i = 1; i < count; i++) { float value = values[i]; int j = i - 1; while (j >= 0 && values[j] > value) { values[j + 1] = values[j]; j--; } values[j + 1] = value; }
  return values[(int)((count - 1) * fraction)];
}

const char *phaseName() { return calibrationPhase == RELAX ? "relax" : calibrationPhase == SQUEEZE ? "squeeze" : calibrationPhase == RELEASE ? "release" : calibrationPhase == COMPLETE ? "complete" : "idle"; }

String stateJson() {
  unsigned long duration = calibrationPhase == RELAX ? RELAX_MS : calibrationPhase == SQUEEZE ? SQUEEZE_MS : RELEASE_MS;
  float remaining = calibrationPhase == IDLE || calibrationPhase == COMPLETE ? 0 : max(0L, (long)(duration - (millis() - phaseStartedAt))) / 1000.0f;
  return String("{\"type\":\"emg\",\"envelope\":") + String(envelope, 1) + ",\"baseline\":" + String(baseline, 1) + ",\"threshold\":" + String(threshold, 1) + ",\"armed\":" + (armed ? "true" : "false") + ",\"calibrated\":" + (calibrated ? "true" : "false") + ",\"phase\":\"" + phaseName() + "\",\"remaining\":" + String(remaining, 1) +
         ",\"heartRate\":" + String(heartRateBpm, 1) + ",\"fingerDetected\":" + (fingerDetected ? "true" : "false") + ",\"maxSensorFound\":" + (maxSensorFound ? "true" : "false") +
         ",\"gsr\":" + String(gsrFiltered, 1) +
         ",\"connected\":true}";
}

void sendCalibrationStatus() {
  unsigned long duration = calibrationPhase == RELAX ? RELAX_MS : calibrationPhase == SQUEEZE ? SQUEEZE_MS : RELEASE_MS;
  float remaining = calibrationPhase == IDLE || calibrationPhase == COMPLETE ? 0 : max(0L, (long)(duration - (millis() - phaseStartedAt))) / 1000.0f;
  ws.textAll(String("{\"type\":\"calibration\",\"phase\":\"") + phaseName() + "\",\"remaining\":" + String(remaining, 1) + "}");
}

void finishCalibration() {
  // Median rest + upper repeated-squeeze level gives priority to the strong rising/high part of each grip.
  baseline = percentile(relaxSamples, relaxCount, 0.50f);
  float restHigh = percentile(relaxSamples, relaxCount, 0.90f);
  float squeezeLevel = percentile(squeezeSamples, squeezeCount, 0.80f);
  float separation = squeezeLevel - baseline;
  if (separation < 12.0f || separation < (restHigh - baseline) * 3.0f) {
    calibrationPhase = IDLE;
    ws.textAll("{\"type\":\"error\",\"message\":\"Squeeze was not clearly above rest. Check electrode contact, then calibrate again.\"}");
    return;
  }
  threshold = max(baseline + separation * 0.40f, restHigh + 4.0f);
  releaseThreshold = max(baseline + separation * 0.25f, restHigh + 2.0f); // hysteresis prevents flicker.
  calibrated = true;
  calibrationPhase = COMPLETE;
  ws.textAll(String("{\"type\":\"calibrationComplete\",\"baseline\":") + String(baseline, 1) + ",\"threshold\":" + String(threshold, 1) + "}");
}

void startCalibration() {
  calibrated = false; armed = false; waitingForRelease = releasedSinceArm = false; tearWindowUntil = 0;
  aboveCount = belowCount = 0; relaxCount = squeezeCount = completedCycles = 0;
  calibrationPhase = RELAX; phaseStartedAt = millis();
  sendCalibrationStatus();
  Serial.println("Calibration started");
}

void onWsEvent(AsyncWebSocket *, AsyncWebSocketClient *, AwsEventType type, void *, uint8_t *data, size_t len) {
  if (type != WS_EVT_DATA) return;
  String command;
  for (size_t i = 0; i < len; i++) command += (char)data[i];
  if (command.indexOf("startCalibration") >= 0) startCalibration();
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.print("ESP32 booted. Reset reason: ");
  Serial.println(resetReasonName(esp_reset_reason()));
  analogReadResolution(12);
  pinMode(TEST_TEAR_BUTTON, INPUT_PULLUP);

  Wire.begin();
  maxSensorFound = particleSensor.begin(Wire, I2C_SPEED_FAST);
  if (maxSensorFound) {
    particleSensor.setup();
    particleSensor.setPulseAmplitudeRed(0x0A);
    particleSensor.setPulseAmplitudeGreen(0);
    Serial.println("MAX30102 detected and configured.");
  } else {
    Serial.println("MAX30102 not detected — heart rate will report 0. Check wiring (SDA=21, SCL=22).");
  }

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false); // Keep the radio awake; helpful for real-time hotspot telemetry.
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttemptAt = millis();
  Serial.print("Connecting to Wi-Fi in the background (SSID: ");
  Serial.print(WIFI_SSID);
  Serial.println(")...");
  ws.onEvent(onWsEvent);
  server.addHandler(&ws);
  server.on("/state", HTTP_GET, [](AsyncWebServerRequest *request) {
    AsyncWebServerResponse *response = request->beginResponse(200, "application/json", stateJson());
    response->addHeader("Access-Control-Allow-Origin", "*");
    request->send(response);
  });
  server.on("/calibrate", HTTP_POST, [](AsyncWebServerRequest *request) {
    startCalibration();
    AsyncWebServerResponse *response = request->beginResponse(200, "application/json", stateJson());
    response->addHeader("Access-Control-Allow-Origin", "*");
    request->send(response);
  });
  server.begin();
  Serial.println("HTTP server started. Waiting for Wi-Fi connection...");
}

void loop() {
  keepWifiConnected();

  static unsigned long lastSampleAt = 0;
  unsigned long now = micros();
  if (now - lastSampleAt >= 1000000UL / SAMPLE_RATE) {
    lastSampleAt += 1000000UL / SAMPLE_RATE;
    envelope = getEnvelope(abs((int)EMGFilter(analogRead(INPUT_PIN))));
  }

  static unsigned long lastHrSampleAt = 0;
  if (maxSensorFound && millis() - lastHrSampleAt >= HR_SAMPLE_MS) {
    lastHrSampleAt = millis();
    sampleHeartRate();
  }

  static unsigned long lastGsrSampleAt = 0;
  if (millis() - lastGsrSampleAt >= GSR_SAMPLE_MS) {
    lastGsrSampleAt = millis();
    sampleGsr();
  }

  if (millis() - lastPublishAt < PUBLISH_MS) return;
  lastPublishAt = millis();

  if (calibrationPhase == RELAX) {
    if (relaxCount < CALIBRATION_SAMPLES) relaxSamples[relaxCount++] = envelope;
    if (millis() - phaseStartedAt >= RELAX_MS) { calibrationPhase = SQUEEZE; phaseStartedAt = millis(); }
    sendCalibrationStatus();
  } else if (calibrationPhase == SQUEEZE) {
    if (squeezeCount < CALIBRATION_SAMPLES) squeezeSamples[squeezeCount++] = envelope;
    if (millis() - phaseStartedAt >= SQUEEZE_MS) { calibrationPhase = RELEASE; phaseStartedAt = millis(); }
    sendCalibrationStatus();
  } else if (calibrationPhase == RELEASE) {
    if (millis() - phaseStartedAt >= RELEASE_MS) {
      completedCycles++;
      if (completedCycles >= SQUEEZE_CYCLES) finishCalibration();
      else { calibrationPhase = SQUEEZE; phaseStartedAt = millis(); }
    }
    sendCalibrationStatus();
  }

  // Live level gate: the tear is available for as long as the squeeze stays above threshold,
  // and stops being available the moment you relax. No latch, no wait-for-release.
  // Hysteresis (rise past `threshold` to arm, fall below `releaseThreshold` to disarm) plus a
  // 3-sample debounce keeps it from chattering on noise.
  if (!calibrated) {
    armed = false;
  } else if (!armed) {
    if (envelope >= threshold) {
      if (++aboveCount >= 3) { armed = true; belowCount = 0; }
    } else {
      aboveCount = 0;
    }
  } else {
    if (envelope <= releaseThreshold) {
      if (++belowCount >= 3) { armed = false; aboveCount = 0; }
    } else {
      belowCount = 0;
    }
  }

  // The BOOT test button forces `armed` on for two seconds regardless of EMG, so the
  // ESP32 -> Unity path can still be checked without electrodes (works even pre-calibration).
  if (millis() < tearWindowUntil) armed = true;

  // Temporary communication test: one BOOT press opens the same two-second window as a strong EMG squeeze.
  // Use EN only to reset the ESP32; it is not a readable input button.
  static bool wasBootPressed = false;
  bool bootPressed = digitalRead(TEST_TEAR_BUTTON) == LOW;
  if (bootPressed && !wasBootPressed)
  {
    armed = true;
    tearWindowUntil = millis() + TEAR_WINDOW_MS;
    aboveCount = belowCount = 0;
    Serial.println("BOOT pressed -> 2-second tear window opened");
    Serial.println(stateJson());
  }
  wasBootPressed = bootPressed;

  ws.textAll(stateJson());
  ws.cleanupClients();
}
