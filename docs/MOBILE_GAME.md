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

Tap **PLAY** and choose an input mode:

- **BODY** uses the camera and asks the player to stand several feet back so the
  full body fits in view. The setup includes movement cues and a short safety
  reminder. Start is enabled after the camera and full-body checks are ready.
- **TOUCH** starts immediately with a left joystick and separate Jump, Swing,
  Crouch, and Pause controls. It does not mount the camera screen or ask for
  camera permission.
- **ASSIST** starts with Touch active so play never waits for camera readiness.
  The camera can add torso-lean movement without a full-body framing gate; touch
  remains available as a fallback. Assist does not require body jumping or
  crouching, and seated-pose accuracy has not been physically verified.

During Body or Assist play, the preview is hidden while the attached native
camera view continues to process frames. A visible source control switches
between body and touch input and releases held controls when ownership changes.

If camera permission is denied or the camera/native pose module is unavailable,
Body Mode offers Touch Mode. Assist continues with Touch input and does not
pause the game when the optional camera fails.

The trail teaches as the child moves: it calls out running, a leafy crouch arch, nearby gaps, stars, fruit, and friendly spiders. The character carries a cartoon tool, and collections, landings, and hits get short visual feedback. A finish screen celebrates the run. Falls retry from a nearby safe marker while preserving earned stars and score.

For a TV, start screen mirroring from Android Quick Settings before gameplay. Mirroring is optional; the game works on the phone alone. Put the phone on a steady surface and keep it connected to power for longer sessions.

## Camera and motion

- The front camera and `expo-mediapipe-pose` run locally on the phone. Video and pose landmarks are not sent to the TV.
- The existing `MediaPipePoseAdapter`, body visibility checks, confidence gates, smoother, and `MotionController` remain in the pipeline.
- The `MotionController` feeds `GameInputController` directly in the same process. `GameController` continues to own physics, collisions, scoring, the spider, collectibles, level finish, and game status.
- Motion is disabled during Body camera setup. The motion controller resets
  before Body calibration so setup movement cannot trigger gameplay. Assist
  starts Touch immediately and calibrates torso lean in the background when
  camera permission and pose detection are available.
- If tracking is lost, Phase 3 emits `RUN_STOP` and `CROUCH_END` where needed.
  Camera errors release held body input; Body Mode pauses safely when body input
  is active, while Assist retains Touch play.
- A friendly **CAN'T SEE YOU** message appears only after a sustained tracking drop; short pose gaps do not interrupt the game.
- If Active Kids leaves the foreground while a game is running, held inputs are released and the game pauses. Returning to the app shows a resume state.

The camera preview is hidden with view opacity, not by setting its size to zero or unmounting it. Inspection of the installed native implementation showed that Android inference runs through `ImageAnalysis` on the attached camera view and iOS inference is delivered by the capture session's video output. Both still require a laid-out, attached view. The app preserves that view during gameplay. Physical-device verification of hidden-preview inference is still required.

## Orientation, screen, and performance

- `PLAY` requests landscape and restores portrait orientation when `ExpoScreenOrientation` is included in the native app. Without that module, the game shows a continue-in-current-orientation option instead of failing during route loading.
- The status bar is hidden for the game route. The Android navigation bar is hidden when the running native app includes `ExpoNavigationBar`; if that optional module is absent, gameplay continues with the system bar visible. Android can still reveal system controls with its normal edge gesture.
- Expo Keep Awake is mounted only while the level is actively playing; it is released on pause, completion, exit, or unmount.
- The simulation targets 60 fixed updates per second. The game RAF rate,
  simulation rate, render-loop snapshot rate, React commit rate, and React
  render duration are separate measurements. React commits do not measure
  physical display presentation FPS.
- Development **DEBUG** diagnostics separately show camera capture rate, pose
  inference rate, motion processing rate/time, simulation rate/time, RAF rate,
  render-loop rate, React commit rate/time, network input rate and RTT where
  available, and thermal state where available. Camera-to-pose latency,
  pose-to-game latency, CPU, and memory show `N/A` when unavailable.
