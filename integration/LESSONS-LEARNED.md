# Lessons learned: bridging a physical sensor (ESP32) → Unity (Quest) → a web dashboard

Written after debugging the EMG → Unity zombie-head-tear pipeline in this project. This is a
general pattern for "hardware sensor talks to a game engine, with a web UI in the loop too" —
keep this file (or a copy of it) around for the next project that does the same shape of thing.

## The architecture pattern that worked

```
ESP32 (source of truth)
  - reads sensor, does all threshold/debounce logic itself
  - serves plain JSON over HTTP:  GET /state  ->  { armed, calibrated, envelope, threshold, connected }
  - accepts commands over HTTP:   POST /calibrate
  - also broadcasts the same JSON over a WebSocket, for the web dashboard's live UI

Laptop relay (optional, Node + a plain http server)
  - polls the ESP32's /state on an interval, re-serves it as its own /emg/state
  - exists ONLY because a Quest/phone sometimes can't reach the ESP32 directly
    (different subnet, weak Wi-Fi, whatever) but CAN reach a laptop on the same LAN
  - also exposes a manual /test-tear endpoint that fakes armed:true for N seconds,
    so you can test the Unity side without the physical hardware working at all

Unity (on the headset)
  - polls either the ESP32 directly or the relay's mirror of it, on a timer
  - never trusts a single failed request — keeps trying
  - the sensor device is the only thing that decides "is the action allowed" (armed);
    Unity just reads that boolean, it doesn't re-derive it

Web dashboard (Next.js)
  - controls calibration (POST /calibrate) and shows live telemetry (WebSocket)
  - has zero authority over Unity's state — closing the browser tab must not affect
    anything, because Unity talks to the ESP32/relay directly, not through the browser
```

**Why this shape works well:** one device (the ESP32) is the single source of truth for the
domain logic (is the button "armed" right now). Everything else is just a client polling and
displaying that state. Nobody else re-implements the threshold/debounce/hysteresis logic —
that would let two clients disagree.

---

## The bug that ate the whole session: Unity Build Profiles silently override Player Settings

This was the actual root cause behind hours of "I set Player Settings correctly but the Quest
build still throws `Insecure connection not allowed`."

**Unity 6 introduced Build Profiles** (`Assets/Settings/Build Profiles/*.asset`). Each profile
carries its **own embedded copy** of Player Settings (as YAML lines inside the asset,
`m_PlayerSettingsYaml`). When you build with a specific profile active (e.g. one named
"Meta Quest"), **the profile's copy wins over the project-wide Player Settings**, silently.

So: editing `Edit → Project Settings → Player → ... → Allow downloads over HTTP` does nothing
for a build that uses a profile, if that profile has its own stale copy of the setting.

**How to check:** grep the profile asset directly —

```bash
grep -n "insecureHttpOption" "Assets/Settings/Build Profiles/<name>.asset"
```

If it's `0` (NotAllowed) while your global `ProjectSettings/ProjectSettings.asset` says `2`
(AlwaysAllowed), that's your bug. Fix it directly in that line (it's plain text), or better,
fix it in the **Build Profiles window** (`Window → Build Profiles` → select the profile →
"Player Settings" tab) so Unity re-serializes it correctly, then verify with the grep again.

**General lesson:** when a Player Setting "isn't taking effect" no matter how many times you
set it and rebuild, check whether the active **Build Profile** has its own override before
assuming it's a caching problem. `insecureHttpOption` enum: `0` = Not Allowed, `1` =
Development builds only, `2` = Always allowed (needed for a non-development build that talks
to plain `http://`).

---

## Android/Quest networking checklist (do this before writing any game-side code)

1. **`PlayerSettings.insecureHttpOption` must be `AlwaysAllowed`** for any `UnityWebRequest`
   to a plain `http://` URL to work outside a Development Build. This is an **engine-level**
   check — it throws `InvalidOperationException: Insecure connection not allowed`
   synchronously, before any packet is sent. It is separate from (but related to) the Android
   manifest's cleartext/network-security-config, which Unity generates for you once this is
   set correctly.
