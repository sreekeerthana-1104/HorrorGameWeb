using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;

// Attach once in your scene. It polls the ESP32 directly, so it also works on a Quest build.
public class EmgTearGate : MonoBehaviour
{
    [Tooltip("ESP32 address printed in the Arduino Serial Monitor. Used when Use Laptop Relay is disabled.")]
    public string esp32StateUrl = "http://192.168.1.50/state";
    [Tooltip("When enabled, Unity polls the laptop relay instead of the ESP32 directly. The laptop must run npm run relay and be reachable from the Quest.")]
    public bool useLaptopRelay = false;
    [Tooltip("Use the laptop Wi-Fi IPv4 address, never localhost, e.g. http://192.168.1.5:3001/emg/state.")]
    public string laptopRelayStateUrl = "http://192.168.1.5:3001/emg/state";
    [Min(0.05f)] public float pollInterval = 0.05f;
    [Tooltip("Small network tolerance only. The ESP32 itself owns the two-second tear window.")]
    [Min(0.05f)] public float armedGraceSeconds = 0.15f;

    [Serializable] private class EmgState { public bool armed; public bool calibrated; public bool connected; public bool manualTest; public float envelope; public float threshold; public string error; }
    private float armedUntil;
    [Header("Runtime debug (visible only while Play Mode is running)")]
    [Tooltip("True means Unity can reach the ESP32 and it has a saved calibration.")]
    public bool isCalibrated;
    [Tooltip("True only during the ESP32's two-second tear window.")]
    public bool canTear;
    public float lastEnvelope;
    public float lastThreshold;
    [TextArea] public string connectionStatus = "Waiting to poll ESP32...";
    [TextArea] public string relayError = "";

    public bool IsCalibrated { get; private set; }
    public bool CanTear => canTear;
    private bool previousArmed;
    private string previousError;
    private string lastGoodUrl;

    private void OnEnable()
    {
        connectionStatus = "Polling EMG source...";
        StartCoroutine(PollState());
    }

    // Preferred endpoint first, then the other one as an automatic fallback, so a wrong
    // "Use Laptop Relay" toggle (or a relay that just isn't running yet) can't silently
    // break the whole tear pipeline.
    private List<string> CandidateUrls()
    {
        var list = new List<string>();
        void Add(string url)
        {
            if (!string.IsNullOrEmpty(url) && !list.Contains(url)) list.Add(url);
        }
        Add(lastGoodUrl);
        if (useLaptopRelay) { Add(laptopRelayStateUrl); Add(esp32StateUrl); }
        else { Add(esp32StateUrl); Add(laptopRelayStateUrl); }
        return list;
    }

    private IEnumerator PollState()
    {
        var wait = new WaitForSeconds(pollInterval);
        while (enabled)
        {
            bool handled = false;

            foreach (var url in CandidateUrls())
            {
                using (var request = UnityWebRequest.Get(url))
                {
                    request.timeout = 2;
                    yield return request.SendWebRequest();

                    if (request.result != UnityWebRequest.Result.Success)
                    {
                        if (request.error != previousError)
                        {
                            Debug.LogWarning($"[EmgTearGate] Cannot reach {url}: {request.error}");
                            previousError = request.error;
                        }
                        continue; // try the next candidate URL within this same poll cycle
                    }

                    EmgState state = null;
                    try { state = JsonUtility.FromJson<EmgState>(request.downloadHandler.text); }
                    catch { /* handled by the null check below */ }

                    if (state == null)
                    {
                        Debug.LogWarning($"[EmgTearGate] Unparseable state from {url}: {request.downloadHandler.text}");
                        continue;
                    }

                    bool isRelayUrl = url == laptopRelayStateUrl;
                    if (isRelayUrl && !state.connected)
                    {
                        relayError = string.IsNullOrEmpty(state.error) ? "Relay has no ESP32 connection." : state.error;
                        if (relayError != previousError)
                        {
                            Debug.LogWarning($"[EmgTearGate] {url}: {relayError}");
                            previousError = relayError;
                        }
                        continue; // relay is up but the ESP32 isn't — fall through to the direct URL
                    }

                    lastGoodUrl = url;
                    handled = true;
                    relayError = "";
                    previousError = null;

                    IsCalibrated = state.calibrated;
                    isCalibrated = state.calibrated;
                    lastEnvelope = state.envelope;
                    lastThreshold = state.threshold;
                    if (state.armed) armedUntil = Time.time + armedGraceSeconds;
                    canTear = IsCalibrated && Time.time <= armedUntil;

                    string via = isRelayUrl ? "laptop relay" : "ESP32 direct";
                    connectionStatus = state.manualTest
                        ? $"Laptop test tear window active (via {via})"
                        : state.armed
                            ? $"Tear window active (via {via})"
                        : IsCalibrated
                            ? $"Connected, calibrated — waiting for squeeze (via {via})"
                            : $"Connected — calibration required (via {via})";

                    if (state.armed != previousArmed)
                    {
                        Debug.Log($"[EmgTearGate] armed -> {state.armed} | calibrated: {state.calibrated} | " +
                                  $"envelope: {state.envelope:F1} | threshold: {state.threshold:F1} | " +
                                  $"CanTear: {canTear} | via {via}");
                        previousArmed = state.armed;
                    }

                    break; // got a usable state this cycle, stop trying candidates
                }
            }

            if (!handled)
            {
                IsCalibrated = false;
                isCalibrated = false;
                canTear = false;
                lastGoodUrl = null;
                connectionStatus = "No EMG source reachable (tried ESP32 direct and laptop relay).";
            }

            canTear = IsCalibrated && Time.time <= armedUntil;
            yield return wait;
        }
    }
}