- The development **5 MIN PERF TEST** collects one-second samples for up to
  five minutes and prints a report containing the OS, build, resolution, input
  mode, camera state, measured rates, thermal states, and unavailable fields.
  It does not replace testing different devices or modes.

A lower-end phone may run below the targets while processing camera frames and
drawing the game. No device performance result is claimed until the physical
matrix below is filled out.

## Controls and developer mode

Touch is a production mode. Body remains the main motion-control mode; Assist
offers reduced lean response with Touch ready as fallback.

- Hold **RUN** or press **A / ArrowRight** to run; release to stop.
- Tap **JUMP** or press **Space** to jump.
- Tap **SWING** or press **F** to attack.
- Hold **CROUCH** or press **ArrowDown**; release to stand.

All Touch controls dispatch through the same source-aware `GameInputController`
as Body and Network actions. Gamepad is prepared as a source type only; no
physical gamepad adapter is implemented.

## Screen mirroring limitations

Active Kids does not implement casting or screen streaming. Android and the phone/TV ecosystem handle device discovery, mirroring protocol, display quality, and connection stability. The app cannot guarantee that a particular phone can mirror to a particular TV. Do not expect mirroring to keep the game active if Android backgrounds the app; Active Kids pauses safely when the app is inactive.

## TV receiver and network input

The optional **Play on TV** route pairs the phone controller with the local TV
receiver. Receiver actions pass through the same `GameInputController` using
the `NETWORK` input source; disconnect and heartbeat timeouts release held
movement/crouch and pause the receiver game. Local Body, Touch, and Assist play
do not depend on a TV connection. See [`TV_RECEIVER.md`](TV_RECEIVER.md) for
receiver setup, network behavior, and validation.

## Physical Android validation

No physical-device result is claimed by the code export or deterministic tests. Test on the target Android phone and TV:

1. On each device, record the model, OS/version, RAM if available, build,
   resolution, selected mode, camera state, and test duration.
2. Select Touch and play for five minutes with camera permission denied. Confirm
   the game starts, all controls work, and no camera prompt appears.
3. Select Body, grant permission, complete framing/calibration, and play for
   five minutes. Test lean, jump, swing, crouch, all course elements, and
   checkpoint/restart behavior.
4. During Body play, leave the frame while moving and crouching. Confirm stale
   movement releases. Switch Body to Touch and Touch to Body and confirm the
   old source cannot continue controlling the player.
5. Background and restore the app; interrupt and restore the camera. Confirm a
   safe pause/release and no crash. Repeat permission denial and camera
   unavailable cases.
6. Select Assist and play for five minutes. Confirm Touch works before camera
   readiness, body input does not require full-body framing, and camera failure
   leaves Touch playable. Do not infer seated support without a physical trial.
7. Record game RAF rate, simulation rate/time, render-loop rate, React commit
   rate/time, capture rate, pose rate, motion rate/time, input latency (or
   `N/A`), memory/CPU (or `N/A`), thermal state, skipped frames, camera
   stability, and crashes. Use the **5 MIN PERF TEST** developer control.
8. If screen mirroring is used, record it separately; it does not replace phone
   gameplay or camera validation.

| Device result | Status |
| --- | --- |
| Recent Android phone | NOT VERIFIED |
| Older/lower-performance Android phone | NOT VERIFIED |
| iPhone development build | NOT VERIFIED |
| Five-minute Body, Touch, and Assist runs | NOT VERIFIED |
| Camera lifecycle and tracking-loss tests | NOT VERIFIED |
| Android screen mirroring + TV gameplay | NOT VERIFIED |

## Automated checks

```bash
npx tsc --noEmit
npx expo lint
npm run test:motion
npm run test:platformer
npm run test:adaptive
npm run test:network # experimental relay/protocol coverage only
npx expo export --platform android
```

An Android JavaScript bundle export is not an installable APK and does not prove that the camera, orientation, hidden-preview inference, or TV mirroring works on a physical device. Rebuild the development app after adding or changing Expo native modules, including orientation, keep-awake, and navigation bar. The game route degrades gracefully if the orientation or navigation-bar module is missing.
