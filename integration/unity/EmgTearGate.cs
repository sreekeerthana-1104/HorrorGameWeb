using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

// Attach once in your scene. It polls the ESP32 directly, so it also works on a Quest build.
public class EmgTearGate : MonoBehaviour
{
    [Tooltip("ESP32 address printed in the Arduino Serial Monitor. Quest and ESP32 must be on the same Wi-Fi.")]
    public string esp32StateUrl = "http://192.168.1.50/state";
    [Min(0.05f)] public float pollInterval = 0.05f;
    [Tooltip("Small network tolerance only. The ESP32 itself owns the two-second tear window.")]
    [Min(0.05f)] public float armedGraceSeconds = 0.15f;

    [Serializable] private class EmgState { public bool armed; public bool calibrated; public float envelope; public float threshold; }
    private float armedUntil;
    public bool IsCalibrated { get; private set; }
    public bool CanTear => IsCalibrated && Time.time <= armedUntil;

    private void OnEnable() => StartCoroutine(PollState());
    private IEnumerator PollState()
    {
        var wait = new WaitForSeconds(pollInterval);
        while (enabled)
        {
            using (var request = UnityWebRequest.Get(esp32StateUrl))
            {
                request.timeout = 2;
                yield return request.SendWebRequest();
                if (request.result == UnityWebRequest.Result.Success)
                {
                    var state = JsonUtility.FromJson<EmgState>(request.downloadHandler.text);
                    IsCalibrated = state.calibrated;
                    if (state.armed) armedUntil = Time.time + armedGraceSeconds;
                }
            }
            yield return wait;
        }
    }
}
