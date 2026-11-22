# ACTIVE KIDS
# PHASE 9 AUDIT REPORT

Audit date: 2026-11-21  
Scope: current repository source, routes, configuration, tests, assets, and documentation.  
Change made: this report only. No application source was changed. The working tree already contained extensive Phase 8/8.5 changes before this audit; those are reviewed as current implementation, not attributed to Phase 9.

## 1. EXECUTIVE SUMMARY

Active Kids has a substantial working prototype: native on-device pose detection, deterministic motion/game controllers, a local platformer, touch controls, an adaptive session layer, and a separate browser-based TV receiver connected over a local WebSocket relay. The receiver draws the game on the TV; the phone sends control messages, not camera video.

The strongest foundations are local camera processing, modular motion/game logic, bounded input tracking, checkpoint recovery, pairing and sequence checks, and broad deterministic tests for controller and network logic.

The product is not ready to claim a complete 2–15 experience. The same camera-dependent controls, reading level, gameplay, and tuning are shared across every age. The normal game cannot start until one full body is visible, so the production touch controls do not provide camera-free access. The default course is one roughly two-minute fixed run with no durable progression. There is no gamepad adapter or game audio. A 60 Hz React update path copies the level’s full object list for each snapshot, creating a clear low-end performance risk that has not been measured on a device.

No CRITICAL defect was confirmed by static inspection. Several HIGH risks remain release gates, especially the mandatory body-camera start path, the broad age range without adaptation, and missing native-device performance and camera validation. Actual camera recognition, physical safety, Android/iOS performance, mDNS discovery, and HDMI operation are NOT VERIFIED by this audit.

## 2. CURRENT ARCHITECTURE

### Dependency map

| Area | Current implementation | Main files |
|---|---|---|
| Navigation | Expo Router stack; home, phone game, camera diagnostics, phone-to-TV pairing, and TV receiver routes | src/app/_layout.tsx; src/app/index.tsx; src/app/game.tsx; src/app/camera.tsx; src/app/connect-tv.tsx; src/app/tv.tsx |
| Screens and UI | Home, landscape gate/setup/game, camera diagnostics, TV connection/remote, browser receiver | src/screens/HomeScreen.tsx; src/screens/PlatformerScreen.tsx; src/screens/CameraScreen.tsx; src/screens/ConnectTVScreen.tsx; src/screens/ReceiverScreen.tsx |
| Pose detection | Native camera and MediaPipe view; adapter normalizes pose output; body visibility checks one selected pose | src/detection/PoseDetectorCamera.native.tsx; src/detection/PoseDetector.ts; src/detection/bodyVisibility.ts; src/detection/poseConfig.ts |
| Motion | MotionController consumes pose frames; BodyLeanController produces continuous horizontal movement; MotionEngine also produces gesture diagnostics | src/motion/MotionController.ts; src/motion/BodyLeanController.ts; src/motion/MotionEngine.ts; src/motion/motionThresholds.ts |
| Local game | Hook owns one GameController and GameInputController; simulation owns physics, collisions, rewards, missions, adaptive state; SVG renderer draws scene | src/game/platformer/usePlatformerRuntime.ts; src/game/platformer/GameController.ts; src/game/platformer/GameInputController.ts; src/game/platformer/PlayerController.ts; src/game/platformer/PlatformerRenderer.tsx; src/game/platformer/level.ts |
| Adaptive gameplay | Session metrics, difficulty modifiers, a single next challenge, four linear missions, companion and world reactions | src/game/adaptive/PerformanceTracker.ts; src/game/adaptive/DifficultyManager.ts; src/game/adaptive/ChallengeManager.ts; src/game/adaptive/MissionManager.ts; src/game/adaptive/WorldReactionManager.ts |
| Network and receiver | Versioned protocol, phone/TV adapters, pairing/discovery, heartbeat/reconnect, Node local host, static web receiver | src/network/; scripts/network-host.cjs; scripts/tv-host.cjs |
| State and storage | React screen state plus controller-owned session state; no account/profile/local-save implementation found | src/screens/; src/game/platformer/; package.json |
| Assets | App/template icons, logos, tutorial image; player/world are drawn as SVG elements | assets/; src/game/platformer/PlatformerRenderer.tsx |
| Tests | Node assert scripts compile selected TypeScript modules to a temporary directory; no UI/device test framework is configured | scripts/test-motion-controller.cjs; scripts/test-platformer.cjs; scripts/test-adaptive.cjs; scripts/test-network.cjs |
| Configuration | Expo SDK 58; camera, local-network, orientation, navigation-bar and cleartext settings | package.json; app.json; eas.json |

### End-to-end flows

Phone play: home → /game → landscape lock or manual orientation gate → camera permission/capability → show one full body → start → two-second neutral lean calibration → play → completion/replay or exit. The home route offers phone and TV choices, not a game or age selection.

TV play: a computer/receiver runs npm run tv:host and opens /tv in a browser; the TV displays a QR and short pairing code; the phone discovers the receiver or scans/enters its address and pairs; the phone performs camera and pose processing; the receiver runs the game and renders it through its browser/HDMI output. No video-casting path is implemented or needed.

The local game uses the same GameController and renderer on phone and browser receiver. Network input passes through NetworkManager, PhoneController, TVController, and GameInputController. Camera frames and pose landmarks stay on the phone according to the implementation and user-facing text.

## 3. CRITICAL ISSUES

None confirmed in the reviewed source.

This is a static code audit. Device-only crash, camera, recognition, thermal, and safety defects remain NOT VERIFIED and must not be treated as confirmed safe or correct.

## 4. HIGH PRIORITY ISSUES

### H1 — Full-level copying and screen updates at the gameplay render cadence

- Severity: HIGH; Priority: P1
- File: src/game/platformer/usePlatformerRuntime.ts:9-15, 28-43; src/game/platformer/GameController.ts:272-305, 836-842
- Evidence: while PLAYING, the loop publishes snapshots every 16 ms. Every getState call creates a new snapshot and calls cloneLevel; cloneLevel maps and copies every level object plus checkpoint and gate arrays. PlatformerScreen passes each new snapshot to the SVG renderer.
- Impact: repeated allocation and React/SVG reconciliation can consume CPU and garbage-collection time alongside camera inference. This is a credible risk on older phones, but the amount of dropped frames or heating is NOT VERIFIED without profiling.
- Recommendation: separate immutable level geometry from changing entity state; publish only changed render data; memoize or split the renderer; measure game, pose, and presented render rates on low-end hardware before selecting a target.
- Priority: P1.

### H2 — Normal play requires camera readiness and full-body tracking; no released camera-free path exists

- Severity: HIGH; Priority: P0 for an inclusive 2–15 release
- File: src/screens/PlatformerScreen.tsx:570, 640-770, 870-877, 302-350
- Evidence: canStart is true only when camera status is ready and body visibility is FULL_BODY. The normal Start button is disabled otherwise. Touch controls are displayed only after gameplay starts. The camera-free manual screen is reached through DEV INPUT behind __DEV__.
- Impact: a child who cannot stand, cannot fit fully in frame, has limited movement, cannot use a camera, or is sharing a device cannot use the production game as a touch-only mode. Touch is an assist/control overlay after the camera gate, not an alternate mode.
- Recommendation: add a normal touch mode that starts without camera permission, plus optional seated/reduced-movement assist settings. Keep body mode optional and allow safe input-source switching.
- Priority: P0 before presenting the full age range or accessibility claim.

