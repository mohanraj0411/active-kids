import Svg, {
  Circle,
  G,
  Line,
  Path,
  Polygon,
  Rect,
  Text as SvgText,
} from 'react-native-svg';
import { memo, Profiler, type ProfilerOnRenderCallback } from 'react';

import { PLATFORMER_CONFIG } from './config';
import type {
  EnemyObject,
  PlatformerLevelObject,
  PlatformerSnapshot,
  Rect as CollisionRect,
} from './types';

interface PlatformerRendererProps {
  state: PlatformerSnapshot;
  width: number;
  height: number;
  debug?: boolean;
  onRenderTime?: (durationMs: number) => void;
}

const DECORATION_RATIOS = [
  0.05, 0.11, 0.17, 0.23, 0.29, 0.35, 0.41, 0.47,
  0.53, 0.59, 0.65, 0.71, 0.77, 0.83, 0.89, 0.95,
];
const TREE_PALETTES = [
  ['#3C9C76', '#5CBF7E', '#86D78D'],
  ['#4C9D75', '#70C67E', '#A0DE8C'],
] as const;

export function PlatformerRenderer({
  state,
  width,
  height,
  debug = false,
  onRenderTime,
}: PlatformerRendererProps) {
  const scale = Math.max(0.65, width / PLATFORMER_CONFIG.referenceWidth);
  const player = state.player;
  const playerX = player.x;
  const isRunning = player.state === 'RUNNING' || (player.state === 'ATTACKING' && player.running);
  const isCrouching = player.state === 'CROUCHING';
  const isHit = player.state === 'HIT';
  const isCelebrating = player.state === 'CELEBRATING';
  const phase = Math.sin(player.animationTime * 13);
  const idleBob = player.state === 'IDLE' || isCelebrating
    ? Math.sin(player.animationTime * 3) * 2 * scale
    : 0;
  const runBounce = isRunning ? Math.abs(phase) * 3 * scale : 0;
  const hitShake = isHit ? Math.sin(player.animationTime * 48) * 3 * scale : 0;
  const runningAnimation = isRunning ? phase : 0;
  const jumpAnimation = player.state === 'JUMPING' || player.state === 'FALLING';
  const headX = playerX + player.width / 2 + hitShake;
  const animatedTop = player.y - idleBob - runBounce;
  const headY = animatedTop + player.height * (isCrouching ? 0.22 : 0.2);
  const bodyTop = animatedTop + player.height * 0.39;
  const bodyHeight = player.height * 0.35;
  const shoulderY = bodyTop + bodyHeight * 0.18;
  const bodyCenterX = headX;
  const hipY = bodyTop + bodyHeight;
  const footY = player.y + player.height - 3 * scale;
  const legSpan = (isCrouching ? 3 : 14) * scale;
  const leftKneeX = bodyCenterX - 6 * scale - runningAnimation * legSpan * 0.4;
  const rightKneeX = bodyCenterX + 6 * scale + runningAnimation * legSpan * 0.4;
  const leftFootX = bodyCenterX - 7 * scale - runningAnimation * legSpan;
  const rightFootX = bodyCenterX + 7 * scale + runningAnimation * legSpan;
  const legLift = jumpAnimation ? (player.state === 'JUMPING' ? -8 : 5) * scale : 0;
  const kneeY = hipY + (footY - hipY) * 0.48;
  const leftHandX = isCelebrating
    ? bodyCenterX - 24 * scale
    : player.state === 'ATTACKING'
      ? bodyCenterX + 24 * scale
      : bodyCenterX - (14 + runningAnimation * 5) * scale;
  const leftHandY = isCelebrating
    ? shoulderY - 22 * scale
    : shoulderY + (17 + runningAnimation * 4) * scale;
  const rightHandX = isCelebrating
    ? bodyCenterX + 24 * scale
    : player.state === 'ATTACKING'
      ? bodyCenterX + 23 * scale
      : bodyCenterX + (14 + runningAnimation * 5) * scale;
  const rightHandY = isCelebrating
    ? shoulderY - 22 * scale
    : player.state === 'ATTACKING'
      ? shoulderY + 8 * scale
      : shoulderY + (17 - runningAnimation * 5) * scale;
  const windup = player.attackProgress < 0.28;
  const swing = player.attackProgress >= 0.28 && player.attackProgress < 0.66;
  const batAngle = !player.attacking
    ? -Math.PI / 3
    : windup
      ? -2.3
      : swing
        ? -2.3 + ((player.attackProgress - 0.28) / 0.38) * 2.75
        : 0.45 + ((player.attackProgress - 0.66) / 0.34) * 0.45;
  const batLength = isCelebrating ? 0 : 56 * scale;
  const batTipX = rightHandX + Math.cos(batAngle) * batLength;
  const batTipY = rightHandY + Math.sin(batAngle) * batLength;
  const hitbox = player.attackHitActive ? getAttackRect(player, scale) : null;

  const handleProfilerRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
    onRenderTime?.(actualDuration);
  };

  return (
    <Profiler id="platformer-svg" onRender={handleProfilerRender}>
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Rect x={0} y={0} width={width} height={height} fill="#A9E7FF" />
      <Circle cx={width * 0.82} cy={48 * scale} r={24 * scale} fill="#FFF3A6" />
      <G fill="#FFFFFF" opacity={0.88}>
        <Circle cx={width * 0.18} cy={58 * scale} r={18 * scale} />
        <Circle cx={width * 0.21} cy={52 * scale} r={23 * scale} />
        <Circle cx={width * 0.24} cy={60 * scale} r={16 * scale} />
        <Circle cx={width * 0.61} cy={88 * scale} r={15 * scale} />
        <Circle cx={width * 0.64} cy={82 * scale} r={20 * scale} />
        <Circle cx={width * 0.67} cy={90 * scale} r={14 * scale} />
      </G>
      <Path
        d={`M0 ${state.level.groundY - 25 * scale} Q${width * 0.18} ${state.level.groundY - 78 * scale} ${width * 0.36} ${state.level.groundY - 26 * scale} T${width} ${state.level.groundY - 34 * scale} L${width} ${height} L0 ${height} Z`}
        fill="#8ED78B"
      />
      <Path
        d={`M0 ${state.level.groundY - 9 * scale} Q${width * 0.2} ${state.level.groundY - 26 * scale} ${width * 0.42} ${state.level.groundY - 10 * scale} T${width} ${state.level.groundY - 14 * scale}`}
        fill="none"
        stroke="#A5E39B"
        strokeWidth={7 * scale}
        opacity={0.82}
      />

      <G transform={`translate(${-state.cameraOffset} 0)`}>
        <Ground level={state.level} scale={scale} height={height} />
        <WorldDecorations
          worldWidth={state.level.worldWidth}
          groundY={state.level.groundY}
          scale={scale}
          crouchGates={state.level.crouchGates ?? []}
        />
        {state.objects.map((object) => (
          <WorldObject
            key={object.id}
            object={object}
            scale={scale}
            groundY={state.level.groundY}
            elapsedSeconds={state.elapsedSeconds}
          />
        ))}
        {state.feedback && renderFeedback(state.feedback, state.elapsedSeconds, scale)}
        {state.surprise && (
          <SurpriseVisual
            event={state.surprise}
            cameraOffset={state.cameraOffset}
            elapsedSeconds={state.elapsedSeconds}
            width={width}
            height={height}
            scale={scale}
          />
        )}
        <CompanionCharacter companion={state.companion} elapsedSeconds={state.elapsedSeconds} scale={scale} />
        <G>
          <Line
            x1={bodyCenterX}
            y1={hipY - 3 * scale}
            x2={leftKneeX}
            y2={kneeY + legLift * 0.45}
            stroke="#34446C"
            strokeWidth={7 * scale}
            strokeLinecap="round"
          />
          <Line
            x1={leftKneeX}
            y1={kneeY + legLift * 0.45}
            x2={leftFootX}
            y2={footY + legLift}
            stroke="#34446C"
            strokeWidth={7 * scale}
            strokeLinecap="round"
          />
          <Line
            x1={bodyCenterX + 2 * scale}
            y1={hipY - 3 * scale}
            x2={rightKneeX}
            y2={kneeY - legLift * 0.45}
            stroke="#34446C"
            strokeWidth={7 * scale}
            strokeLinecap="round"
          />
          <Line
            x1={rightKneeX}
            y1={kneeY - legLift * 0.45}
            x2={rightFootX}
            y2={footY - legLift}
            stroke="#34446C"
            strokeWidth={7 * scale}
            strokeLinecap="round"
          />
          <Line x1={leftFootX - 5 * scale} y1={footY + legLift} x2={leftFootX + 3 * scale} y2={footY + legLift} stroke="#F4C95D" strokeWidth={5 * scale} strokeLinecap="round" />
          <Line x1={rightFootX - 3 * scale} y1={footY - legLift} x2={rightFootX + 5 * scale} y2={footY - legLift} stroke="#F4C95D" strokeWidth={5 * scale} strokeLinecap="round" />
          <Rect
            y={bodyTop}
            width={player.width * 0.56}
            x={bodyCenterX - player.width * 0.28}
            height={bodyHeight}
            rx={13 * scale}
            fill={isHit ? '#F28B62' : isCelebrating ? '#FFD943' : '#31BD93'}
            stroke={isHit ? '#B8554B' : isCelebrating ? '#C58D20' : '#167757'}
            strokeWidth={2 * scale}
          />
          <Path d={`M${bodyCenterX - 9 * scale} ${bodyTop + 3 * scale} l${9 * scale} ${7 * scale} l${9 * scale} ${-7 * scale}`} fill="none" stroke="#E8FFF5" strokeWidth={2.5 * scale} strokeLinecap="round" strokeLinejoin="round" />
          <Circle cx={bodyCenterX} cy={bodyTop + bodyHeight * 0.57} r={3.5 * scale} fill="#F4C95D" stroke="#FFF5C2" strokeWidth={1.3 * scale} />
          <Path
            d={`M${bodyCenterX - 14 * scale} ${shoulderY} Q${bodyCenterX - 25 * scale} ${shoulderY + 10 * scale} ${leftHandX} ${leftHandY}`}
            fill="none"
            stroke="#FFD2A8"
            strokeWidth={7 * scale}
            strokeLinecap="round"
          />
          <Path
            d={`M${bodyCenterX + 14 * scale} ${shoulderY} Q${bodyCenterX + 24 * scale} ${shoulderY + 8 * scale} ${rightHandX} ${rightHandY}`}
            fill="none"
            stroke="#FFD2A8"
            strokeWidth={7 * scale}
            strokeLinecap="round"
          />
          {!isCelebrating && <Line x1={rightHandX} y1={rightHandY} x2={batTipX} y2={batTipY} stroke="#8B552E" strokeWidth={8 * scale} strokeLinecap="round" />}
          {!isCelebrating && <Line x1={rightHandX + Math.cos(batAngle) * batLength * 0.78} y1={rightHandY + Math.sin(batAngle) * batLength * 0.78} x2={batTipX} y2={batTipY} stroke="#F4C95D" strokeWidth={11 * scale} strokeLinecap="round" />}
          <Circle cx={rightHandX} cy={rightHandY} r={4.5 * scale} fill="#FFD2A8" />
          {player.attackHitActive && (
            <Path
              d={`M${rightHandX + 15 * scale} ${rightHandY - 42 * scale} Q${rightHandX + 70 * scale} ${rightHandY - 15 * scale} ${rightHandX + 66 * scale} ${rightHandY + 30 * scale}`}
              fill="none"
              stroke="#FFF4A8"
              strokeWidth={6 * scale}
              strokeLinecap="round"
            />
          )}
          <Circle
            cx={headX}
            cy={headY}
            r={(isCrouching ? 16 : 19) * scale}
            fill="#FFD2A8"
            stroke="#A66A49"
            strokeWidth={2 * scale}
          />
          <Path
            d={`M${headX - 18 * scale} ${headY - 4 * scale} Q${headX - 12 * scale} ${headY - 25 * scale} ${headX + 10 * scale} ${headY - 17 * scale} Q${headX + 20 * scale} ${headY - 12 * scale} ${headX + 18 * scale} ${headY - 2 * scale}`}
            fill="#5B4A75"
          />
          <Circle cx={headX - 6 * scale} cy={headY + 1 * scale} r={1.8 * scale} fill="#352C3E" />
          <Circle cx={headX + 6 * scale} cy={headY + 1 * scale} r={1.8 * scale} fill="#352C3E" />
          <Path
            d={`M${headX - 4 * scale} ${headY + 8 * scale} Q${headX} ${headY + 12 * scale} ${headX + 5 * scale} ${headY + 8 * scale}`}
            fill="none"
            stroke="#A65D52"
            strokeWidth={1.7 * scale}
            strokeLinecap="round"
          />
          <Circle cx={headX + 12 * scale} cy={headY + 4 * scale} r={2 * scale} fill="#FFFFFF" />
          {debug && (
            <Rect
              x={player.x}
              y={player.y}
              width={player.width}
              height={player.height}
              fill="none"
              stroke="#FF5555"
              strokeDasharray="5 4"
              strokeWidth={1.5 * scale}
            />
          )}
        </G>
        {debug && hitbox && (
          <Rect
            x={hitbox.x}
            y={hitbox.y}
            width={hitbox.width}
            height={hitbox.height}
            fill="#FF4040"
            fillOpacity={0.22}
            stroke="#FF4040"
            strokeWidth={2 * scale}
          />
        )}
        {state.worldReaction && (
          <WorldReactionParticles reaction={state.worldReaction} elapsedSeconds={state.elapsedSeconds} scale={scale} />
        )}
      </G>

    </Svg>
    </Profiler>
  );
}

