

#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#define WIFI_SSID "Aryan"
#define WIFI_PASSWORD "123456789"

#define SAMPLE_RATE 500
#define INPUT_PIN 34       // ADC1 pin
#define BUFFER_SIZE 64
#define PUBLISH_MS 50      // 20 state updates/sec for the web UI and Unity polling.
#define RELAX_MS 5000
#define SQUEEZE_MS 3000
#define RELEASE_MS 3000
#define SQUEEZE_CYCLES 3
#define TEAR_WINDOW_MS 2000
#define CALIBRATION_SAMPLES 140

AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

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
  return String("{\"type\":\"emg\",\"envelope\":") + String(envelope, 1) + ",\"baseline\":" + String(baseline, 1) + ",\"threshold\":" + String(threshold, 1) + ",\"armed\":" + (armed ? "true" : "false") + ",\"calibrated\":" + (calibrated ? "true" : "false") + "}";
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

void onWsEvent(AsyncWebSocket *, AsyncWebSocketClient *, AwsEventType type, void *, uint8_t *data, size_t len) {
  if (type != WS_EVT_DATA) return;
  String command;
  for (size_t i = 0; i < len; i++) command += (char)data[i];
  if (command.indexOf("startCalibration") >= 0) {
    calibrated = false; armed = false; waitingForRelease = releasedSinceArm = false; tearWindowUntil = 0;
    aboveCount = belowCount = 0; relaxCount = squeezeCount = completedCycles = 0;
    calibrationPhase = RELAX; phaseStartedAt = millis();
    sendCalibrationStatus();
  }
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print('.'); }
  Serial.print("\nESP32 IP: "); Serial.println(WiFi.localIP());
  ws.onEvent(onWsEvent);
  server.addHandler(&ws);
  server.on("/state", HTTP_GET, [](AsyncWebServerRequest *request) { request->send(200, "application/json", stateJson()); });
  server.begin();
}

void loop() {
  static unsigned long lastSampleAt = 0;
  unsigned long now = micros();
  if (now - lastSampleAt >= 1000000UL / SAMPLE_RATE) {
    lastSampleAt += 1000000UL / SAMPLE_RATE;
    envelope = getEnvelope(abs((int)EMGFilter(analogRead(INPUT_PIN))));
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

  if (!calibrated) {
    armed = false;
  } else if (armed) {
    // Once opened, the interaction stays available for exactly two seconds even if EMG dips.
    if (envelope <= releaseThreshold) {
      belowCount++;
      if (belowCount >= 3) releasedSinceArm = true;
    } else {
      belowCount = 0;
    }

    if (millis() >= tearWindowUntil) {
      armed = false;
      waitingForRelease = !releasedSinceArm;
      aboveCount = belowCount = 0;
    }
  } else if (waitingForRelease) {
    // A long continuous squeeze must be released before it can create another tear window.
    if (envelope <= releaseThreshold) {
      belowCount++;
      if (belowCount >= 3) {
        waitingForRelease = false;
        belowCount = 0;
      }
    } else {
      belowCount = 0;
    }
  } else {
    // A deliberate, sustained threshold crossing opens one new two-second tear window.
    if (envelope >= threshold) {
      aboveCount++;
      if (aboveCount >= 3) {
        armed = true;
        tearWindowUntil = millis() + TEAR_WINDOW_MS;
        releasedSinceArm = false;
        aboveCount = belowCount = 0;
      }
    } else {
      aboveCount = 0;
    }
  }
  ws.textAll(stateJson());
  ws.cleanupClients();
}
