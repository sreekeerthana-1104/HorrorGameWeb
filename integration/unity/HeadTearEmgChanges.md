# Gate `HeadTear` with the EMG signal

Copy `EmgTearGate.cs` into your Unity project's `Assets/Scripts` folder. Create one empty scene object named `EmgTearBridge`, add `EmgTearGate`, and set **Esp32 State Url** to the IP printed by the ESP32, for example `http://192.168.1.50/state`.

Then update your existing `HeadTear.cs` in two small places.

1. Add this field with the other public fields:

```csharp
[Tooltip("Scene-level EMG bridge. A torn head requires a fresh BioAmp squeeze signal.")]
public EmgTearGate emgTearGate;
```

2. In `Update()`, replace the current immediate tear block:

```csharp
if (isBeingGrabbed)
{
    Debug.Log("[HeadTear] Grab detected -> tearing off.");
    TearOff();
}
```

with this:

```csharp
if (isBeingGrabbed && emgTearGate != null && emgTearGate.CanTear)
{
    Debug.Log("[HeadTear] Grab + fresh EMG squeeze -> tearing off.");
    TearOff();
}
else if (isBeingGrabbed && emgTearGate == null)
{
    Debug.LogWarning("[HeadTear] EMG gate is not assigned; head cannot tear.");
}
```

Finally, select each `HeadGrabPoint` that has `HeadTear`, then drag the `EmgTearBridge` scene object into **Emg Tear Gate** in the Inspector. `EmgTearGate` does not replace or belong on the `HeadGrabPoint`; it belongs on its own empty scene object.

The ESP32 opens one exact two-second `armed` tear window after a valid squeeze. It remains open through normal EMG dips, then locks again. A long continuous squeeze cannot trigger a second window until the player releases and squeezes again. `armedGraceSeconds` is only a small (0.15 second) network tolerance; leave it at its default.

For a standalone Quest build, the Quest and ESP32 must be on the same Wi-Fi network. Test on the actual headset, not only Play mode: the ESP32 address must be reachable from Quest.

## Test the interaction in this order

1. Build/run with the Unity Console open.
2. Make a calibrated squeeze. The ESP32 opens a two-second window.
3. Immediately grab the existing `HeadGrabPoint` during that window.
4. Unity Console must log `Grab + EMG squeeze detected -> tearing off.`

If it logs `Grab was detected, but ... window is currently closed`, grabbing is working and only the ESP32/Quest network signal is not reaching Unity. If it logs neither message when touching/grabbing the head, the problem is the existing Oculus `Grabbable`/collider setup—not the EMG script. In that case, temporarily use your original `HeadTear.cs`; if it still cannot be selected, inspect the `Grabbable`, Sphere Collider, and Oculus hand/controller interaction layers on `HeadGrabPoint`.
