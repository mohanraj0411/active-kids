# Platformer

The app's **PLAY** button opens the local side-scrolling platformer. The player
is an original cartoon adventurer, not a skeleton avatar. Camera, pose,
motion, game state, and rendering run on the same phone. The phone display can
be mirrored to a TV using Android's system feature; see
[`MOBILE_GAME.md`](MOBILE_GAME.md).

```text
MotionController
      ↓ MotionEvent
GameInputController
      ↓ player actions
PlayerController
      ↓ state and physics
GameController
      ↓ level / collision / score
PlatformerRenderer (SVG)
```

The platformer engine does not import normalized pose landmarks, MediaPipe, the
camera adapter, or camera frames. Body, Touch, Gamepad-ready, and Network
adapters submit source-neutral actions through `GameInputController`. Only
Body Mode requires camera readiness and full-body framing. Touch starts without
mounting `CameraScreen`; Assist starts with touch controls and can use torso
lean input when the camera is available. Assist does not require full-body
framing and does not map body jump or crouch actions.

## Files and responsibilities

- `src/game/platformer/GameController.ts` owns status, immutable level geometry,
  mutable runtime entities, player,
  delta-time updates, collisions, scoring, checkpoints, feedback, camera offset,
  finish, and restart.
- `src/game/platformer/GameInputController.ts` maps source-neutral actions to
  game methods and rejects inactive sources. `src/network/NetworkInputAdapter.ts`
  converts receiver protocol controls before they reach that boundary.
- `src/game/platformer/inputModes.ts` holds camera start rules and the reduced
  Body Assist lean response.
- `src/game/platformer/RuntimePerformanceMeter.ts` records RAF, simulation,
  render-loop, React commit, and render-duration metrics separately.
- `src/game/platformer/PerformanceTestHarness.ts` collects a timed developer
  run and summarizes available metrics; unsupported values stay unavailable.
- `src/game/platformer/PlayerController.ts` owns player state, acceleration,
  gravity, landing, crouch bounds, attack timing, and the active hitbox.
- `src/game/platformer/level.ts` creates the deterministic park trail with
  seven gaps, raised steps, stars, fruit, friendly spiders, safe checkpoints,
  and a finish flag. Course positions scale with the landscape viewport.
- `src/game/platformer/geometry.ts` contains renderer-independent AABB and
  circle-to-rectangle intersection helpers.
- `src/game/platformer/PlatformerRenderer.tsx` draws the original character,
  tool, park scenery, collectibles, spiders, impact text, and world with
  lightweight `react-native-svg` primitives.
- `src/screens/PlatformerScreen.tsx` runs the loop, connects camera/manual
  inputs, and renders HUD and controls.

## Player, physics, and camera

The player is an auto-runner. `RUN_START` begins the game from `READY` and
accelerates toward the configured run speed. `RUN_STOP` smoothly decelerates.
The character stays near 30% of the stage width while the world offset follows
its world position.

The game simulation uses a fixed 1/60 second step driven by
`requestAnimationFrame`; elapsed time is capped after stalls. RAF callback rate,
simulation update rate, render-loop snapshot rate, React commit rate, and React
render duration have distinct metrics. RAF rate is not reported as display
refresh or physical presentation FPS. Level geometry is frozen and reused;
mutable entity records are cloned once at initialization/restart and the
runtime entity array is reused by render snapshots. The renderer caches ground
segments and memoizes scenery and ground components by stable geometry.

`JUMP` applies one upward velocity only while grounded. Gravity pulls the
player down, and the controller lands on the base ground or a platform. A jump
event while airborne is ignored. The crouch collider becomes 66% of standing
height and keeps the feet at the same ground position.

The renderer shows idle breathing, a two-leg run cycle, jump/fall poses, a low
crouch pose, and a wind-up/swing/follow-through tool animation. Stars pulse,
fruit bobs, the friendly spiders bounce, and collection, landing, and hit
events show short floating feedback. Game hints introduce running and call out
the leafy practice arch, nearby gaps, collectibles, and spiders. The camera
setup presents all four movement cues and a concise make-space reminder before
starting.

## Level and collision

