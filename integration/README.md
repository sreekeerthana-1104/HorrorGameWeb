# BioAmp → web dashboard → Quest setup

1. In Arduino IDE, install **ESPAsyncWebServer** and **AsyncTCP**. Open `esp32/EmgTearBridge.ino`.
2. Duplicate `esp32/secrets.example.h` as `esp32/secrets.h`, and enter the ESP32's 2.4 GHz Wi-Fi credentials. Do not commit `secrets.h`.
3. Connect the BioAmp analog output to GPIO 34 (classic ESP32), share ground, upload, then open Serial Monitor at 115200. Note the printed IP address.
4. Start this dashboard with `npm run dev`. Keep it on **HTTP** while using `ws://` to the ESP32; an HTTPS-hosted page will block insecure WebSockets.
5. On first page load, enter `ws://ESP32_IP/ws`, click **Connect ESP32**, then **Start calibration**. Relax for five seconds, then follow three deliberate prompts: squeeze firmly for three seconds, release for three seconds, and repeat. The ESP32 gives priority to the stronger rising/high values from those squeezes.
6. Follow `unity/HeadTearEmgChanges.md` in the Unity project. Put Quest and ESP32 on the same LAN.

The ESP32 is the source of truth. A sustained calibrated squeeze opens one two-second tear window. It is not cancelled by a normal EMG dip, and a continuous hold must be released before it can arm a second time. The browser only controls calibration and shows telemetry; Unity polls `http://ESP32_IP/state`, so closing the dashboard does not make the Quest connection fail after calibration.

Calibration intentionally rejects a run where the squeeze is too close to rest. Re-seat electrodes, keep cables still, and calibrate again. This is more dependable than a fixed threshold, but no EMG threshold can be guaranteed until it is tested with the actual electrode placement, person, and controller strap.
