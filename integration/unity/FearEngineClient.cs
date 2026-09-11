using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

/// <summary>
/// Polls the laptop relay's GET /fear/command endpoint and dispatches fear-engine commands to
/// ZombieAudio / LightFlicker. Deliberately HTTP polling via UnityWebRequest, not a WebSocket --
/// same pattern as EmgTearGate, which is the one thing proven reliable on this project's exact
/// Quest/IL2CPP build pipeline. System.Net.WebSockets.ClientWebSocket has a known history of
/// breaking under IL2CPP on Android; not worth the risk for a hackathon demo.
/// Attach once in the scene, e.g. alongside EmgTearBridge.
/// </summary>
public class FearEngineClient : MonoBehaviour
{
    [Tooltip("Laptop relay's command endpoint. Use the laptop's Wi-Fi IPv4 address, never " +
             "localhost, e.g. http://192.168.1.5:3001/fear/command.")]
    public string commandUrl = "http://192.168.1.5:3001/fear/command";
    [Min(0.1f)] public float pollInterval = 0.25f;

    public ZombieAudio zombieAudio;
    public LightFlicker lightFlicker;

    [Header("Runtime debug (visible only while Play Mode is running)")]
    public bool connected;
    public int lastCommandId;
    [TextArea] public string connectionStatus = "Waiting to poll relay...";

    [Serializable] private class FearCommand { public string activeTrigger; public float intensity; public string mode; public string[] actions; }
    [Serializable] private class CommandResponse { public int id; public FearCommand command; }

    private string previousError;

    void Start()
    {
        if (zombieAudio == null) zombieAudio = FindObjectOfType<ZombieAudio>();
        if (lightFlicker == null) lightFlicker = FindObjectOfType<LightFlicker>();
        if (zombieAudio == null) Debug.LogWarning("[FearEngineClient] No ZombieAudio found in scene -- footsteps/scream commands will be ignored.");
        if (lightFlicker == null) Debug.LogWarning("[FearEngineClient] No LightFlicker found in scene -- flicker_lights commands will be ignored.");
        StartCoroutine(PollLoop());
    }

    private IEnumerator PollLoop()
    {
        var wait = new WaitForSeconds(pollInterval);
        while (enabled)
        {
            using (UnityWebRequest request = UnityWebRequest.Get(commandUrl))
            {
                request.timeout = 2;
                yield return request.SendWebRequest();

                if (request.result == UnityWebRequest.Result.Success)
                {
                    connected = true;
                    connectionStatus = "Connected to fear engine relay";
                    previousError = null;

                    CommandResponse response = null;
                    try { response = JsonUtility.FromJson<CommandResponse>(request.downloadHandler.text); }
                    catch (Exception e) { Debug.LogWarning($"[FearEngineClient] Bad response JSON: {e.Message}"); }

                    // id starts at 0 (no command fired yet) and only increments on a real fire --
                    // only dispatch once per new id so a command never replays on every poll.
                    if (response != null && response.id > 0 && response.id != lastCommandId && response.command != null)
                    {
                        lastCommandId = response.id;
                        Dispatch(response.command);
                    }
                }
                else
                {
                    connected = false;
                    connectionStatus = $"Relay request failed: {request.error}";
                    if (request.error != previousError)
                    {
                        Debug.LogWarning($"[FearEngineClient] Cannot reach {commandUrl}: {request.error}");
                        previousError = request.error;
                    }
                }
            }
            yield return wait;
        }
    }

    private void Dispatch(FearCommand command)
    {
        if (command.actions == null) return;

        Debug.Log($"[FearEngineClient] #{lastCommandId} {command.activeTrigger} | intensity {command.intensity:F2} | " +
                  $"mode {command.mode} | actions [{string.Join(",", command.actions)}]");

        foreach (string action in command.actions)
        {
            switch (action)
            {
                case "play_footsteps":
                    if (zombieAudio != null) zombieAudio.PlayFootstep(command.intensity);
                    break;
                case "play_scream":
                    if (zombieAudio != null) zombieAudio.PlayScream(command.intensity);
                    break;
                case "flicker_lights":
                    if (lightFlicker != null) lightFlicker.Flicker(command.intensity);
                    break;
                default:
                    Debug.LogWarning($"[FearEngineClient] Unknown action '{action}' -- ignored.");
                    break;
            }
        }
    }
}