const WorldDecorations = memo(function WorldDecorations({
  worldWidth,
  groundY,
  scale,
  crouchGates,
}: {
  worldWidth: number;
  groundY: number;
  scale: number;
  crouchGates: NonNullable<PlatformerSnapshot['level']['crouchGates']>;
}) {
  return (
    <G>
      {DECORATION_RATIOS.map((ratio, index) => {
        const x = worldWidth * ratio;
        const treeHeight = (38 + (index % 3) * 8) * scale;
        const treeY = groundY - treeHeight;
        const colors = TREE_PALETTES[index % TREE_PALETTES.length];
        return (
          <G key={`tree-${index}`}>
            <Rect x={x - 3 * scale} y={treeY + 18 * scale} width={6 * scale} height={treeHeight - 14 * scale} rx={3 * scale} fill="#9A6744" />
            <Circle cx={x} cy={treeY + 14 * scale} r={18 * scale} fill={colors[0]} />
            <Circle cx={x - 11 * scale} cy={treeY + 22 * scale} r={12 * scale} fill={colors[1]} />
            <Circle cx={x + 11 * scale} cy={treeY + 22 * scale} r={12 * scale} fill={colors[2]} />
            <Circle cx={x + 38 * scale} cy={groundY - 6 * scale} r={13 * scale} fill="#52AE67" />
            <Circle cx={x + 50 * scale} cy={groundY - 5 * scale} r={10 * scale} fill="#70C776" />
          </G>
        );
      })}
      {crouchGates.map((gate, index) => {
        const postWidth = 13 * scale;
        const archY = groundY - 90 * scale;
        return (
          <G key={`crouch-arch-${index}`}>
            <Rect x={gate.x} y={archY} width={postWidth} height={groundY - archY} rx={5 * scale} fill="#9A6744" />
            <Rect x={gate.x + gate.width - postWidth} y={archY} width={postWidth} height={groundY - archY} rx={5 * scale} fill="#9A6744" />
            <Rect x={gate.x} y={archY - 9 * scale} width={gate.width} height={20 * scale} rx={10 * scale} fill="#54AC68" stroke="#31895A" strokeWidth={3 * scale} />
            <Circle cx={gate.x + gate.width * 0.3} cy={archY - 6 * scale} r={13 * scale} fill="#7BD17C" />
            <Circle cx={gate.x + gate.width * 0.68} cy={archY - 6 * scale} r={13 * scale} fill="#7BD17C" />
          </G>
        );
      })}
    </G>
  );
});

