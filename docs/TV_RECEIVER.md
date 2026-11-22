# Active Kids TV Receiver

The receiver runs the game locally in a browser and sends the picture to the TV over HDMI. The phone sends control messages over the same local network. No Chromecast, AirPlay, Miracast, casting, or video streaming is used.

## Start the receiver

On a Raspberry Pi, mini PC, laptop, or other device with Node.js installed, open a terminal in the project folder and run:

```sh
npm install
npm run tv:host
```

`tv:host` exports the current web app, starts the HTTP/WebSocket receiver, starts mDNS advertisement, and attempts to open the receiver page in the default browser. The terminal prints the LAN address, pairing code, and fallback URL. If automatic browser opening is unavailable, open the printed `http://<receiver-lan-ip>:8765/tv` URL on the receiver itself. The web export is refreshed each time this command runs.

For a Linux device that should launch straight into a full-screen Chromium kiosk, run:

```sh
ACTIVE_KIDS_KIOSK=1 npm run tv:host
```

On Windows PowerShell, set `$env:ACTIVE_KIDS_KIOSK = '1'` before running `npm run tv:host`. Use the browser's full-screen command (usually F11) on other systems. HDMI resolution and refresh rate are controlled by the receiver operating system and TV; they were not validated on physical hardware in this environment.

The receiver screen reports its service state, LAN address, mDNS advertisement state, and phone status. `ADVERTISING` confirms the local Bonjour service started; it does not prove a phone or router can discover it. Once paired it shows **PHONE CONNECTED** and **READY TO PLAY**. The pairing code and QR are shown only while waiting for a phone.

Useful host settings:

| Environment variable | Purpose |
|---|---|
| `ACTIVE_KIDS_RECEIVER_NAME` | Name shown to the phone and receiver |
| `ACTIVE_KIDS_RECEIVER_HOST` | LAN address used by automatic browser opening |
| `ACTIVE_KIDS_RECEIVER_BIND` | Bind address; defaults to `0.0.0.0` |
| `ACTIVE_KIDS_NETWORK_PORT` | Port; defaults to `8765` |
| `ACTIVE_KIDS_WEB_DIST` | Web export directory; defaults to the project's `dist` directory |
| `ACTIVE_KIDS_DISCOVERY=0` | Disable mDNS (QR/manual connection remains available) |
| `ACTIVE_KIDS_BROWSER` | Browser executable override |

## Connect a phone

Use a rebuilt Active Kids Android/iOS development or production app. Expo Go does not include the pose-detection native module and cannot perform native mDNS discovery. Tap **PLAY ON TV**, select a discovered receiver or scan its QR, enter the six-digit code if asked, and connect. Developer builds also include a private-LAN IP/port field for manual diagnosis.

The diagnostics distinguish mDNS discovery from the receiver HTTP health route, WebSocket handshake, pairing, and game session. A failed HTTP probe does not cancel the WebSocket attempt; if direct connection succeeds, diagnostics report that separately. Ping is the phone's measured heartbeat round-trip time. If it has not received an acknowledgement, it displays **Unavailable**. The receiver does not compare clocks across devices.

The receiver developer overlay reports the actual accepted input count over its trailing one-second window, last sequence/action, and movement value. Phone movement is rate-limited by the existing controller; discrete controls are sequence-validated by the receiver. No FPS or input latency number is inferred from code.

If a paired phone disconnects or misses heartbeats, the receiver releases movement/crouch and pauses the game. A brief transport loss follows the existing reconnect flow; gameplay must be resumed explicitly after reconnect.

## Network notes

Different Wi-Fi bands and Ethernet can communicate if the router bridges them onto a reachable LAN and permits peer traffic. Guest Wi-Fi, AP/client isolation, VLAN rules, multicast filtering, and host firewalls can block discovery or direct connections. QR/manual pairing bypasses mDNS only; it cannot bypass blocked LAN traffic.

Pairing codes expire after five minutes and rotate after successful pairing. The relay allows one TV page and one phone controller. A private reconnect token supports a short reconnect window. Camera frames and pose inference stay on the phone; only control messages are sent to the receiver.

## Phase 8.5 validation record

Software checks are reported separately from hardware tests. Automated loopback tests do not count as proof that a real phone, router, browser, or HDMI TV works.

Receiver-side smoke checks in this environment: `npm run tv:host` completed its web export, started the HTTP/WebSocket host, and returned HTTP 200 for `/tv` and `/api/receiver`. A separate host run emitted Bonjour's service `up` event and the API reported `ADVERTISING`. The one-command smoke used a temporary web output directory and a non-browser launch override; it proves the host workflow, not that a desktop browser opened. The Bonjour result proves the receiver called and completed its local advertise operation, not that an Android phone discovered it.

Automated software checks: motion, platformer, and network suites PASS; `npx tsc --noEmit`, `npx expo lint`, web export, Android JavaScript export, and `git diff --check` PASS. Android JavaScript export is not an APK build.

| Configuration | Discovery | Connection | Gameplay | Status |
|---|---|---|---|---|
| Wi-Fi → Wi-Fi, same LAN | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| 2.4 GHz phone → 5 GHz receiver | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Wi-Fi phone → Ethernet receiver | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Ethernet receiver → 2.4 GHz phone | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Guest network | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Client/AP isolation | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Physical QR pairing | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Physical manual connection | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Physical HDMI/full-screen output | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| 30-minute run | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |

In the Phase 8.5 environment, `adb.exe` is present at `C:\Users\ADMIN\AppData\Local\Android\Sdk\platform-tools\adb.exe` (ADB 37.0.1), but `adb` is not on PATH and `adb devices -l` lists no device. The Android SDK has an emulator and Android 36 system image, but no `platforms` or `build-tools` directories. `java` is not installed/on PATH, `JAVA_HOME` is unset, and the usual Android Studio bundled JBR path is absent. Therefore an Android development APK cannot be built or installed here, and native mDNS/physical pairing remain unverified. A configured JDK plus Android platform/build-tools packages and a connected device (or running emulator) are required for that stage.
