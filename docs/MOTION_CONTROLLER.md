# Phase C motion controller

The controller turns the existing normalized `PoseResult` frames into reusable
game events. It contains no MediaPipe, camera, React, scoring, or platformer
code. Reuse one `MotionController` for a camera session and call `update()` for
each pose callback.

```text
MediaPipe Pose
      ↓
PoseDetector / normalized PoseResult
      ↓
MotionController.update(frame)
      ↓
65 ms PoseSmoother (shared stabilized frame)
      ↓
MotionEngine + timestamp based motion recognizers
      ↓
RUN_START / RUN_STOP / JUMP / ARM_SWING / CROUCH_START / CROUCH_END
      ↓
Future platformer input
```

`PoseResult` in `src/detection/types.ts` is the model independent pose-frame
contract. It uses normalized image coordinates and per-landmark confidence.
`MotionController` consumes that contract; it does not import the native pose
provider. The old `MotionEngine.processPose()` API and gesture output remain
available for the existing Motion Target game.

## API and state model

```ts
const controller = new MotionController();
const events = controller.update(poseResult);
const continuousState = controller.state; // IDLE | RUN | CROUCH
const debug = controller.getDebugInfo();
controller.reset(); // on camera/session reset
```

The event list is `MotionEvent[]`. Each event has a typed event name, timestamp,
confidence, and associated motion type. The controller does not emit a repeated
`RUN` state each frame. It emits `RUN_START` and `RUN_STOP`; crouch uses
`CROUCH_START` and `CROUCH_END`. `JUMP` and `ARM_SWING` are one-shot events.

Continuous state follows the documented priority `CROUCH > RUN > IDLE`. Jump
and arm swing do not replace that state: a player can remain in `RUN` while a
jump or arm-swing event fires. Each recognizer has independent confidence
requirements, cooldowns, and transition state.

## Detection rules

### Run in place

Run uses each knee and ankle relative to its hip. The combined vertical lift is
normalized by shoulder width (with hip-width and torso fallbacks), so the same
movement is comparable at different camera distances. It calculates velocity
from each frame's timestamp, requires opposite leg directions, sufficient
movement on both sides, two direction alternations, and a 250 ms confirmation.
The signal window is limited to 1 second and 24 samples. A 350 ms gap in
qualifying leg motion ends the run state.

### Jump

The controller adapts a grounded hip and foot baseline while the player is
stable. A jump requires both ankles to rise at least 0.13 body-scale units, the
hip center to rise at least 0.09 units, and upward hip speed of at least 0.45
scale units per second. It emits once at takeoff, then waits for descent and a
confirmed return to the landing band before rearming. The flight timeout is
2.2 seconds and the cooldown is 500 ms. Alternating one-foot lift while running
does not satisfy the both-feet condition.

### Arm swing

Each wrist is measured relative to its shoulder and normalized by body scale.
One arm is sufficient; its shoulder, elbow, and wrist must all be reliable. A
single frame-to-frame displacement must exceed 0.18 scale units and its
timestamp-derived speed must exceed 3 scale units per second. The event has a
350 ms cooldown. Both sides remain latched after an event until the motion is
quiet for 180 ms, preventing a held or continuous movement from firing each
frame.

### Crouch

Crouch reuses the existing `MotionEngine` squat geometry: knee bending plus
relative hip/body drop, including its frontal-view path. The existing squat
recognizer requires three reliable frames. The controller then applies a
timestamp based 200 ms entry confirmation and 250 ms release confirmation
before emitting crouch events. This favors stable transitions; the effective
entry delay includes both recognizers and should be tuned with a real device.

### Idle

`IDLE` is the continuous state when neither confirmed run nor crouch is active.
There is no `IDLE` event because the Phase C event contract represents motion
transitions and discrete actions, not a per-frame state stream.

## Smoothing, confidence, timing, and memory

The controller owns one existing `PoseSmoother` with a 65 ms time constant and
passes that same stabilized pose into `MotionEngine.processSmoothedPose()`.
That method prevents a second smoothing pass while preserving the original
`MotionEngine.processPose()` behavior for existing consumers.

Overall pose confidence and each recognizer's required landmark confidence
must meet the configured 0.5 floor. Low-confidence input does not create action
events. Run and jump need hips, knees, and ankles; arm swing needs a shoulder,
elbow, and wrist on the moving side; crouch uses the squat recognizer's trusted
geometry. States are held briefly during missing data, then internal state
returns to idle after a sustained invalid interval. No stop/start gameplay
event is fabricated from a lost or low-confidence pose.

All distances are body-scale relative. Every velocity uses timestamp deltas;
there is no fixed-FPS assumption. Invalid, non-increasing, and overlong frame
intervals clear velocity references. The run history is capped at 24 frames,
and every other recognizer stores only its latest reference/baseline.

Thresholds are centralized in `src/motion/motionThresholds.ts`. Existing pose
smoothing, gesture thresholds, and the native inference configuration remain
in their current modules.

## Camera and game integration

`CameraScreen` owns a controller for its camera session, feeds it normalized
frames, resets it when the camera/session stops, and throttles diagnostics to
the existing debug UI interval. It keeps forwarding the original
`GestureEvent`s to `/game`, so Motion Target scoring behavior is unchanged.
Controller event diagnostics appear on `/camera`; `/game` displays the current
controller state/event in its development-only debug panel. The controller's
`update()` result is a plain event list for future game consumers; no global
event bus or state-management package is needed.

The debug panel reports continuous state, knee velocities and alternations,
jump phase and foot rise, wrist velocities, cooldowns, and recent motion
events. It does not update React state on every pose callback.

## Deterministic checks

Run the lightweight harness with:

```bash
npm run test:motion
```

The script compiles only the framework-free motion source into a temporary
directory, feeds deterministic synthetic normalized frames, and removes the
temporary output. It checks idle/run/start/stop, continued run, jump one-shot
and landing, arm-swing cooldown, crouch entry/release, low confidence,
run-plus-swing/jump combinations, multiple body scales, and irregular 33/67/50/
100 ms timing. These checks validate controller logic; they do not claim that
MediaPipe on a physical device recognizes a child's movements accurately.

## Physical validation and known limits

Physical-device validation is **pending**. Before tuning for release, use an
Android development build with the full body visible and check idle, running in
place, jump once, both arm-swing directions, crouch/stand, run-plus-swing,
run-plus-jump, partial occlusion, camera restart, and actual pose FPS. Record
the device/model, observed transitions, and false positives. Expo Go cannot
load the native MediaPipe module.

The current POC assumes one tracked person and image-space 2D landmarks. Fast
motion, a low camera angle, cropped feet, loose clothing, and occlusion can
reduce landmark quality or alter apparent velocity. The combined run detector
and jump baseline thresholds should be tuned against real device recordings.
When tracking is lost, the controller returns its internal state to idle after
the configured timeout but intentionally emits no game event from invalid data;
future game code should also handle camera/session suspension explicitly.