const Ground = memo(function Ground({
  level,
  scale,
  height,
}: {
  level: PlatformerSnapshot['level'];
  scale: number;
  height: number;
}) {
  const segments = getGroundSegments(level);

  return (
    <>
      {segments.map((segment) => (
        <G key={`${segment.x}-${segment.width}`}>
          <Rect
            x={segment.x}
            y={level.groundY}
            width={segment.width}
            height={height - level.groundY + 50 * scale}
            fill="#63B966"
          />
          <Rect
            x={segment.x}
            y={level.groundY}
            width={segment.width}
            height={12 * scale}
            fill="#3D9C57"
          />
        </G>
      ))}
    </>
  );
});

const groundSegmentsByLevel = new WeakMap<PlatformerSnapshot['level'], readonly { x: number; width: number }[]>();

function getGroundSegments(level: PlatformerSnapshot['level']): readonly { x: number; width: number }[] {
  const cached = groundSegmentsByLevel.get(level);
  if (cached) return cached;
  const gaps = level.objects
    .filter((object): object is Extract<PlatformerLevelObject, { type: 'GAP' }> => object.type === 'GAP')
    .sort((first, second) => first.x - second.x);
  const segments: { x: number; width: number }[] = [];
  let cursor = 0;
  for (const gap of gaps) {
    if (gap.x > cursor) segments.push({ x: cursor, width: gap.x - cursor });
    cursor = gap.x + gap.width;
  }
  if (level.worldWidth > cursor) segments.push({ x: cursor, width: level.worldWidth - cursor });
  const stableSegments = Object.freeze(segments.map((segment) => Object.freeze(segment)));
  groundSegmentsByLevel.set(level, stableSegments);
  return stableSegments;
}