### H3 — One motion and reading profile is applied to the entire 2–15 target range

- Severity: HIGH; Priority: P1
- File: src/motion/motionThresholds.ts:2-58; src/detection/poseConfig.ts:6-27; src/screens/HomeScreen.tsx:43-90; src/screens/PlatformerScreen.tsx:735-771
- Evidence: all gesture/lean thresholds are module constants; pose confidence, one-person selection, full-body gate, and the same quick-start copy apply to every player. No age/profile selection or persisted control settings appear in routes or state.
- Impact: a preschool child and a teenager receive identical movement demands, timing, text, challenge framing, and screen layout. Scale normalization helps geometry but does not make reaction demands or instructions age-appropriate.
- Recommendation: implement parent-selected age bands and per-band instruction, control sensitivity, assistance, reading level, UI scale, and challenge pacing. Do not retain a child’s birth date when a broad age band is sufficient.
- Priority: P1.

### H4 — No real-device evidence for the core native runtime or physical play

- Severity: HIGH release-readiness gap; Priority: P0
- File: docs/PLATFORMER.md:132-145; docs/MOTION_CONTROLLER.md:163-178; docs/TV_RECEIVER.md:54-75; app.json:49-69
- Evidence: docs mark physical camera and performance validation pending; TV receiver documentation reports no native device/HDMI validation in the available environment. Test scripts use synthetic frames or local loopback.
- Impact: camera framing, low-light recognition, body-size variation, thermal behavior, actual Android/iOS frame rates, real Wi-Fi discovery, reconnects, and HDMI output are not proven. The project cannot make reliable device-performance claims based on source tests.
- Recommendation: treat a physical-device matrix as a release gate: at minimum older and current Android devices plus an iOS device; measure pose inference FPS, game loop FPS, visible render cadence, input latency, temperature, drops, and camera lifecycle; separately validate receiver/HDMI and LAN cases.
- Priority: P0 before release claims.

### H5 — One short fixed course provides little long-term replay value

- Severity: HIGH product-retention risk; Priority: P1
- File: src/game/platformer/level.ts:4-28, 37-54, 395-402; scripts/test-platformer.cjs:50
- Evidence: the default level is documented as one fixed POC course targeting a two-minute run; the test names 24 collectibles; the source lays out seven gaps, one crouch gate, and repeated friendly-spider encounters. No game selection or level selection route is present.
- Impact: once learned, the same linear sequence is the full product. Missions and adaptive modifiers add variation within the run but do not create another place to explore.
- Recommendation: add a small number of distinct, age-appropriate routes and optional paths with different mechanics before expanding cosmetic rewards.
- Priority: P1.

## 5. MEDIUM PRIORITY ISSUES

### M1 — Adaptive data and modifiers do not fully match their advertised use

- Severity: MEDIUM; Priority: P1 for adaptive correctness
- File: src/game/adaptive/ChallengeManager.ts:92-100; src/game/adaptive/PerformanceTracker.ts:19, 128-136; src/game/adaptive/DifficultyManager.ts:5-14, 80-88; src/game/platformer/GameController.ts:796-813
- Evidence: crouch skill uses checkpointReached and a hard-coded success rate of 0.75 rather than measured crouch outcomes. Average reaction time is accumulated but not read by DifficultyManager. promptLeadMultiplier is computed and eased in DifficultyManager, but repository references show no consumer outside that manager.
- Impact: CROUCH challenge tiers are not personalized from crouch performance, reaction-time data has no effect on difficulty, and the prompt timing modifier does not change prompt timing. Difficulty still adjusts enemy speed and attack window.
- Recommendation: track actual per-skill attempts/successes; remove unsupported metrics/modifiers or connect them to a measured behavior; test assistance and challenge transitions with failure and recovery cases.
- Priority: P1.

### M2 — Local camera instructions say RUN while horizontal body movement is torso lean

- Severity: MEDIUM; Priority: P2
- File: src/screens/HomeScreen.tsx:47-61; src/screens/PlatformerScreen.tsx:245-260; src/motion/BodyLeanController.ts:172-225
- Evidence: the home page says “Run, jump, swing, and crouch.” The local camera handler explicitly ignores RUN_START/RUN_STOP events and instead applies continuous lean movement. The setup quick start correctly says LEAN.
- Impact: the home promise may teach a movement the phone game does not use. The TV path can consume discrete run events as well as lean movement, making mode differences less obvious.
- Recommendation: describe the local control consistently as lean-to-move, and explain that body running is optional or belongs to another input mapping only if it is actually enabled.
- Priority: P2.

### M3 — TV phone controller hides the camera view during framing

- Severity: MEDIUM; Priority: P2
- File: src/screens/ConnectTVScreen.tsx:156-164, 367-385
- Evidence: the connected CameraScreen is passed previewVisible=false. The overlay shows camera and body status text but no live preview.
- Impact: the phone player must reposition without seeing what the front camera sees, making full-body framing harder in TV mode.
- Recommendation: show a small optional mirrored preview or an in-app camera framing guide while pairing/framing, then hide it for play with a persistent camera-active indicator.
- Priority: P2.

### M4 — TV documentation contradicts the active routes and configuration

- Severity: MEDIUM; Priority: P2
- File: README.md:148-157; docs/MOBILE_GAME.md:73-77; src/app/index.tsx:8-12; src/app/connect-tv.tsx:1-8; src/app/tv.tsx:1-6; app.json:15-16, 30-35, 68-69
- Evidence: README and MOBILE_GAME describe the LAN receiver as experimental, removed, and not imported. The home route offers PLAY ON TV; /connect-tv and /tv are real routes; the config includes local-network and cleartext support; TV_RECEIVER.md documents the active receiver.
- Impact: developers and testers can follow obsolete setup instructions or believe the current TV flow is absent.
- Recommendation: replace the stale Phase 2/3/6-era content with a concise current architecture and link to TV_RECEIVER.md; remove claims contradicted by the app.
- Priority: P2.

### M5 — Adaptive difficulty waits for multiple 25-second evaluation windows

- Severity: MEDIUM; Priority: P2
- File: src/game/platformer/GameController.ts:61, 796-801; src/game/adaptive/DifficultyManager.ts:17-57
- Evidence: evaluation interval is 25 seconds and the manager requires two consecutive struggling/thriving windows before changing from NORMAL.
- Impact: earliest meaningful adjustment is roughly 50 seconds into a run, after much of the two-minute course may have already passed. This may be too slow for younger children who need help early.
- Recommendation: keep hysteresis but evaluate an early onboarding window and react sooner to repeated failure at the same obstacle. Make age profile a prior for adaptation.
- Priority: P2.

### M6 — HTTP/WebSocket cleartext is enabled for the whole Android application

- Severity: MEDIUM; Priority: P2
- File: app.json:30-35, 68-69; scripts/network-host.cjs:39-75, 638-645
- Evidence: Android config enables usesCleartextTraffic; receiver host binds to 0.0.0.0 by default and serves local HTTP/WS. The protocol includes a six-digit code, rate-limited failed attempts, session IDs, and sequence checks; this is an intentional local-LAN design.
- Impact: local control traffic is not encrypted, and Android cleartext allowance is broad. Pairing reduces casual access but does not protect an untrusted/compromised LAN or authenticate the receiver cryptographically.
- Recommendation: scope cleartext to the receiver use case where platform configuration permits; keep local-only checks and pairing; document that the receiver and phone must share a trusted private network. Do not send camera data.
- Priority: P2.

