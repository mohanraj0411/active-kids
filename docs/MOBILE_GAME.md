# Active Kids — Mobile Game + Android Screen Mirroring

## Product flow

The phone runs the camera, on-device pose detector, motion controller, platformer, and renderer. Android's built-in screen mirroring can show the same phone screen on a TV.

```text
                 PHONE
        ┌────────────────────┐
        │ Camera             │
        │   ↓                │
        │ Pose detection     │
        │   ↓                │
        │ MotionController   │
        │   ↓                │
        │ GameInputController│
        │   ↓                │
        │ GameController     │
        │   ↓                │
        │ Platformer         │
        └─────────┬──────────┘
                  │
            SCREEN MIRROR
                  ↓
                 TV
```

Tap **PLAY**, allow camera access, and use the live preview to frame the whole body against the guide. The setup panel moves to the side in landscape so the camera view stays clear. It gives four quick movement cues and reminds the family to make space and supervise young children. Stand several feet from the phone and wait for **READY TO PLAY!** before tapping **START GAME**. During play, the preview is hidden while the attached native camera view continues to process frames. The game then fills the landscape display.

If the installed app is missing the MediaPipe native module, the setup screen shows a regular camera preview when Expo Camera is available, along with a message that pose controls need the Active Kids development build. The game cannot start from camera controls until that build is installed.

The trail teaches as the child moves: it calls out running, a leafy crouch arch, nearby gaps, stars, fruit, and friendly spiders. The character carries a cartoon tool, and collections, landings, and hits get short visual feedback. A finish screen celebrates the run. Falls retry from a nearby safe marker while preserving earned stars and score.

For a TV, start screen mirroring from Android Quick Settings before gameplay. Mirroring is optional; the game works on the phone alone. Put the phone on a steady surface and keep it connected to power for longer sessions.

## Camera and motion

- The front camera and `expo-mediapipe-pose` run locally on the phone. Video and pose landmarks are not sent to the TV.
- The existing `MediaPipePoseAdapter`, body visibility checks, confidence gates, smoother, and `MotionController` remain in the pipeline.
- The `MotionController` feeds `GameInputController` directly in the same process. `GameController` continues to own physics, collisions, scoring, the spider, collectibles, level finish, and game status.
- Motion is disabled during camera setup. The motion controller resets when the user starts so movement during setup cannot trigger gameplay.
- If tracking is lost, Phase 3 emits `RUN_STOP` and `CROUCH_END` where needed. Camera errors release held inputs and pause the game without crashing the screen.
- A friendly **CAN'T SEE YOU** message appears only after a sustained tracking drop; short pose gaps do not interrupt the game.
- If Active Kids leaves the foreground while a game is running, held inputs are released and the game pauses. Returning to the app shows a resume state.

The camera preview is hidden with view opacity, not by setting its size to zero or unmounting it. Inspection of the installed native implementation showed that Android inference runs through `ImageAnalysis` on the attached camera view and iOS inference is delivered by the capture session's video output. Both still require a laid-out, attached view. The app preserves that view during gameplay. Physical-device verification of hidden-preview inference is still required.

## Orientation, screen, and performance

- `PLAY` requests landscape and restores portrait orientation when `ExpoScreenOrientation` is included in the native app. Without that module, the game shows a continue-in-current-orientation option instead of failing during route loading.
- The status bar is hidden for the game route. The Android navigation bar is hidden when the running native app includes `ExpoNavigationBar`; if that optional module is absent, gameplay continues with the system bar visible. Android can still reveal system controls with its normal edge gesture.
- Expo Keep Awake is mounted only while the level is actively playing; it is released on pause, completion, exit, or unmount.
- The renderer publishes game state at up to 60 frames per second. Pose camera and motion diagnostics update separately and only appear in development builds.
- Development builds have an explicit **DEBUG** toggle for game FPS, camera FPS, pose FPS, motion state, and pose confidence. It is off by default and not available in production builds. Automated checks cover game rules and input integration; they do not measure device performance.

A lower-end phone may run below these targets while processing camera frames and drawing the game. Record measured FPS, latency, temperature, frame drops, and crashes during the physical test below before making performance claims.

## Controls and developer mode

Normal play uses camera control. The setup's **DEV INPUT** button is available in development builds and opens a camera-free test screen.

- Hold **RUN** or press **A / ArrowRight** to run; release to stop.
- Tap **JUMP** or press **Space** to jump.
- Tap **SWING** or press **F** to attack.
- Hold **CROUCH** or press **ArrowDown**; release to stand.

Touch controls remain available for development. These are the same motion events consumed by the local `GameInputController`.

## Screen mirroring limitations

Active Kids does not implement casting or screen streaming. Android and the phone/TV ecosystem handle device discovery, mirroring protocol, display quality, and connection stability. The app cannot guarantee that a particular phone can mirror to a particular TV. Do not expect mirroring to keep the game active if Android backgrounds the app; Active Kids pauses safely when the app is inactive.

## Experimental network code

The previous LAN relay was removed from the normal app flow. No TV host, phone controller, IP entry, WebSocket pairing, local-network prompt, or cleartext-traffic setting is required for gameplay.

The protocol and client classes in `src/network/`, the loopback relay in `scripts/network-host.cjs`, and `npm run test:network` remain as experimental/future infrastructure. They are not imported by the normal app routes. `ws` is a development dependency for the relay and tests. The experimental relay does not currently provide TV or controller screens.

## Physical Android validation

No physical-device result is claimed by the code export or deterministic tests. Test on the target Android phone and TV:

1. Start Active Kids and tap **PLAY**. Confirm landscape orientation and camera permission.
2. Stand several feet away. Confirm the full body is visible and **START GAME** stays disabled until the full-body check passes.
3. Start the level without mirroring. Test RUN, RUN_STOP, JUMP, ARM_SWING, CROUCH, and CROUCH_END. Play through the seven gaps and friendly spiders; check star/fruit feedback, checkpoint retry, score, finish results, and a fresh PLAY AGAIN.
4. Leave the camera frame while running and while crouching. Confirm movement releases safely.
5. Background Active Kids, return, and confirm the game is paused and camera-driven input cannot continue in the background.
6. Start Android screen mirroring, repeat movement and jump, and confirm the TV shows the same game as the phone.
7. Run for at least five minutes. Record the device model, Android version, average game FPS, pose FPS, perceived motion latency, camera stability, frame drops, heating, and crashes.

| Device result | Status |
| --- | --- |
| Camera + MediaPipe on the target phone | Pending physical test |
| Local motion-controlled gameplay | Pending physical test |
| Android screen mirroring + TV gameplay | Pending physical test |
| Five-minute stability and performance | Pending physical test |

## Automated checks

```bash
npx tsc --noEmit
npx expo lint
npm run test:motion
npm run test:platformer
npm run test:network # experimental relay/protocol coverage only
npx expo export --platform android
```

An Android JavaScript bundle export is not an installable APK and does not prove that the camera, orientation, hidden-preview inference, or TV mirroring works on a physical device. Rebuild the development app after adding or changing Expo native modules, including orientation, keep-awake, and navigation bar. The game route degrades gracefully if the orientation or navigation-bar module is missing.