function WorldObject({
  object,
  scale,
  groundY,
  elapsedSeconds,
}: {
  object: PlatformerLevelObject;
  scale: number;
  groundY: number;
  elapsedSeconds: number;
}) {
  switch (object.type) {
    case 'PLATFORM':
      return (
        <G>
          <Rect x={object.x} y={object.y} width={object.width} height={object.height} rx={5 * scale} fill="#A6764F" />
          <Rect x={object.x} y={object.y} width={object.width} height={5 * scale} rx={3 * scale} fill="#D8A86B" />
        </G>
      );
    case 'COLLECTIBLE':
      if (object.collected) return null;
      {
        const bob = Math.sin(elapsedSeconds * 3 + object.x * 0.015) * 3 * scale;
        const pulse = 1 + Math.sin(elapsedSeconds * 4 + object.x * 0.01) * 0.08;
        if (object.kind === 'FRUIT') {
          return (
            <G transform={`translate(${object.x} ${object.y + bob}) scale(${pulse})`}>
              <Circle cx={0} cy={1 * scale} r={object.radius * 0.9} fill="#FF8C62" stroke="#D9694D" strokeWidth={2 * scale} />
              <Path d={`M${-4 * scale} ${-object.radius * 0.55} q${7 * scale} ${-8 * scale} ${14 * scale} ${-4 * scale} q${-4 * scale} ${8 * scale} ${-14 * scale} ${4 * scale}`} fill="#70C776" />
              <Line x1={0} y1={-object.radius * 0.7} x2={2 * scale} y2={-object.radius * 1.05} stroke="#8B552E" strokeWidth={3 * scale} strokeLinecap="round" />
              <Circle cx={-5 * scale} cy={-2 * scale} r={2 * scale} fill="#FFD4A8" opacity={0.85} />
            </G>
          );
        }
        const radius = object.radius * pulse;
        const y = object.y + bob;
        return (
          <G>
            <Circle cx={object.x} cy={y} r={radius * 1.35} fill="#FFF5B7" opacity={0.28} />
            <Circle cx={object.x} cy={y} r={radius} fill="#FFD943" stroke="#D69324" strokeWidth={2 * scale} />
            <Polygon points={makeStarPoints(object.x, y, radius * 0.65, radius * 0.3)} fill="#FFF7CA" />
          </G>
        );
      }
    case 'ENEMY':
      if (object.defeated) {
        const hitAge = object.hitAt == null ? Number.POSITIVE_INFINITY : elapsedSeconds - object.hitAt;
        return hitAge < 0.48
          ? <EnemyDefeatEffect object={object} scale={scale} elapsedSeconds={elapsedSeconds} />
          : null;
      }
      return (
        <FriendlySpider
          object={object}
          scale={scale}
          elapsedSeconds={elapsedSeconds}
          moving={object.state === 'MOVE'}
        />
      );
    case 'GAP':
      return (
        <G>
          <Rect x={object.x} y={groundY} width={object.width} height={60 * scale} fill="#477B73" />
          <Path d={`M${object.x} ${groundY} l${10 * scale} ${20 * scale} h${-10 * scale} z M${object.x + object.width} ${groundY} l${-10 * scale} ${20 * scale} h${10 * scale} z`} fill="#3C665F" />
        </G>
      );
    case 'FINISH':
      return (
        <G>
          <Line x1={object.x} y1={groundY - 118 * scale} x2={object.x} y2={groundY} stroke="#765C45" strokeWidth={6 * scale} strokeLinecap="round" />
          <Path d={`M${object.x + 2 * scale} ${groundY - 116 * scale} l${58 * scale} ${16 * scale} l${-58 * scale} ${22 * scale} z`} fill="#FF7C68" stroke="#C95054" strokeWidth={2 * scale} />
          <Circle cx={object.x} cy={groundY - 120 * scale} r={7 * scale} fill="#F4C95D" />
        </G>
      );
  }
}