### M7 — Runtime metrics do not measure actual presented render FPS

- Severity: MEDIUM; Priority: P2
- File: src/game/platformer/usePlatformerRuntime.ts:22-50; src/screens/PlatformerScreen.tsx:855-865; src/detection/poseConfig.ts:6-10; src/network/NetworkManager.ts:402-425
- Evidence: gameFps counts requestAnimationFrame callbacks; camera diagnostics report camera/pose and inference metrics; network latency is derived from heartbeat acknowledgements. There is no separate UI/SVG presented-frame measurement.
- Impact: game loop, pose inference, WebSocket round-trip, and actual visible rendering can diverge. A reported “GAME FPS” does not establish that React Native or the TV browser presents that many frames.
- Recommendation: expose separate pose FPS, simulation/update FPS, render/present FPS where measurable, and network RTT/input arrival rate. Label the heartbeat value RTT, not one-way input latency.
- Priority: P2.

### M8 — Viewport changes do not rebuild game geometry

- Severity: MEDIUM; Priority: P2
- File: src/game/platformer/usePlatformerRuntime.ts:12-16; src/screens/ReceiverScreen.tsx:17-19
- Evidence: the controller is constructed once from the initial width/height via a state initializer, while receiver screen dimensions can change on browser resize/fullscreen.
- Impact: renderer dimensions may change while level geometry and scale remain based on initial dimensions. Phone landscape lock reduces this risk; receiver browser resizing remains a plausible case.
- Recommendation: define and test a resize policy: recreate/reset geometry safely, or keep a fixed logical viewport and scale the renderer to it.
- Priority: P2.

### M9 — Session challenge coverage has a built-in skill estimate, not a measured crouch rate

- Severity: MEDIUM; Priority: P2
- File: src/game/adaptive/ChallengeManager.ts:92-100
- Evidence: the fallback skill result returns checkpoint count with a 0.75 success rate, which is used for CROUCH as well as the final fallback type.
- Impact: challenge tier labels can imply measured crouch mastery when no crouch-specific history exists.
- Recommendation: add crouch attempt/success/failure counters or do not adapt that challenge by claimed skill until data exists.
- Priority: P2. This overlaps M1 and should be fixed as part of the same adaptive cleanup.

### M10 — Large screen/controller modules increase change and review risk

- Severity: MEDIUM; Priority: P2
- File: src/screens/PlatformerScreen.tsx (1,379 lines); src/screens/CameraScreen.tsx (1,212); src/motion/MotionController.ts (968); src/game/platformer/GameController.ts (843); src/game/platformer/PlatformerRenderer.tsx (685)
- Evidence: route/screen lifecycles, setup and gameplay UI, input wiring, diagnostics, and rendering live in large files.
- Impact: UI changes and lifecycle changes are harder to isolate; adding age modes or alternative inputs in-place risks regressions.
- Recommendation: extract the camera setup/permission state machine, input-mode adapters, HUD and result views, and renderer subtrees behind typed interfaces before those modules grow further.
- Priority: P2.

## 6. LOW PRIORITY ISSUES

### L1 — The current game’s dynamic surprises are predictable

- Severity: LOW; Priority: P3
- File: src/game/adaptive/WorldReactionManager.ts:29-33, 73-90
- Evidence: bird/leaves events occur at fixed elapsed times 14, 48, and 86 seconds. Companion responses last 1.8 seconds.
- Impact: these events add color but become predictable on replay and do not create a new decision.
- Recommendation: trigger a few optional, safe world responses from player choices, with age-appropriate frequency.
- Priority: P3.

### L2 — Source comments still describe two pose candidates while configuration requests one

- Severity: LOW; Priority: P2 documentation cleanup
- File: src/detection/PoseDetector.ts:23-31, 88-93; src/detection/poseConfig.ts:19-27; README.md:46-52
- Evidence: adapter and README comments describe up to two candidates, while candidatePeople is 1 and maxPoses consumes that value.
- Impact: future tuning may be based on an inaccurate understanding of multi-person selection.
- Recommendation: update comments or configuration so they state the actual single-candidate behavior.
- Priority: P2.

### L3 — Numeric orientation lock values are magic constants

- Severity: LOW; Priority: P3
- File: src/screens/PlatformerScreen.tsx:31-33
- Evidence: orientation lock values are literal 5 and 3 with a comment naming the Expo enum.
- Impact: intent is less clear and API changes are harder to review.
- Recommendation: use the SDK enum when available through the supported module or wrap values in a small named adapter with a checked platform test.
- Priority: P3.

### L4 — Tutorial and HUD copy is small for young readers

- Severity: LOW to MEDIUM by age; Priority: P2
- File: src/screens/PlatformerScreen.tsx:735-771, 1318-1351; src/screens/HomeScreen.tsx:197
- Evidence: several camera setup labels, hints, mission labels, and safety copy use 10-pixel text; the onboarding depends on written action names.
- Impact: dense landscape setup can be difficult for early readers and small screens, even though primary AppButton controls have accessible labels and 56-pixel minimum height.
- Recommendation: use age-specific large icon prompts and optional narration; keep detailed parent safety/setup copy available without placing it in the child’s critical path.
- Priority: P2.

## 7. MOTION CONTROL AUDIT

| Action | Current behavior | Static review |
|---|---|---|
| Lean left/right | Shoulder/hip center angle; two-second neutral calibration; 8.5° dead zone; maximum input at 27°; 115 ms exponential smoothing | Scale-aware geometry is a solid base. A fixed angular range may still feel different across age, stance, camera height, or mobility. |
| Neutral | Lean returns zero inside dead zone; expired tracking resets movement | Stable neutral behavior is represented in code and synthetic tests. Real sway/lighting performance is NOT VERIFIED. |
| Jump | Foot and hip rise/velocity checks; one-shot until landing; 500 ms cooldown and landing confirmation | Synthetic lifecycle is covered. Jump detection in real clothing, partial occlusion, and on different camera placements is NOT VERIFIED. |
| Attack | Arm velocity/displacement thresholds, cooldown/rearm | Event logic is tested synthetically. It may not fit a child who cannot swing strongly; no alternate gesture/assist setting exists. |
| Crouch | Pose/knee geometry, confidence floor, 200 ms confirm and 250 ms release | Safe release on tracking loss exists. Crouch success is not tracked correctly by ChallengeManager. |
| RUN | MotionController can emit RUN_START/RUN_STOP; local gameplay ignores those events and uses lean movement for horizontal travel | Current home-page “Run” wording is misleading for local camera play. |

Evidence: src/motion/motionThresholds.ts:2-58; src/motion/BodyLeanController.ts:82-135, 172-225; src/motion/MotionController.ts:223-348, 398-451, 490-660; src/screens/PlatformerScreen.tsx:245-260; src/detection/bodyVisibility.ts:45-77.

Pose confidence threshold is 0.5; native target/callback is 20 FPS; full model is configured with maxPoses/candidatePeople 1. One candidate means no supported sibling/group selection. Body readiness requires at least one reliable landmark in head, shoulders, hips, knees, feet, with no confident point near an image edge. This is a clear setup signal but a strict prerequisite for every normal play session.

