# Pose detection and camera pipeline

## Implementation

Active Kids currently uses `expo-mediapipe-pose` **0.4.0**, a community Expo
module backed by Google's MediaPipe Pose Landmarker. It is already integrated
with the app's Expo SDK 58 camera pipeline, so Phase B extends that working
implementation instead of swapping models or introducing another camera.
Inference runs locally on the device; camera frames are not uploaded or saved
by this application.

The native `PoseCameraView` obtains camera frames and performs inference. The
application selects one pose candidate with `MediaPipePoseAdapter`, maps it to
the internal `PoseResult`, and sends that result to `MotionEngine`:

```text
PoseCameraView / MediaPipe
  -> MediaPipePoseAdapter
  -> normalized PoseResult
  -> MotionEngine
  -> GestureEvent
```

The native `PoseFrame` type is only used inside the camera adapter and skeleton
renderer. Game and motion code do not consume native frames or camera APIs.

## Expo Go and development builds

`expo-mediapipe-pose` contains native iOS and Android modules. Stock Expo Go
does not include those modules, so pose inference is unavailable there. The app
reports the native-module error instead of generating simulated pose results.

Build an Android development client with the existing EAS profile:

```bash
npx eas-cli@latest build --profile development --platform android
```

Install and open that development build, then run Metro with:

```bash
npm start
```

The `android` npm script (`npx expo run:android`) is the local alternative and
requires Android Studio's SDK and a connected device or emulator. A fresh
native build is needed after changing native dependencies or native
configuration; the Phase B application changes do not add a native dependency.

## Normalized pose data

`src/detection/types.ts` defines the application contract. `PoseResult`
contains a frame timestamp, a partial record of named landmarks, an overall
confidence, detection state, optional image dimensions, camera metadata, and
native timing metadata. Each `PoseLandmark` has normalized image `x` and `y`
coordinates in `[0, 1]`, optional model depth, and optional visibility and
confidence scores. Coordinates and confidence values are validated and clamped
by `MediaPipePoseAdapter`.

The adapter maps MediaPipe's 33 points to the typed names in
`POSE_LANDMARK_NAMES`, including nose, eyes, ears, shoulders, elbows, wrists,
hips, knees, ankles, heels, and foot indices. When present, model world
landmarks are kept separately in meters. No model-specific point array is
exposed to the game layer.

The adapter's overall `PoseResult.confidence` is the mean of reported
visibility/presence scores for the selected candidate. It is not a separate
person-classification score. Individual landmark confidence is retained for
movement gating and diagnostics. Missing per-point confidence is treated as
unknown by full-body assessment rather than filled with a hardcoded score.

## Skeleton and mirroring

`PoseDetectorCamera.native.tsx` uses the existing `PoseSkeleton` and projection
helpers from `expo-mediapipe-pose`, plus the existing SVG gesture highlights.
It renders the selected live pose; there are no placeholder skeleton
coordinates. The adapter's selected candidate index is also used to choose the
matching skeleton, so a different person is not drawn by accident.

The selected front camera and its native preview/inference configuration carry
the same mirror setting. The package's projection helper aligns the overlay to
the aspect-fill preview. The project owner previously reported successful
front-camera skeleton tracking on an Android phone. Phase B still needs a new
visual alignment check on the target phone; verify left/right alignment there
before tuning gestures.

## Full-body visibility

`src/detection/bodyVisibility.ts` evaluates the head, shoulders, hips, knees,
and ankles. Each region needs at least one landmark with a real per-landmark
visibility or confidence score of at least `0.5`. This allows one side to be
occluded without demanding perfect confidence from every point. A reliable
critical landmark within 1.5% of an image edge marks the pose as too tightly
framed.

The assessment returns:

- `NOT_DETECTED` when the adapter has no valid pose.
- `PARTIAL` when a body region is missing, confidence is too low, or the pose
  touches the configured frame margin.
- `FULL_BODY` when all required regions are reliable and remain inside that
  margin.

`isFullBodyVisible` is the boolean convenience function; camera UI uses the
full assessment to show messages such as “I can't see your feet. Step back a
little.” These are guidance signals, not a calibrated estimate of physical
camera distance.

## Smoothing and motion confidence

`MotionEngine` applies the existing exponential landmark smoother before body
geometry and gesture classification. Its time constant is **65 ms**, with a
**0.5** landmark-confidence floor and three stable frames for gesture
transitions. This smoothing is used by the movement classifier and does not
mutate the raw pose. The debug skeleton still draws the current native pose,
which can look slightly less smooth than the classifier input.

The camera target and callback rates are configured to **15 FPS** to keep the
existing older-device behavior conservative; the camera preview chooses a
supported mode up to 30 FPS. Change those targets only after measuring on the
target device. The UI receives native metrics at the native reporting
interval, not a React update for every pose frame.

Diagnostics distinguish:

- **Camera input FPS** (`observedFps`): frames observed by the native pipeline.
- **Pose FPS** (`inferenceFps`): actual model inference rate.
- **Results FPS** (`resultFps`): pose results delivered by the native pipeline.

These values are not interchangeable. The debug panel also reports the mean
pose confidence, selected landmark scores, body visibility, inference time,
and gesture states. UI pose summaries are throttled to at most 2.5 updates per
second, with immediate updates when the coarse detector state changes. The
game's frame timer does not use pose FPS as its render clock.

## Camera and model lifecycle

The `/camera` and `/game` screens both use the same `CameraScreen` owner; the
game does not mount a second camera. `PoseDetectorCamera.native.tsx` owns one
`MediaPipePoseAdapter` per camera session and resets it when the session changes
or the component unmounts. The native `PoseCameraView` is mounted only after
camera capabilities are ready, becomes inactive when the app backgrounds, and
unmounts when leaving the camera screen. App-state listeners are removed by
their effects. Camera/model release on device is delegated to the native view's
unmount lifecycle.

No persistent calibration is implemented yet. Full-body status is computed
from each current frame; the app does not retain body measurements or camera
images as calibration data.

## Physical-device results

The project owner previously reported that Phase 2 camera, pose, and skeleton
worked on an older Android phone, with an estimated 90–95% detection
confidence. That report did not include FPS, test duration, or a controlled
alignment checklist. No new Phase B hardware measurements have been captured
for this update, so FPS and the new full-body thresholds must be confirmed on
the target phone before treating them as device-validated.

On-device checklist:

1. Stand still at normal play distance; confirm the skeleton is stable and
   `FULL BODY` appears.
2. Move closer and farther; check that missing or clipped body regions produce
   clear guidance.
3. Raise each hand and both hands; confirm wrists and the mirrored skeleton
   stay aligned.
4. Squat and jump; check hip, knee, and ankle tracking.
5. Move quickly for several minutes; check for crashes, duplicate events, or
   obvious resource growth.
6. Record Camera input FPS, Pose FPS, confidence, device model, and test
   duration from the development diagnostics.

Run static project validation with:

```bash
npx tsc --noEmit
npx expo lint
npx expo-doctor
```