function renderFeedback(
  feedback: NonNullable<PlatformerSnapshot['feedback']>,
  elapsedSeconds: number,
  scale: number,
) {
  const age = elapsedSeconds - feedback.time;
  if (age < 0 || age > 0.95) return null;
  const progress = age / 0.95;
  const color = feedback.type === 'COLLECTIBLE' || feedback.type === 'COMBO'
    ? '#FFF17A'
    : feedback.type === 'ENEMY_HIT'
      ? '#B7FF8A'
      : feedback.type === 'RESPAWN'
        ? '#FFD6A8'
        : feedback.type === 'GATE'
          ? '#E9F5FF'
      : '#FFFFFF';
  return (
    <G key={`feedback-${feedback.id}`} opacity={1 - progress}>
      <SvgText
        x={feedback.x}
        y={feedback.y - progress * 54 * scale}
        fill={color}
        stroke="#43536B"
        strokeWidth={2.5 * scale}
        fontSize={(feedback.type === 'COLLECTIBLE' || feedback.type === 'COMBO' ? 24 : 21) * scale}
        fontWeight="900"
        textAnchor="middle"
      >
        {feedback.label}
      </SvgText>
    </G>
  );
}

function EnemyDefeatEffect({
  object,
  scale,
  elapsedSeconds,
}: {
  object: EnemyObject;
  scale: number;
  elapsedSeconds: number;
}) {
  const progress = Math.max(0, Math.min(1, (elapsedSeconds - (object.hitAt ?? elapsedSeconds)) / 0.48));
  const x = object.x + object.width / 2;
  const y = object.y + object.height * 0.55 - progress * 24 * scale;
  return (
    <G opacity={1 - progress}>
      <Circle cx={x} cy={y} r={(20 + progress * 14) * scale} fill="#FFF0A8" opacity={0.72} />
      <SvgText x={x} y={y + 5 * scale} fill="#68517C" fontSize={15 * scale} fontWeight="900" textAnchor="middle">POP!</SvgText>
    </G>
  );
}