Motion tests use generated landmarks and explicitly cover scale variation, irregular frame timing, confidence loss, calibration, and event combinations. They do not validate actual children, real camera noise, lighting, clothing, phone placement, or inference delay.

## 8. GAMEPLAY AUDIT

The game has a side-scrolling vector character, run/lean movement, jump, arm-swing attack, crouch gates, collectibles, friendly spider enemies, gaps, checkpoints, hearts, score, combos, missions, adaptive labels, companion reactions, and a finish state. The current course has seven gaps, 24 collectibles, repeated spider encounters, one crouch gate, and a finish flag. It is one fixed route, not a game library or procedural course system.

Failure handling is comparatively gentle: collisions/falls use checkpoints and respawn; score and collected progress are preserved through checkpoint retries; a final failure still offers retry. The exact child comprehension and emotional response are NOT VERIFIED.

The local course is roughly two minutes by the test’s declared target. It has event feedback and collectible trails, but the route order is fixed. There are no branches, exploration rooms, moving platforms, switches, doors, rescue sequences, rhythm sections, or multiple endings.

Finish handling: PLAY AGAIN restarts the same run; CONTINUE calls onExit and returns home. It does not continue to a next level. There is no persisted best score, unlock, player profile, or session history. The GameController.restart() path resets score/stars/session metrics.

### First 60 seconds

The child sees a home page with four movement words, then must choose phone/TV. Phone play can then require rotation, camera permission, native pose startup, full-body framing, reading the quick-start/safety cards, pressing START GAME, and completing two seconds of neutral calibration. Exact elapsed onboarding time is NOT VERIFIED, but the number of gates makes a one-minute first-play target uncertain. The child learns lean, jump, swing and crouch; the first obvious reward arrives only after reaching a collectible or mission event. There is no measured first-action or time-to-first-reward metric.

Recommendation: let an adult handle device/network setup once; show one large animated movement cue, immediately confirm it in the character/world, then start the first short challenge. Keep camera/space safety guidance visible without making a young child read a long setup card.

### Boring-moment analysis

| Current section | Risk | Recommended interaction |
|---|---|---|
| Camera boot, full-body framing, and calibration | Child waits before the game responds | Show live pose/framing confirmation and let the child practice one safe action while the adult finishes setup |
| Linear travel between fixed obstacles | Activity may dip between collectible/gap/enemy events; exact idle spans are NOT VERIFIED | Add low-pressure collectible patterns or scenery that reacts to lean |
| Repeated gaps and spider encounters | Route becomes predictable after learning it | Vary approach patterns and provide optional branches without punishing a missed path |
| Mission/result text | Child may wait for a reader or adult to explain | Use one-step icons/voice, with a visual alternative and a simple next action |

### Reward system

Stars, score, combos, checkpoints and four sequential missions give immediate feedback in one session. Each mission grants points and one bonus star. Checkpoint retries preserve current progress, which avoids harsh failure. Rewards do not persist after restart/exit; no high score or collection book is present. No loot boxes, paid rewards, manipulative timers or stopping penalties were found. The current system is frequent enough for the two-minute course but has little longer-term meaning.

## 9. INTERACTION AUDIT

The interaction loop is partially present:

- Child action: lean, jump, arm swing, crouch, or touch action.
- Character reaction: running/jumping/crouching/attack/celebration animation.
- World reaction: hit/collect/landing/mission feedback, companion mood, checkpoint and surprise visuals.
- Reward: stars, score, combo, four short session missions.
- New challenge: next mission/challenge prompt, but only along the fixed course.

The world does react to the player, especially on collectible, jump, attack, mission and checkpoint events. Surprise birds/leaves are timed rather than player-triggered. No sound effect, voice prompt, music, rhythm, or spoken feedback is present.

| Event | Visual/character/world response | Audio | Remaining gap |
|---|---|---|---|
| Jump | Character animation; landing text/world reaction | Missing | No spoken cue or distinct sound confirmation |
| Attack | Swing animation; hit feedback and spider defeated state | Missing | No feedback for a missed swing beyond the encounter |
| Crouch | Crouch animation and gate prompt | Missing | Little success feedback when passing the gate |
| Collect | Object disappears; score/star and short floating feedback | Missing | No lasting collection album or variety |
| Hit/fall | Hearts/checkpoint respawn and encouraging feedback | Missing | No configurable movement assist |
| Combo | Combo counter, bonus collectible and reaction | Missing | Same combo rules across ages |
| Mission | Progress HUD and completion toast/reward | Missing | Text-first and sequential only |
| Checkpoint | Position/progress saved for current session; visual response | Missing | Not saved after the session |
| Finish | Celebration/result modal | Missing | No new route; CONTINUE exits to home |

Evidence: src/game/platformer/GameController.ts:197-234, 373-481, 503-547, 755-767; src/game/platformer/PlatformerRenderer.tsx:128-156, 460-488; src/screens/PlatformerScreen.tsx:880-940; docs/PLATFORMER.md:144-146.

## 10. AGE 2–4 ANALYSIS

The current default is a poor fit without close adult setup and a simplified mode. It asks a young child to stand far enough back for head-to-feet tracking, understand four different body actions, wait for camera framing and calibration, then use a multi-action course. Text labels such as LEAN, SWING, CROUCH and mission descriptions add reading demands. There is no voice guidance, preschool profile, broad forgiving control range, parent-selected simplified mode, or touch-only start.

The two-minute course and repeatable star collecting are useful foundations for short play. Safe checkpoints and non-punitive retry also help. For this group, reduce to one or two clear actions, large picture instructions, immediate response, short rounds, no reading dependency, no required jumping/swinging, and an adult-visible play-space prompt.

## 11. AGE 5–7 ANALYSIS

Collecting, friendly creatures, simple jump/attack/crouch goals, and short missions can be understandable with demonstration. The fixed experience gives no age-specific sensitivity or simple-vs-complex mode. Mission copy still expects reading or adult explanation; control setup waits for precise full-body tracking. There is no spoken cue or alternate body-free input.

Offer picture-first objectives, adjustable control sensitivity, forgiving timing, and short optional challenges. Keep mistakes recoverable and explain the next movement with an animation.

## 12. AGE 8–10 ANALYSIS

Combos, collectible trails, checkpoint decisions, and short missions are a reasonable base for skill practice. The current level is linear and the four mission types are fixed. Adaptive difficulty has only three broad states and its crouch/reaction/prompt data has the correctness gaps identified in M1. There is no persistent progression or player mastery view.

Add routes and optional challenges, show personal skill feedback without ranking children against others, and use validated per-skill adaptation.

## 13. AGE 11–13 ANALYSIS

The character/world presentation may feel young, and the current course offers little strategic choice, mastery content, or optional challenge. There is no personal-best competition, advanced combo path, route selection, or difficulty selection. No age-specific UI or challenge profile exists.

Add optional advanced routes, movement combinations and mastery challenges; keep playful content but allow a less childlike presentation and concise HUD.

## 14. AGE 14–15 ANALYSIS

The current single fixed course and childlike visual framing are unlikely to sustain an older teen who expects meaningful challenge, mastery and replay. There is no advanced movement setting, time trial, personal best, route choice, practice mode, or personal progression. Do not solve this by adding public leaderboards or social pressure.