Level objects are a discriminated union in `platformer/types.ts`. The fixed
course is generated from the viewport dimensions so the gap and objects remain
playable on different phone widths. The camera moves the world; it never moves
the physical camera.

The game uses AABB intersections for the player, platforms, and enemy, plus a
circle/rectangle check for collectibles. Stars and fruit disappear and award
10 points; stars have their own HUD count. Falling below the stage or touching
a spider ends the attempt. Reaching the finish completes it.

Safe markers sit before the major gaps and spiders. A fall restarts the player
at the latest marker while preserving collected stars, score, and defeated
spiders. **PLAY AGAIN** from the finish starts a fresh course.

## Attack and enemy

`ARM_SWING` starts a short cartoon-tool animation. Its hitbox becomes active
after the wind-up and stays active only during the configured hit window. The
friendly spider pops out and awards 25 points only if that hitbox intersects
it during that window. Body contact outside a successful hit ends the run.
There are no realistic weapons, blood, or frightening effects.

## States, controls, and debug

Game status is `READY`, `PLAYING`, `PAUSED`, `COMPLETE`, or `GAME_OVER`.
Player animation state is `IDLE`, `RUNNING`, `JUMPING`, `FALLING`,
`CROUCHING`, or `ATTACKING`. The normal gameplay HUD shows score and collected
stars. A finish result shows score, stars, distance, and elapsed time with a
brief celebration. Falls use positive retry copy and the nearest checkpoint.

The production mode picker offers **BODY**, **TOUCH**, and **ASSIST**. Body
starts with camera setup and a short safety reminder. Touch starts directly
without camera permission, readiness, visibility checks, or calibration.
Assist starts with touch input already active; camera torso-lean input is
optional and can be selected while playing. The touch controls remain visible
in Body and Assist so the child can safely switch sources at any time.

The development-only **DEBUG** toggle shows capture rate, pose inference rate,
motion rate and processing time, game RAF rate, simulation rate and update time,
render-loop rate, React commit rate and render duration, network values where
available, thermal state where available, and `N/A` for unavailable CPU,
memory, or latency measurements. The **5 MIN PERF TEST** control collects a
five-minute run in either Touch or camera mode and logs a report in the
development console. It is a measurement aid, not a device-wide performance
guarantee.

- Touch: move with the left joystick; tap JUMP or SWING and hold CROUCH.
- Web keyboard: `A` or `ArrowRight` to run, `Space` to jump, `F` to attack,
  and hold `ArrowDown` to crouch.
- **BODY INPUT** / **TOUCH INPUT** switches the active source and releases
  held movement and crouch before the new source takes control.

Touch controls are production functionality. Keyboard controls and collision
boxes remain development-only. The renderer consumes a lightweight snapshot
with a stable geometry reference and a stable runtime-entity reference; callers
must treat runtime entity records as live game state and must not mutate them.

## Validation and limits

Run the deterministic framework-free checks with:

```bash
npm run test:platformer
```

They cover run acceleration/deceleration, jump/airborne rejection/landing,
crouch bounds, attack hit timing, enemy contact and defeat, star and fruit
scoring, checkpoint retries, gap failure, platform landing, finish, a complete
default-course input sequence, restart, source switching and release, camera-free
mode rules, Assist response, stable geometry/entity references, metric naming,
and the five-minute performance report. These tests validate the architecture
and game rules; they do not validate real camera recognition or physical-device
rendering performance.

Physical-device validation is **NOT VERIFIED**. On a recent and an older
Android phone, test five minutes of Touch, Body, and Assist play; permission
denial; camera loss and recovery; Body/Touch switching; background/foreground;
full-body guidance in Body Mode; hidden preview; all seven gaps; stars and fruit;
spider interactions; checkpoint retry; and completion/restart. Record the
device matrix in `docs/MOBILE_GAME.md` before making device-performance claims.

The course duration, movement feel, camera latency, and display presentation
rate have not been measured on physical devices. Camera-to-pose and pose-to-game
latency, CPU, and memory are reported as `N/A` because the current platform
interfaces do not expose reliable measurements. No seated-pose accuracy claim
is made; Assist relies on the existing shoulder/hip torso lean and always keeps
touch available. No audio has been added. Tracking loss, camera errors, source
switches, pause, app backgrounding, and network disconnect release held inputs.
