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

The platformer code imports only the Phase C `MotionEvent` contract. It does
not import normalized pose landmarks, MediaPipe, the camera adapter, or camera
frames. `CameraScreen` forwards Phase C events directly through the same
`GameInputController` used by developer input. The camera check requires a
full-body detection before the game can start.

## Files and responsibilities

- `src/game/platformer/GameController.ts` owns status, level instance, player,
  delta-time updates, collisions, scoring, checkpoints, feedback, camera offset,
  finish, and restart.
- `src/game/platformer/GameInputController.ts` maps `RUN_START`, `RUN_STOP`,
  `JUMP`, `ARM_SWING`, `CROUCH_START`, and `CROUCH_END` to game actions. Dev
  buttons and keyboard create this same event shape.
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

The simulation is updated from `requestAnimationFrame` using measured elapsed
time, clamped to 50 ms. Gravity and horizontal acceleration use seconds, not a
fixed frame assumption. React/SVG rendering can publish at up to 60 updates per
second; the actual rate depends on device load and camera inference.

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

In development, `/game` opens to camera setup by default. **DEV INPUT** on the
setup screen opens a camera-free test path. The development-only **DEBUG**
button can show game, camera, pose, confidence, and motion diagnostics; it is
off by default and absent from production builds.

- Touch: hold RUN or CROUCH; tap JUMP or ATTACK.
- Web keyboard: `A` or `ArrowRight` to run, `Space` to jump, `F` to attack,
  and hold `ArrowDown` to crouch.
- Select **CAMERA MODE** to return to camera setup and live motion input.

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
crouch bounds, attack hit timing, enemy contact and defeat, star and fruit
scoring, checkpoint retries, gap failure, platform landing, finish, a complete
default-course input sequence, restart, and event-adapter mappings. These tests
validate game rules; they do not validate real camera recognition or
physical-device rendering performance.

Physical-device validation is **pending**. After installing an Android
development build, test the camera input for running, jumping, arm swing,
crouch, full-body guidance, delayed tracking-loss copy, background pause,
hidden preview, and camera restart. Play through all seven gaps and friendly
spiders, collect stars and fruit, finish, retry from a checkpoint, and start a
fresh course. Also repeat the route using DEV INPUT.

The course duration, natural movement feel, camera latency, and rendered frame
rate have not been measured on a physical device. Pose event thresholds remain
unchanged pending real-device evidence. No audio has been added; the current
MVP uses visual feedback only. Phase C emits release events when tracking is
lost; camera errors and app backgrounding also release held game inputs.