Offer a clean visual theme option, self-paced mastery modes, timed personal-best trials, and optional high-skill paths with no comparison against other children.

## 15. ADAPTIVE DIFFICULTY AUDIT

Implemented:

- PerformanceTracker tracks jump/attack/collectible outcomes, collisions, checkpoints, combo, recent events, pose confidence, reaction time and a smoothed performance score.
- DifficultyManager has NORMAL, EASY and CHALLENGE levels with two-window hysteresis.
- Current difficulty changes enemy patrol speed and attack hit window; promptLeadMultiplier is presently unused.
- ChallengeManager selects one nearby challenge and can downgrade after repeated failure.
- MissionManager advances four fixed missions during one run.
- WorldReactionManager responds visually to several successful actions and checkpoints.

Gaps:

- Difficulty evaluation occurs every 25 seconds and needs two windows, so response is delayed.
- No age profile or reaction-time use.
- Crouch success is a constant estimate, not measured.
- No adaptation of gap geometry, number of retries, body movement range, or control sensitivity.
- The mission queue is the same order every run.
- Challenge choice is spatial/current-event driven, not player preference driven.
- There is no user-facing explanation or parent control for assistance.

Recommendation: collect minimal per-session event counters only, use accurate per-skill success and repeated failure, then adapt prompt timing and optional assistance in small, reversible steps. Do not store raw pose data or create streak pressure.

## 16. ACCESSIBILITY AUDIT

Touch controls are real and clearly separated: a left joystick plus separate swing, crouch and jump buttons. The joystick has a screen-reader label; action buttons have labels; key HUD areas use polite live regions. These are positive details.

However, they only appear after a camera-gated game start in normal production flow. The fully camera-free path is developer-only. There is no gamepad adapter, seated mode, reduced-motion range, simplified movement mode, one-button mode, or camera-free touch route. No screen-reader alternative announces SVG world events or game state consistently. Some critical tutorial/safety text is 10 px.

Add selectable Body, Touch and Gamepad modes, allow movement assistance, offer seated/reduced-range controls, respect reduced-motion preference, and provide large visual/audio instructions. Avoid making standing, jumping, or arm motion mandatory.

### Gamepad mapping

GameInputController accepts MotionEvent, horizontal movement, network actions, and developer input; it does not subscribe to a hardware Gamepad API. No Left stick/A or Cross/X or Square/B or Circle/Start mapping exists. Keyboard controls appear only in the developer web path. The current on-screen touch actions do not demonstrate gamepad support.

## 17. CHILD SAFETY AUDIT

Positive evidence:

- Camera permission text describes on-device pose detection; microphone permission is disabled.
- Camera frames are processed locally; no image/video upload path or analytics, ad, purchase, chat, account or social SDK was found in source/dependencies.
- No child profile or birth date collection is present.
- Camera processing is bound to the active app lifecycle; local game pauses on background/camera interruptions and releases held inputs.
- Setup says make space, move away from furniture/sharp objects, use a steady surface, and supervise young children.
- Network messages contain controls/game events, not camera frames or pose landmarks.

Risks and limits:

- The phone camera stays active for pose input while its preview is hidden during play. Add a visible camera-active cue so the child and supervising adult understand this.
- TV pairing uses local HTTP/WS cleartext and a short code on the local network. It is not encrypted/authenticated for an untrusted LAN.
- Physical play-space enforcement and fatigue/break behavior are not present. Add a simple pre-play prompt and optional pause reminders without punishment or streak loss.
- Physical safety assessment is NOT VERIFIED; this is a software review, not an in-room evaluation.

Evidence: app.json:15-16, 30-39, 49-53, 68-69; src/screens/CameraScreen.tsx:242-292; src/screens/PlatformerScreen.tsx:288-300, 746-755; src/network/protocol.ts; scripts/network-host.cjs:188-255.

## 18. CAMERA AUDIT

Camera permission is requested on entering CameraScreen if not already granted; denial has a recovery screen and retry path. The native pose view is mounted only when capability is ready, isActive follows app activity, and the view is unmounted on leaving. Backgrounding releases inputs and resets motion state. The app hides preview drawing with opacity while retaining the attached native view for inference. This is deliberate for hidden-preview processing, but physical confirmation is pending.

The visible local setup includes live preview and body framing. TV mode explicitly hides preview, which weakens framing. During gameplay the camera remains active but no clearly visible app-level camera-on marker was found. The OS camera privacy indicator is platform behavior and was not tested here.

The model requests one pose at 20 callback/target FPS and a full model; CPU/thermal behavior on Android is not profiled. Full body is required; multiple players are not supported. Permission denial is handled; low light, obstruction, loose clothing, camera orientation, body size, and camera distance have only synthetic or code-level review, not device validation.

Evidence: src/screens/CameraScreen.tsx:161-192, 242-326, 610-620; src/detection/PoseDetectorCamera.native.tsx:249-293, 540-548; src/detection/poseConfig.ts:6-27; src/detection/bodyVisibility.ts:49-77.

## 19. NETWORK AUDIT

The local transport has useful safety and reliability features: protocol versioning and shape checks; bounded message size; session ID checks; monotonic input and event sequence checks; six-digit pairing code expiry/rotation; per-address failed-code lockout; heartbeat timeout; reconnect token/window; reconnect backoff; and held movement/crouch release on disconnect.

Phone movement is throttled by the controller path, and the receiver tracks accepted input rate. The phone and TV need to be on the same reachable LAN. The UI explicitly warns that guest networks/client isolation can block discovery and connection. QR and manual private-LAN address paths complement mDNS.

Limits: no physical 2.4/5 GHz, Ethernet, guest-network, client-isolation, packet-loss, router-change, or reconnect test is claimed. Message sequence protects against stale/duplicate inputs, but actual latency/jitter and input arrival during phone backgrounding need device validation. Local cleartext is an intentional design tradeoff, not an internet service.

Evidence: src/network/NetworkManager.ts:230-297, 402-440; src/network/protocol.ts:139-218; src/network/TVController.ts:197-241, 277-290; scripts/network-host.cjs:188-255, 263-326, 380-434; src/screens/ConnectTVScreen.tsx:115-153.

## 20. TV RECEIVER AUDIT

The TV receiver is a separate browser route that instantiates its own game simulation and renderer. It displays pairing QR/code and status; the phone runs its camera and pose detection and sends control events. No screen casting/video streaming is required. TV host documentation explains Node/browser/HDMI setup and identifies hardware tests as pending.

Risks: receiver discovery and native local-network permissions are not proven on real phones; phone framing preview is hidden; browser resizing may leave game geometry initialized to old dimensions; full-screen/browser sleep/HDMI/TV resolution are environment dependent; only one TV and one phone are supported. The phone remote screen carries body controls and start/pause/restart buttons, not a full touch/gamepad controller for camera-free play.

Evidence: src/screens/ReceiverScreen.tsx:15-23, 55-78, 106-159; src/screens/ConnectTVScreen.tsx:156-178, 367-409; docs/TV_RECEIVER.md:1-52, 54-75.

## 21. PERFORMANCE AUDIT

Keep the metrics separate:

