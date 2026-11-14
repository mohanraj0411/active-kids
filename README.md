# Active Kids

Active Kids is an Expo, React Native, and TypeScript motion game foundation.
Phase 2 adds local, real-time pose detection to the existing camera route.

## Run on a phone

Pose detection uses native MediaPipe code, which Expo Go does not contain. Use
an iOS or Android development build:

```bash
npm install
npx expo run:android
npx expo start --dev-client
```

`npx expo run:android` generates the Android project from the checked-in Expo
configuration and builds/installs the development client. It requires Android
Studio's SDK and a connected device or emulator. On macOS, use
`npx expo run:ios` for iOS. After the first native build, use
`npx expo start --dev-client` to connect the installed client to Metro.

If Android Studio is not available, the development APK can be built with Expo
Build:

```bash
npx eas-cli@latest build:configure --platform android
npx eas-cli@latest build --platform android --profile development
npx expo start --dev-client
```

The first command links this app to an Expo account/project. Install the APK
from the completed build, then open Active Kids (not Expo Go).

The `start` npm script also starts Metro in development-client mode. The
`android` and `ios` scripts build and install the corresponding native app.
Native build output is generated with Expo Prebuild; do not hand-edit generated
`android/` or `ios/` files.

## Phase 2 behavior

- Home still checks camera permission without requesting it. Start Game opens
  `/game`, which requests permission when needed and reuses the same camera
  owner as the `/camera` diagnostic route.
- The native camera runs Google's MediaPipe Pose Landmarker on the device. The
  bundled full model returns up to two candidate poses internally; the
  normalized application API exposes one primary pose.
- The Expo bridge is community-maintained, not an official Google or Expo
  package. Validate device accuracy and stability before release.
- The first candidate is selected by mean reported landmark visibility/presence.
  Across frames, the adapter keeps the nearest torso center within 0.3 normalized
  image units, then reacquires the strongest candidate if that person is lost.
  This short-term selection is not persistent identity tracking; closely
  crossing people can still cause a switch.
- Results use image-normalized `x` and `y` coordinates in `[0, 1]`, retain
  model depth and visibility, and preserve MediaPipe world landmarks separately
  in meters. The displayed confidence is the mean reported landmark
  visibility/presence, not a separate person-level model score.
- The overlay draws the 33-point skeleton over the preview, including direct
  nose-to-eye connections. The library aligns the overlay to the camera's
  aspect-fill preview; front-camera inference and preview are mirrored together.
- Inference and callback rates are requested at 15 FPS. Actual observed,
  inference, and result FPS come from native runtime metrics. The debug panel is
  development-only and can be disabled with `DEBUG_POSE` in
  `src/detection/poseConfig.ts`.
- Frames are processed locally. The app does not upload, save, or log camera
  images. The native camera/model view stops when the screen is unmounted or the
  app goes to the background.

## Pose adapter

`src/detection/PoseDetector.ts` maps MediaPipe output to the model-independent
`PoseResult` in `src/detection/types.ts`. The native camera integration is
isolated in `src/detection/PoseDetectorCamera.native.tsx`; game/motion code can
consume normalized pose data without importing MediaPipe.

## Phase 3 motion engine

`src/motion/MotionEngine.ts` is a reusable, plain TypeScript processor. Call
`processPose(pose)` for each Phase 2 `PoseResult`; it returns body-relative
measurements, gesture states, and transition events. It has no camera, React,
or game-scoring dependency. The raw pose is not mutated; an exponential moving
average with a 65 ms time constant feeds geometry and recognition.

The engine recognizes left/right/both hands up, squat, jump, and lateral
movement. Hand raise requires the wrist to move above its shoulder by 0.16 of
shoulder width and releases at 0.08. Squat uses knee angles (134 degree entry,
148 degree release), torso gap, and hip descent relative to the standing
baseline. In frontal views it can accept knee angles up to 160 degrees when
hip descent is clear (0.2 shoulder widths); deep bends can qualify without a
baseline. Jump requires a stable squat
preparation, upward torso movement above the standing baseline, and a return
through the landing band. Lateral movement uses 0.52 shoulder widths to enter
and 0.25 to rearm. Geometry must meet the 0.5 landmark confidence floor and
gesture transitions require 3 consecutive frames.

`GestureState` reports current active/inactive state and gesture confidence;
`GestureEvent` reports transitions once (for example `LEFT_HAND_RAISED`,
`SQUAT_STARTED`, `JUMP`, or `MOVE_RIGHT`). Missing or low-confidence landmarks
are reported as unavailable and do not create events. The development-only
debug panel shows body center, gesture state/confidence, recognizer phases,
recent events (up to 20 retained), and the native model's actual inference
duration and FPS metrics. The skeleton highlights recognized arms and lower
body. No score, timer, levels, or other game rules are included.

The project has no general unit-test framework. Phase 3 did not add one; Phase C
adds a dependency-free deterministic motion-controller harness described below.

## Phase C motion controller

`src/motion/MotionController.ts` converts normalized pose frames into the
framework-independent `MotionEvent` API: `RUN_START`, `RUN_STOP`, `JUMP`,
`ARM_SWING`, `CROUCH_START`, and `CROUCH_END`. It reuses the existing 65 ms pose
smoother and `MotionEngine`; the existing `/game` gesture/scoring path remains
compatible. Run, jump, and arm swing use timestamped, body-scale relative
signals. See [`docs/MOTION_CONTROLLER.md`](docs/MOTION_CONTROLLER.md) for
thresholds, diagnostics, test coverage, and the physical validation checklist.

Run the deterministic controller harness with:

```bash
npm run test:motion
```

For the normalized pose contract, full-body visibility rules, confidence
thresholds, smoothing, FPS definitions, and device-validation checklist, see
[`docs/POSE_DETECTION.md`](docs/POSE_DETECTION.md).

## Validation

```bash
npx tsc --noEmit
npx expo lint
npx expo-doctor
```

Physical testing is still required to verify pose accuracy, camera switching,
front/back alignment, device FPS, and startup time. Do not use Expo Go for this
phase; it cannot load `expo-mediapipe-pose`.