function CompanionCharacter({
  companion,
  elapsedSeconds,
  scale,
}: {
  companion: PlatformerSnapshot['companion'];
  elapsedSeconds: number;
  scale: number;
}) {
  const animated = companion.mood !== 'WAITING';
  const bounce = animated ? Math.abs(Math.sin(elapsedSeconds * 9)) * 5 * scale : Math.sin(elapsedSeconds * 3) * 1.5 * scale;
  const fill = companion.mood === 'ENCOURAGING' ? '#8CC8F0' : '#8BE0C1';
  return (
    <G transform={`translate(${companion.x} ${companion.y - bounce})`}>
      <Path d={`M${8 * scale} ${20 * scale} Q${-1 * scale} ${10 * scale} ${6 * scale} ${5 * scale}`} fill="none" stroke="#397B87" strokeWidth={3 * scale} strokeLinecap="round" />
      <Circle cx={16 * scale} cy={17 * scale} r={14 * scale} fill={fill} stroke="#397B87" strokeWidth={2 * scale} />
      <Circle cx={11 * scale} cy={15 * scale} r={2 * scale} fill="#24384A" />
      <Circle cx={20 * scale} cy={15 * scale} r={2 * scale} fill="#24384A" />
      <Path d={`M${13 * scale} ${21 * scale} q${3 * scale} ${3 * scale} ${6 * scale} 0`} fill="none" stroke="#397B87" strokeWidth={1.6 * scale} strokeLinecap="round" />
      <Path d={`M${27 * scale} ${19 * scale} l${9 * scale} ${4 * scale} l${-9 * scale} ${4 * scale} z`} fill="#F4A85B" stroke="#C77B3E" strokeWidth={1.2 * scale} />
      <Line x1={12 * scale} y1={30 * scale} x2={10 * scale} y2={34 * scale} stroke="#C77B3E" strokeWidth={2 * scale} strokeLinecap="round" />
      <Line x1={21 * scale} y1={30 * scale} x2={23 * scale} y2={34 * scale} stroke="#C77B3E" strokeWidth={2 * scale} strokeLinecap="round" />
      {companion.mood === 'CELEBRATING' && (
        <Polygon points={makeStarPoints(16 * scale, -2 * scale, 6 * scale, 3 * scale)} fill="#FFE46B" />
      )}
    </G>
  );
}