| Metric | Current source/config | What can be concluded |
|---|---|---|
| Pose/inference FPS | pose target and callback 20 FPS; preview cap 30; native callback diagnostics | Requested caps are known. Actual FPS is device-dependent and NOT VERIFIED. |
| Motion processing time | MotionProcessingMeter around controller updates; development diagnostics | Measures JS motion-controller work, not MediaPipe inference or total camera pipeline. |
| Game/update FPS | requestAnimationFrame count in usePlatformerRuntime | Measures loop callbacks, not guaranteed presented frames. |
| Render/present FPS | No separate presented-frame metric found | NOT VERIFIED and not separately measured. |
| Network latency | Heartbeat acknowledgement delta in NetworkManager | RTT estimate; not one-way motion-to-TV input latency. |
| Network input rate | TVController records accepted arrivals | Useful diagnostics; physical peak/latency not measured. |

The highest static cost is the combination of 16 ms state publication, object cloning, and re-rendering a sizable SVG world and screen subtree. Full MediaPipe model plus camera and app rendering risks CPU/battery/thermal pressure on low-end Android. Thermal state can be displayed in dev diagnostics but there is no runtime quality/FPS adaptation. High-end behavior is also not measured.

Evidence: src/game/platformer/usePlatformerRuntime.ts:9-58; src/game/platformer/GameController.ts:272-305, 836-842; src/game/platformer/PlatformerRenderer.tsx:104-156; src/detection/poseConfig.ts:6-27; src/motion/MotionProcessingMeter.ts:1-31; src/network/TVController.ts:277-295.

## 22. CODE QUALITY AUDIT

Strengths: core motion/game/network controllers are mostly framework-independent; types are explicit; thresholds are centralized; lifecycle cleanup and input release are present; protocol parsing rejects malformed values; network and session state are bounded.

Maintainability risks:

- Large PlatformerScreen, CameraScreen, MotionController, GameController, renderer, and ConnectTVScreen make mixed UI/lifecycle/input logic difficult to change safely.
- MotionController runs MotionEngine analysis for diagnostic state and also runs its own run/jump/arm/crouch recognizers. This provides functionality but creates two pose-analysis paths and tuning surfaces.
- GameInputController imports NetworkInputAction from the network protocol. This couples the game input layer to network vocabulary; a neutral GameAction boundary would keep transport outside core game logic.
- src/game/GameEngine.ts, targetGenerator.ts and scoring.ts appear unreferenced by application routes; they are legacy implementation candidates and should be confirmed before deletion.
- Candidate-count comments are stale (L2).
- Several direct Expo dependencies are not imported from src (including expo-device, expo-image, expo-web-browser, expo-symbols, expo-glass-effect, and @expo/ui); some Expo packages may still be indirect/runtime requirements, so verify dependency ownership before removing any.
- No persistent state, global store, or account state is present; session ownership remains local to hooks/controllers.

Evidence: src/motion/MotionController.ts:237-260, 280-347; src/game/platformer/GameInputController.ts:1-8; src/game/platformer/usePlatformerRuntime.ts:12-16; src/game/GameEngine.ts; src/game/targetGenerator.ts; src/game/scoring.ts.

## 23. TEST COVERAGE AUDIT

Existing deterministic suites:

| Suite | Approx. cases | Current coverage |
|---|---:|---|
| test-motion-controller.cjs | 17 | run/jump/arm/crouch lifecycle, confidence/tracking loss, body scale, lean calibration/smoothing, irregular timing, local input integration |
| test-platformer.cjs | 25 | movement/physics, collision, checkpoints, collectibles, combos, fixed course, missions/challenges, restart, motion integration |
| test-adaptive.cjs | 5 | metrics, difficulty hysteresis, missions, challenge tiers/failure prompt, deterministic world reactions |
| test-network.cjs | 15 | protocol validation, pairing/address parsing, heartbeat/reconnect, throttling, relay integration, safety release and sequence/session rejection |

The scripts exercise useful domain logic, but they do not provide line/branch coverage. No screen/component test harness, camera native integration test, real MediaPipe frame test, actual-device benchmark, accessibility test, gamepad test, physical safety test, or physical receiver/HDMI test was found. Pairing/discovery coverage tests parsers and local loopback; it does not prove native mDNS works on household routers.

Risk-ranked test additions:

1. P0: representative device camera/inference/game/render performance and safe lifecycle/background/input-release matrix.
2. P0: touch-only start, camera permission denied, missing native module, and camera interruption UI flows.
3. P1: age profile/control thresholds and repeated-failure adaptation, including real crouch tracking.
4. P1: TV pairing/discovery/reconnect on real 2.4/5 GHz and client-isolated/guest networks.
5. P2: screen-reader labels/live announcements, reduced motion, resize/fullscreen, and gamepad mapping.

Tests were inspected, not run as part of this audit. No test outcome is claimed.

## 24. DOCUMENTATION AUDIT

- README remains primarily a Phase 2/3 history and calls the live network flow experimental/not used.
- MOBILE_GAME.md still says the relay was removed and no TV screens exist, contradicted by app routes and TV_RECEIVER.md.
- PLATFORMER.md documents camera, gameplay and pending device validation; its pending status is still useful.
- POSE_DETECTION.md explains the local adapter but the source comment/README still incorrectly describe two candidates while configuration selects one.
- TV_RECEIVER.md is the current, useful source for receiver setup and its physical test matrix.
- Setup instructions and test commands are split across documents. The receiver has clear local network requirements; the main README should point to these current instructions.
- Audio is not present and docs correctly state visual-only gameplay.

Evidence: README.md:1-4, 46-52, 148-172; docs/MOBILE_GAME.md:73-109; docs/PLATFORMER.md:132-146; docs/POSE_DETECTION.md:152-170; docs/TV_RECEIVER.md:1-75.

## 25. PRODUCT DIFFERENTIATION

Strong differentiators already present:

- Body movement drives a character rather than requiring a handheld controller.
- Pose inference is local; camera video is not sent to the receiver.
- TV play uses a browser/HDMI receiver and local controls instead of video casting.
- Friendly companion/world responses and adaptive session feedback create a base for movement-led play.

Weak or generic today:

- The core content is still a familiar linear platformer course with gaps, collectibles, enemies and a combo counter.
- The companion reacts briefly but does not guide, remember a choice, or open a new interaction.
- Adaptivity mostly adjusts combat timing/speed and does not provide age-based control or route adaptation.
- There is no family/co-op mode, although only one pose is selected.
- No gamepad path, persistent personal mastery, route exploration, audio identity or meaningful world interaction makes the product distinct beyond pose controls.

Build differentiation through safe body-driven world actions, age-specific control design, and multiple playful routes—not by collecting personal child data or adding paid/random reward systems.

## 26. INTERACTION IMPROVEMENT OPPORTUNITIES

Good age-scaled opportunities, in order:

1. A safe “wave to wake” companion or tap-to-choose route; a single low-effort action can start a reaction.
2. Responsive scenery linked to movement: lean toward a branch, crouch to pass a tunnel, jump to release floating leaves. Use touch equivalents for each.
3. Optional paths and simple environment switches, with no penalty for missing them.
4. A non-timed rescue/help sequence that rewards deliberate actions rather than speed.
5. Rhythm or balance challenges only as optional older-child content, with a touch/gamepad equivalent.
6. A local collection book or route stickers earned by play, not random drops or time-limited streaks.
7. A companion that gives one visual/audio cue at a time, adjustable or silent.

