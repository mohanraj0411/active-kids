# Phase D platformer prototype

Phase D adds a small deterministic side-scrolling runner while keeping the
existing Motion Target game available from the `/game` mode picker. The player
is an original vector placeholder, not a skeleton avatar. The camera and game
remain in the same app; this phase adds no networking or TV support.

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

The platformer code imports only the Phase C `MotionEvent` contract. It does
not import normalized pose landmarks, MediaPipe, the camera adapter, or camera
frames. `CameraScreen` forwards Phase C events through the same
`GameInputController` used by developer input.

## Files and responsibilities

- `src/game/platformer/GameController.ts` owns status, level instance, player,
  delta-time updates, collisions, scoring, camera offset, finish, and restart.
- `src/game/platformer/GameInputController.ts` maps `RUN_START`, `RUN_STOP`,
  `JUMP`, `ARM_SWING`, `CROUCH_START`, and `CROUCH_END` to game actions. Dev
  buttons and keyboard create this same event shape.
- `src/game/platformer/PlayerController.ts` owns player state, acceleration,
  gravity, landing, crouch bounds, attack timing, and the active hitbox.
- `src/game/platformer/level.ts` creates one fixed course with a gap, a raised
  step platform, three stars, a friendly spider, and a finish flag.
- `src/game/platformer/geometry.ts` contains renderer-independent AABB and
  circle-to-rectangle intersection helpers.
- `src/game/platformer/PlatformerRenderer.tsx` draws the scene and replaceable
  placeholder character with `react-native-svg` primitives.
- `src/screens/PlatformerScreen.tsx` runs the loop, connects camera/manual
  inputs, and renders HUD and controls.

## Player, physics, and camera

The player is an auto-runner. `RUN_START` begins the game from `READY` and
accelerates toward the configured run speed. `RUN_STOP` smoothly decelerates.
The character stays near 30% of the stage width while the world offset follows
its world position.

The simulation is updated from `requestAnimationFrame` using measured elapsed
time, clamped to 50 ms. Gravity and horizontal acceleration use seconds, not a
fixed frame assumption. React/SVG rendering is throttled to about 30 updates
per second; physics continues on each available animation frame. On very slow
devices the actual rate can be lower.

`JUMP` applies one upward velocity only while grounded. Gravity pulls the
player down, and the controller lands on the base ground or a platform. A jump
event while airborne is ignored. The crouch collider becomes 66% of standing
height and keeps the feet at the same ground position.

## Level and collision

Level objects are a discriminated union in `platformer/types.ts`. The fixed
course is generated from the viewport dimensions so the gap and objects remain
playable on different phone widths. The camera moves the world; it never moves
the physical camera.

The game uses AABB intersections for the player, platforms, and enemy, plus a
circle/rectangle check for stars. Stars disappear and award 10 points. Falling
below the stage or touching the spider ends the run. Reaching the finish
completes it.

## Attack and enemy

`ARM_SWING` starts a short cartoon-tool animation. Its hitbox becomes active
after the wind-up and stays active only during the configured hit window. The
friendly spider pops out and awards 25 points only if that hitbox intersects
it during that window. Body contact outside a successful hit ends the run.
There are no realistic weapons, blood, or frightening effects.

## States, controls, and debug

Game status is `READY`, `PLAYING`, `PAUSED`, `COMPLETE`, or `GAME_OVER`.
Player animation state is `IDLE`, `RUNNING`, `JUMPING`, `FALLING`,
`CROUCHING`, or `ATTACKING`. The renderer animates alternating run legs and
shows the jump, crouch, and tool poses. Restart restores the initial player,
score, stars, enemy, and camera offset.

In development, `/game` offers a mode picker for Motion Target and Platformer
Prototype. Platformer opens in **DEV INPUT** mode, which needs no camera:

- Touch: hold RUN or CROUCH; tap JUMP or ATTACK.
- Web keyboard: `A` or `ArrowRight` to run, `Space` to jump, `F` to attack,
  and hold `ArrowDown` to crouch.
- Select **CAMERA INPUT** to connect the real Phase C event stream. Select
  **DEV INPUT** to return to the manual test path.

Manual inputs are development-only and dispatch the same `MotionEvent` types as
the camera path. The developer overlay reports game/player state, coordinates,
velocities, grounded state, latest motion event, and attack-window state. The
collision boxes can be shown in development mode.

## Validation and limits

Run the deterministic framework-free checks with:

```bash
npm run test:platformer
```

They cover run acceleration/deceleration, jump/airborne rejection/landing,
crouch bounds, attack hit timing, enemy contact and defeat, star scoring, gap
failure, platform landing, finish, restart, and event-adapter mappings. These
tests validate game rules; they do not validate real camera recognition or
physical-device rendering performance.

Physical-device validation is **pending**. After installing an Android
development build, test the camera input for running, jumping, arm swing,
crouch, partial tracking loss, and camera restart. Also play the full route
using DEV INPUT: cross the gap, collect stars, hit the spider inside the attack
window, reach the flag, lose to the gap/spider, and restart.

This is one small POC level with simplified gravity and collisions. Pose event
thresholds still need real-device tuning. A sustained loss of pose data resets
Phase C's internal motion state without fabricating gameplay events; game or
camera session suspension should be tested as part of input recovery. The SVG
placeholder can later be replaced with original sprites without changing game
rules. No networking, additional levels, or final artwork is included.