function WorldReactionParticles({
  reaction,
  elapsedSeconds,
  scale,
}: {
  reaction: NonNullable<PlatformerSnapshot['worldReaction']>;
  elapsedSeconds: number;
  scale: number;
}) {
  const progress = Math.max(0, Math.min(1, (elapsedSeconds - reaction.startedAt) / reaction.duration));
  const count = reaction.type === 'COMBO' ? 7 : 4;
  const colors = reaction.type === 'FAIL'
    ? ['#BDE7FF', '#FFFFFF']
    : reaction.type === 'COMBO' || reaction.type === 'MISSION'
      ? ['#FFE46B', '#FFFFFF', '#8BE0C1']
      : ['#FFF6B5', '#FFFFFF'];
  return (
    <G opacity={1 - progress}>
      {Array.from({ length: count }, (_, index) => {
        const angle = (index / count) * Math.PI * 2;
        const distance = (10 + progress * 38) * scale * reaction.intensity;
        return (
          <Circle
            key={`${reaction.id}-${index}`}
            cx={reaction.x + Math.cos(angle) * distance}
            cy={reaction.y + Math.sin(angle) * distance}
            r={(3 + reaction.intensity * 2) * scale * (1 - progress * 0.45)}
            fill={colors[index % colors.length]}
          />
        );
      })}
    </G>
  );
}

function SurpriseVisual({
  event,
  cameraOffset,
  elapsedSeconds,
  width,
  height,
  scale,
}: {
  event: NonNullable<PlatformerSnapshot['surprise']>;
  cameraOffset: number;
  elapsedSeconds: number;
  width: number;
  height: number;
  scale: number;
}) {
  const screenX = width * (1.12 - event.progress * 1.28);
  const x = cameraOffset + screenX;
  const y = height * 0.2 + Math.sin(elapsedSeconds * 5) * 5 * scale;
  if (event.type === 'BIRD') {
    const wing = Math.sin(elapsedSeconds * 18) * 8 * scale;
    return (
      <G>
        <Circle cx={x} cy={y} r={9 * scale} fill="#6B85C5" />
        <Circle cx={x + 7 * scale} cy={y - 3 * scale} r={6 * scale} fill="#8DA6E4" />
        <Path d={`M${x - 2 * scale} ${y} q${-10 * scale} ${-14 * scale - wing} ${-16 * scale} ${-6 * scale}`} fill="none" stroke="#526DAF" strokeWidth={4 * scale} strokeLinecap="round" />
        <Path d={`M${x + 3 * scale} ${y} q${10 * scale} ${-14 * scale + wing} ${16 * scale} ${-6 * scale}`} fill="none" stroke="#526DAF" strokeWidth={4 * scale} strokeLinecap="round" />
        <Path d={`M${x + 12 * scale} ${y - 3 * scale} l${8 * scale} ${3 * scale} l${-8 * scale} ${3 * scale} z`} fill="#F4A85B" />
      </G>
    );
  }
  return (
    <G>
      {Array.from({ length: 6 }, (_, index) => {
        const leafX = x + Math.sin(index * 7 + elapsedSeconds * 3) * 36 * scale;
        const leafY = y + ((event.progress * 120 + index * 23) % 120) * scale;
        return (
          <G key={`${event.id}-${index}`} transform={`rotate(${index * 41 + elapsedSeconds * 18} ${leafX} ${leafY})`}>
            <Path d={`M${leafX} ${leafY - 5 * scale} q${9 * scale} ${5 * scale} 0 ${10 * scale} q${-9 * scale} ${-5 * scale} 0 ${-10 * scale} z`} fill={index % 2 ? '#F4B85B' : '#F08F61'} />
          </G>
        );
      })}
    </G>
  );
}