Avoid continuous surprise spam, failure shame, loss of earned progress, comparison leaderboards for young children, and manipulative return timers.

## 27. AGE-SPECIFIC FEATURE MATRIX

| Feature | 2–4 | 5–7 | 8–10 | 11–13 | 14–15 |
|---|---|---|---|---|---|
| Lean | NEEDS ADAPTATION | NEEDS ADAPTATION | NEEDS ADAPTATION | NEEDS ADAPTATION | NEEDS ADAPTATION |
| Jump | NOT SUITABLE as required camera action | NEEDS ADAPTATION | GOOD with current base | NEEDS ADAPTATION for mastery | NEEDS ADAPTATION for challenge |
| Attack | NOT SUITABLE as required precise swing | NEEDS ADAPTATION | GOOD with friendly framing | NEEDS ADAPTATION for skill depth | NEEDS ADAPTATION for less childish framing |
| Crouch | NOT SUITABLE as required move | NEEDS ADAPTATION | GOOD as a simple obstacle | NEEDS ADAPTATION for measured skill | NEEDS ADAPTATION for optionality |
| Missions | NOT SUITABLE as text-first | NEEDS ADAPTATION | GOOD as simple session goals | NEEDS ADAPTATION for choice | NEEDS ADAPTATION for mastery |
| Combos | NOT SUITABLE as a goal | NEEDS ADAPTATION | GOOD as a short reward | GOOD base, needs depth | NEEDS ADAPTATION for advanced chaining |
| Exploration | NOT SUITABLE: no simple choice support | NEEDS ADAPTATION | NEEDS ADAPTATION: route is linear | NEEDS ADAPTATION: no branches | NEEDS ADAPTATION: no route mastery |
| Difficulty | NOT SUITABLE without adult/assist preset | NEEDS ADAPTATION | NEEDS ADAPTATION | NEEDS ADAPTATION | NEEDS ADAPTATION |
| UI | NEEDS ADAPTATION | NEEDS ADAPTATION | NEEDS ADAPTATION | NEEDS ADAPTATION | NEEDS ADAPTATION |
| Audio | MISSING | MISSING | MISSING | MISSING | MISSING |
| Rewards | NEEDS ADAPTATION: immediate-only | NEEDS ADAPTATION: session-only | NEEDS ADAPTATION: no progression | NEEDS ADAPTATION: no personal best | NEEDS ADAPTATION: no mastery record |
| Gamepad | MISSING | MISSING | MISSING | MISSING | MISSING |

These are product-fit judgments based on the present feature set, not claims about what an individual child can do. In particular, the current camera/full-body prerequisite makes body actions mandatory even where a feature could otherwise be optional.

## 28. PRIORITY MATRIX

| Priority | Area | File / lines | Problem | Why it matters | Recommendation | Complexity | Risk |
|---|---|---|---|---|---|---|---|
| P0 | Accessibility/input | PlatformerScreen.tsx:570, 640-770 | Camera/full-body gate blocks normal start; touch-only is not released | Excludes children who cannot or do not want to use body tracking | Add full touch mode and optional reduced/seated mode | Medium | Medium |
| P0 | Device validation | PLATFORMER.md:132-145; TV_RECEIVER.md:54-75 | Native camera/performance/TV behavior is unverified | Core release claims are unsupported without hardware evidence | Run Android/iOS, low-end thermal and HDMI/LAN matrix | Medium | High |
| P1 | Performance | usePlatformerRuntime.ts:40-43; GameController.ts:272-305, 836-842 | 16 ms snapshots copy all level objects and rerender scene | May compete with camera inference and drop frames | Separate immutable geometry; profile and reduce render work | Medium | Medium |
| P1 | Age UX | motionThresholds.ts:2-58; HomeScreen.tsx:43-90 | No age/control/instruction profiles | One model cannot serve 2–15 well | Add broad parent-selected age bands and adjustable assistance | Medium | Medium |
| P1 | Adaptive correctness | ChallengeManager.ts:92-100; DifficultyManager.ts:5-14 | Crouch estimate is fixed; reaction/prompt modifiers unused | Adaptation can claim unsupported skill and misses useful signals | Use real per-skill outcomes and remove/connect dead metrics | Small | Low |
| P1 | Replayability | level.ts:4-28, 395-402; PlatformerScreen.tsx:931-940 | One fixed short course; CONTINUE exits | Weak retention after learning the route | Add multiple routes and a next-level result flow | Large | Medium |
| P1 | Interaction | PlatformerRenderer.tsx:128-156; WorldReactionManager.ts:29-90 | Most reactions are short visuals; no audio or new world decisions | The world reacts but offers limited new play | Add age-scaled optional interactive scenery and audio cues | Medium | Medium |
| P2 | Camera UX | ConnectTVScreen.tsx:156-164, 367-385 | TV remote hides preview while the child frames body | Framing/troubleshooting takes more effort | Optional preview during setup, visible active-camera indicator | Small | Low |
| P2 | Network security | app.json:68-69; network-host.cjs:39-75 | Broad cleartext setting and local unencrypted controls | Local traffic is visible on an untrusted LAN | Scope policy where possible; document trusted-LAN requirement | Small | Medium |
| P2 | Quality metrics | usePlatformerRuntime.ts:22-50; NetworkManager.ts:402-425 | RAF and heartbeat RTT are not presented FPS/one-way latency | Misleading device performance conclusions | Name metrics precisely and add render-rate instrumentation | Medium | Low |
| P2 | Documentation/tests | README.md:148-157; MOBILE_GAME.md:73-77; scripts/test-network.cjs | Docs deny the live TV route; native discovery lacks device tests | Slows maintenance and hides regressions | Refresh docs; add UI and real-device test checklist | Small | Low |
| P2 | Maintainability | PlatformerScreen.tsx; CameraScreen.tsx; MotionController.ts | Very large mixed-responsibility modules | New age/input features become risky to integrate | Extract lifecycle, HUD and input adapters incrementally | Medium | Medium |
| P3 | Presentation | PlatformerScreen.tsx:1318-1351 | Several setup/HUD texts are 10 px | Poorer readability for early readers/small screens | Use age-specific scaling and concise picture-first cues | Small | Low |

## 29. QUICK WINS

1. Update Home copy from RUN to LEAN for local body movement.
2. Rename or change the completion CONTINUE action so it does what the label promises; currently it exits home.
3. Show a camera-active indicator during hidden-preview gameplay and expose a small setup preview in TV phone mode.
4. Fix stale README/MOBILE_GAME network statements and the one-versus-two pose comments.
5. Remove or connect promptLeadMultiplier and reaction-time scoring; correct CROUCH challenge metrics.
6. Increase critical tutorial/safety label size and simplify the first setup view for young players.
7. Label diagnostics precisely as pose, motion-processing, game-loop and network RTT measurements.

## 30. ARCHITECTURAL CHANGES

Do these in small steps, preserving the working local and receiver flows:

- Introduce a source-neutral GameAction boundary for body, touch, gamepad and network inputs; keep transport messages out of core game logic.
- Split game state into immutable level geometry and changing player/entity snapshots; avoid copying the world on each frame.
- Separate camera permission/session ownership, camera setup UI, HUD/result views, and input overlays from PlatformerScreen.
- Define AgeProfile/ControlProfile as explicit configuration consumed by onboarding, thresholds, assistance, prompts, and UI scaling.
- Define metrics contracts that distinguish inference, motion processing, simulation, presentation, and transport.
- Add a small persistence adapter for local settings/personal best only if needed; do not store pose or camera data.