2. Check it in **both** places if the project uses Build Profiles: the global Player Settings
   *and* the active profile's own copy (see above).
3. `INTERNET` and `ACCESS_NETWORK_STATE` permissions: Unity auto-adds these when it detects
   networking code, but if you have a **custom `AndroidManifest.xml`** in
   `Assets/Plugins/Android/`, add them explicitly to remove any doubt — it's harmless even if
   Unity would have added them anyway.
4. A **browser** on the same device (e.g. the Quest's built-in browser) can load plain
   `http://` URLs even when `UnityWebRequest` can't — don't use "I can see the JSON in the
   Quest browser" as proof that Unity can reach it. It only proves the network path exists,
   not that Unity's engine-level policy allows it.
5. CORS headers on the server side matter for a **browser** `fetch()`, not for
   `UnityWebRequest` (Unity doesn't enforce CORS) — but add them anyway on any endpoint a
   browser might also hit (`Access-Control-Allow-Origin: *`), it's cheap and future-proofs it.

---

## Unity coroutine gotcha: one unhandled exception kills the loop forever, silently

A polling loop written as:

```csharp
IEnumerator PollState() {
    while (enabled) {
        using (var request = UnityWebRequest.Get(url)) {
            yield return request.SendWebRequest();   // <-- can throw synchronously
            ...
        }
        yield return wait;
    }
}
```

If `SendWebRequest()` throws (e.g. the insecure-HTTP exception above), **the exception
propagates out of the coroutine and Unity simply stops calling `MoveNext()` on it.** The
`while` loop does not "catch and retry" — the coroutine is just dead, permanently, for the
rest of the app's lifetime. No further logs, no further attempts, nothing.

This produces a specific, confusing symptom: **total silence** from that system, indistinguishable
at a glance from "it's working fine and there's just nothing to report." We burned real time on
this — a build that looked "quiet" (no errors) was actually a build where the poller had crashed
once, seconds after launch, and the crash log had already scrolled out of the logcat ring buffer
by the time we checked.

**Lesson: always add a heartbeat log**, not just transition/error logs, to any
long-lived polling loop:

```csharp
if (Time.time - lastHeartbeatAt > 1f) {
    lastHeartbeatAt = Time.time;
    Debug.Log($"[MyPoller] heartbeat | alive, state: {someState}");
}
```

If the heartbeat is silent, the loop is dead — full stop, no ambiguity. This one change turns
"maybe it's fine, maybe it's not" into a definitive yes/no in a single log capture.

---

## Debugging workflow that actually worked, in order

1. **Curl every hop directly, from the machine that can reach it**, before touching Unity at
   all. `curl http://esp32-ip/state`, `curl http://laptop-ip:3001/health`,
   `curl http://laptop-ip:3001/emg/state`. This tells you in seconds whether the problem is
   "the hardware chain" or "the game engine," without needing device logs.
2. **Add server-side request logging** to any relay/bridge server you control (which IP hit
   `/state`, when, how often). You can watch this in a terminal you already have open — it's
   often faster than pulling device logs, and it directly answers "is the headset even trying
   to reach me."
3. **`adb logcat --pid=<pid>`** for the actual game-side truth. Get the pid with
   `adb shell pidof <package.name>`. Filter to your own log tags plus `Insecure`, `Exception`,
   `UnityWebRequest` to catch engine-level failures fast.
4. On macOS, **there is no `timeout` command by default** (it's GNU coreutils, not preinstalled).
   Don't write `timeout 10 adb logcat ...` and trust it silently — it'll say
   "command not found" and produce nothing, which looks exactly like "no output = no logs,"
   another false negative. Use your own tool's timeout mechanism, or background the process and
   read its output file after a beat.
5. **Isolate the two halves with a debug bypass.** Add a temporary flag that skips the
   hardware/network check entirely and does the "downstream" action directly (in this project:
   `bypassEmgForTesting` on `HeadTear` — grab the head, it tears, no EMG involved at all). If the
   downstream mechanic works with the bypass on, you've proven the bug is 100% in the
   sensor→network→engine chain, not in the game logic — saves you from debugging the wrong half.
6. **Trigger the hardware event yourself, from the terminal, instead of waiting on physical
   timing.** A `curl -X POST .../test-tear` you fire off yourself, paired with a live log
   capture, removes the "did I grab at the right millisecond" uncertainty from the loop entirely.

---

## Client-side resilience patterns worth reusing

- **Automatic failover between two possible source URLs** (direct-to-device vs via-relay),
  tried in preferred order each poll, remembering the last one that worked so most polls only
  try one URL:

  ```csharp
  List<string> CandidateUrls() {
      var list = new List<string>();
      if (lastGoodUrl != null) list.Add(lastGoodUrl);
      if (preferRelay) { list.Add(relayUrl); list.Add(directUrl); }
      else { list.Add(directUrl); list.Add(relayUrl); }
      return list.Distinct().ToList();
  }
  ```

  This means a wrong "use relay" toggle, or a relay that isn't running yet, degrades instead of
  completely breaking the pipeline.

- **Hysteresis + debounce for any noisy analog threshold** (EMG, a force sensor, anything with
  signal noise): use two thresholds (arm above the high one, release below a lower one) plus
  requiring N consecutive samples before flipping state. Prevents state chatter right at the
  boundary.

- **A physical test trigger that bypasses calibration/hardware state** (we used the ESP32's
  BOOT button to force a 2-second "armed" pulse regardless of EMG). Lets you verify the
  full downstream chain (network → engine → game action) without needing the actual sensor
  reading to be correct yet.

- **A software test trigger for the same purpose, server-side** (`POST /test-tear` on the
  relay) — lets you test from a web UI or curl without touching hardware at all, useful once
  the ESP32 is out of reach (e.g. mid-development, or for a teammate without the hardware).

---

## Project-hygiene pitfall: two copies of the same source

If your repo mirrors game-engine scripts for reference/version-control (e.g. a `integration/unity/`
folder inside a web repo, separate from the actual Unity project on disk), **editing the mirror
does nothing** — the engine only ever reads its own project folder. Decide up front which is
canonical, and copy changes into both every time, or you'll spend a session confused about why
a "fixed" bug is still happening (it was fixed in the copy nobody builds from).

---

## iPhone Personal Hotspot gotchas (if that's your LAN, like it was here)

When the "LAN" everything sits on is an iPhone's Personal Hotspot (the `172.20.10.x` addresses
throughout this project):

- **Turn on "Maximize Compatibility"** (Settings → Personal Hotspot → Maximize Compatibility).
  Without it, iOS prefers a 5 GHz-only hotspot mode that plenty of small Wi-Fi chips — including
  the ESP32's — either can't join at all or join unreliably. This setting forces plain
  2.4 GHz b/g/n, which is what most microcontrollers actually support. If the ESP32 won't join
  the hotspot, or joins and then silently drops, check this first.
- **Keep the iPhone unlocked (or at least don't let it sit locked for a long stretch).**
  A locked/idle iPhone can pause or throttle the hotspot for connected devices, which shows up
  as exactly the kind of intermittent "it worked a minute ago" flakiness that's hard to
  distinguish from an app or firmware bug. Keep it plugged in, screen on, during an active test
  session.

## TL;DR checklist for the next hardware↔engine↔web project

- [ ] One device is the source of truth for any threshold/state logic. Everyone else just polls it.
- [ ] `insecureHttpOption` = Always Allowed, checked in **both** global Player Settings and any
      active Build Profile, if you're doing plain `http://` on Android/Quest.
- [ ] Every long-lived polling coroutine gets a heartbeat log, not just error/transition logs.
- [ ] Add a server-side request-logging line for every endpoint your client hits — cheapest
      debugging tool you'll build.
- [ ] Build in a debug bypass to isolate "network/hardware problem" from "game logic problem."
- [ ] Build in a software test trigger (a button/endpoint) so you can test without the physical
      sensor being reachable or correctly calibrated.
- [ ] Client polls two possible URLs (direct + relay) with automatic failover, not just one.
- [ ] Know which copy of the code is the one that actually gets built, if there's more than one.
- [ ] If the LAN is an iPhone hotspot: Maximize Compatibility ON, phone unlocked/awake for the session.