function FriendlySpider({ object, scale, elapsedSeconds, moving }: {
  object: EnemyObject;
  scale: number;
  elapsedSeconds: number;
  moving: boolean;
}) {
  const centerX = object.x + object.width / 2;
  const centerY = object.y + object.height * 0.57 + Math.sin(elapsedSeconds * (moving ? 7 : 3) + object.x) * (moving ? 4 : 2) * scale;
  const legWiggle = Math.sin(elapsedSeconds * (moving ? 11 : 5) + object.x) * (moving ? 5 : 2) * scale;
  return (
    <G>
      <G stroke="#69547E" strokeWidth={4 * scale} strokeLinecap="round" fill="none">
        <Path d={`M${centerX - 8 * scale} ${centerY + 5 * scale} q${-16 * scale} ${-12 * scale} ${-22 * scale} ${-4 * scale + legWiggle}`} />
        <Path d={`M${centerX - 8 * scale} ${centerY + 10 * scale} q${-19 * scale} ${3 * scale} ${-24 * scale} ${14 * scale - legWiggle}`} />
        <Path d={`M${centerX - 4 * scale} ${centerY + 12 * scale} q${-10 * scale} ${13 * scale} ${-16 * scale} ${20 * scale}`} />
        <Path d={`M${centerX + 8 * scale} ${centerY + 5 * scale} q${16 * scale} ${-12 * scale} ${22 * scale} ${-4 * scale - legWiggle}`} />
        <Path d={`M${centerX + 8 * scale} ${centerY + 10 * scale} q${19 * scale} ${3 * scale} ${24 * scale} ${14 * scale + legWiggle}`} />
        <Path d={`M${centerX + 4 * scale} ${centerY + 12 * scale} q${10 * scale} ${13 * scale} ${16 * scale} ${20 * scale}`} />
      </G>
      <EllipseBody x={centerX} y={centerY} width={object.width * 0.68} height={object.height * 0.72} scale={scale} />
      <Circle cx={centerX - 5 * scale} cy={centerY - 4 * scale} r={4 * scale} fill="#FFFFFF" />
      <Circle cx={centerX + 6 * scale} cy={centerY - 4 * scale} r={4 * scale} fill="#FFFFFF" />
      <Circle cx={centerX - 4 * scale} cy={centerY - 3 * scale} r={1.7 * scale} fill="#342B45" />
      <Circle cx={centerX + 7 * scale} cy={centerY - 3 * scale} r={1.7 * scale} fill="#342B45" />
      <Path d={`M${centerX - 3 * scale} ${centerY + 5 * scale} q${4 * scale} ${4 * scale} ${8 * scale} 0`} fill="none" stroke="#FFFFFF" strokeWidth={1.8 * scale} strokeLinecap="round" />
    </G>
  );
}

function EllipseBody({
  x,
  y,
  width,
  height,
  scale,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}) {
  return <Circle cx={x} cy={y} r={Math.min(width, height) / 2} fill="#755B8B" stroke="#59456D" strokeWidth={2 * scale} />;
}

function makeStarPoints(cx: number, cy: number, outer: number, inner: number): string {
  const points: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    points.push(`${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`);
  }
  return points.join(' ');
}

function getAttackRect(player: PlatformerSnapshot['player'], scale: number): CollisionRect {
  return {
    x: player.x + player.width - 4 * scale,
    y: player.y + player.height * 0.35,
    width: PLATFORMER_CONFIG.attackReach * scale,
    height: PLATFORMER_CONFIG.attackHitboxHeight * scale,
  };
}