## 31. FUTURE FEATURES

- Multiple original routes with alternate paths and age-specific optional challenges.
- Companion-led cooperative world events that work for one player and have touch/gamepad equivalents.
- Optional rhythm/balance play, never required for progression.
- Personal mastery badges and local bests; no public child rankings.
- Parent/child control profiles stored locally without date of birth.
- Multiple-player/co-op only after multi-person pose selection and device performance are designed and tested.
- A family receiver setup guide and simple TV calibration screen.
- Audio packs with mute, volume and caption/text equivalents.

## 32. RECOMMENDED ROADMAP

1. Phase 10 — Stability and inclusive input: measure low-end device performance, reduce per-frame copying, add production touch-only mode and camera-on cue.
2. Phase 11 — Age profiles and onboarding: build visual-first age bands, control sensitivity, assisted actions, large text and optional voice; keep a non-body route.
3. Phase 12 — Interactive worlds: add player-triggered scenery, optional paths, varied obstacles and age-specific goals.
4. Phase 13 — Adaptive mastery and replay: correct metrics, use reaction/outcome data responsibly, add multiple levels and local personal bests.
5. Phase 14 — TV and release validation: test Android/iOS camera, Wi-Fi discovery and pairing, reconnect, browser resize/fullscreen, HDMI, accessibility, and update current docs.

## 33. FINAL SCORE

Scores reflect source inspection and available evidence, not a release certification.

| Category | Score / 10 | Reason |
|---|---:|---|
| Architecture | 6 | Clear domain modules and separate receiver, but large screens and a frame-copy issue |
| Code Quality | 6 | Typed core and lifecycle care; large mixed-responsibility modules and stale code/docs |
| Performance | 5 | Sensible 20 FPS pose cap, but high-frequency cloning and no hardware profile |
| Motion Control | 6 | Scale-aware geometry and robust state handling; child/device tuning unverified |
| Gameplay | 5 | Complete short platformer loop, but only one fixed course |
| Interaction | 4 | Character and world respond; limited choice, audio and world manipulation |
| Child UX | 4 | Friendly controls and safety copy; long setup/text and one experience for all ages |
| Age Adaptation | 1 | No age profile |
| Accessibility | 3 | Touch overlay and labels exist; touch-only start, gamepad, seated/assist paths missing |
| Safety | 7 | Local camera/no microphone/no accounts and safe input release; physical validation pending |
| TV Experience | 5 | Real receiver/pairing architecture exists; real browser/HDMI validation pending |
| Network Reliability | 5 | Versioning, pairing, heartbeat, sequence and reconnect design; household router behavior unverified |
| Gamepad Support | 1 | No gamepad adapter or mapping |
| Replayability | 3 | Missions/combos help a single run; no route library or saved progression |
| Product Differentiation | 4 | Body control and TV receiver are strong foundations; game loop remains familiar and linear |
| Testing | 6 | Broad deterministic logic suites; no UI/native/device/performance coverage |
| Documentation | 3 | Current receiver doc is helpful; README and MOBILE_GAME contradict active routes |

Overall Product Readiness: 4.1 / 10, the arithmetic mean of the 17 category scores above. The score is held down by missing age adaptation, camera-free accessibility, replayability, hardware validation, and documentation drift.

### Product question: what keeps a child playing after five minutes?

The immediate reasons are responsive body movement, collecting stars/fruit, friendly spider encounters, checkpoint recovery, combos, short missions, and the companion’s visual reactions. These can make the first run enjoyable. The default run targets about two minutes; by five minutes, a child is likely repeating the same route. There is no next level, lasting reward, saved personal best, or meaningful route variation. Current code therefore offers a reason to replay once, but not a strong reason to continue over many sessions.

### Product question: what is missing for a highly interactive body-controlled kids game?

Age-specific input and instruction profiles; camera-free touch/gamepad access; accurate skill adaptation; more player-triggered environmental choices; multiple routes; optional sound/voice; durable local progression; accurate TV framing and setup; and measured native-device performance. Most importantly, body movement must remain an option rather than the only way to pass the camera gate.

### Top 10 changes to implement next

1. Add production camera-free touch mode and optional reduced/seated movement.
2. Profile the 60 Hz game path and stop copying the full level on every snapshot.
3. Validate camera, pose, thermal and render performance on representative Android and iOS devices.
4. Add parent-selected age bands with sensitivity, assistance, instruction and UI variants.
5. Fix adaptive challenge data: real crouch outcomes; remove or use reaction-time and prompt-lead metrics.
6. Add distinct routes and a real next-level flow; preserve optional, non-punitive replay.
7. Align local onboarding copy with lean-to-move and add a short visual demonstration.
8. Add player-triggered world interactions and more varied optional obstacles.
9. Provide accessible audio/voice cues with mute and visual equivalents, plus reduced motion.
10. Finish TV setup/framing indicators and update README/MOBILE_GAME; add UI and device test coverage.

# RECOMMENDED NEXT 5 PHASES

| Phase | Objective | Why | Main files | Expected user benefit | Priority |
|---|---|---|---|---|---|
| Phase 10 — Stability and inclusive input | Reduce frame-loop allocations; instrument distinct rates; add production touch-only and reduced/seated mode; test on real devices | Performance and body-only startup are the main reliability and access risks | src/game/platformer/usePlatformerRuntime.ts; GameController.ts; PlatformerScreen.tsx; CameraScreen.tsx; GameInputController.ts | Smoother play on older phones and a way to play without standing in camera view | P0 |
| Phase 11 — Age profiles and onboarding | Add parent-selected broad age profiles, visual-first instructions, adjustable sensitivity and early assistance | Children 2–15 need different text, movement and challenge expectations | HomeScreen.tsx; PlatformerScreen.tsx; motionThresholds.ts; DifficultyManager.ts; new profile/config modules | Younger children can start simply; older children can choose more control and challenge | P1 |
| Phase 12 — Interactive worlds | Add optional player-triggered scenery, route choices and varied obstacles with input equivalents | The world should respond with a new decision, not only a short animation | level.ts; GameController.ts; PlatformerRenderer.tsx; WorldReactionManager.ts; MissionManager.ts | More exploration and meaningful movement variety | P1 |
| Phase 13 — Adaptive mastery and replay | Correct skill metrics, use measured outcomes, add several routes and local best/progress | Current adaptation is limited and every replay repeats one course | PerformanceTracker.ts; ChallengeManager.ts; DifficultyManager.ts; MissionManager.ts; level.ts; result UI | Fairer assistance and a reason to replay without punitive streaks | P1 |
| Phase 14 — TV and release validation | Validate mDNS/QR/manual pairing, reconnect, resize/fullscreen, HDMI, camera lifecycle, accessibility and docs | Current relay tests are not physical receiver proof | ConnectTVScreen.tsx; ReceiverScreen.tsx; src/network/; scripts/network-host.cjs; TV_RECEIVER.md; README.md; MOBILE_GAME.md | Families can connect and play reliably across real home networks and devices | P1 |

END OF PHASE 9 AUDIT
