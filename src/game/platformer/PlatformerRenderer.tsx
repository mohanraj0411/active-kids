import Svg, {
  Circle,
  G,
  Line,
  Path,
  Polygon,
  Rect,
  Text as SvgText,
} from 'react-native-svg';

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
}

export function PlatformerRenderer({
  state,
  width,
  height,
  debug = false,
}: PlatformerRendererProps) {
  const scale = Math.max(0.65, width / PLATFORMER_CONFIG.referenceWidth);
  const player = state.player;
  const playerX = player.x;
  const phase = Math.sin(player.animationTime * 12);
  const idleBob = player.state === 'IDLE'
    ? Math.sin(player.animationTime * 3) * 1.5 * scale
    : 0;
  const runningAnimation = player.state === 'RUNNING' ? phase : 0;
  const jumpAnimation = player.state === 'JUMPING' || player.state === 'FALLING';
  const headX = playerX + player.width / 2;
  const animatedTop = player.y - idleBob;
  const headY = animatedTop + Math.min(20 * scale, player.height * 0.24);
  const bodyTop = animatedTop + Math.min(39 * scale, player.height * 0.44);
  const bodyHeight = player.height * 0.36;
  const shoulderY = bodyTop + bodyHeight * 0.18;
  const bodyCenterX = headX;
  const hipY = bodyTop + bodyHeight;
  const footY = player.y + player.height - 3 * scale;
  const legSpan = 11 * scale;
  const leftFootX = bodyCenterX - 7 * scale - runningAnimation * legSpan;
  const rightFootX = bodyCenterX + 7 * scale + runningAnimation * legSpan;
  const legLift = jumpAnimation ? (player.state === 'JUMPING' ? -5 : 4) * scale : 0;
  const leftArmEndX = player.state === 'ATTACKING'
    ? bodyCenterX + 42 * scale
    : bodyCenterX - (14 + runningAnimation * 6) * scale;
  const rightArmEndX = player.state === 'ATTACKING'
    ? bodyCenterX + 38 * scale
    : bodyCenterX + (14 + runningAnimation * 6) * scale;
  const rightArmEndY = player.state === 'ATTACKING'
    ? shoulderY + 3 * scale
    : shoulderY + (16 - runningAnimation * 5) * scale;
  const hitbox = player.attackHitActive ? getAttackRect(player, scale) : null;

  return (
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

      <G transform={`translate(${-state.cameraOffset} 0)`}>
        <Ground state={state} scale={scale} height={height} />
        {state.level.objects.map((object) => (
          <WorldObject key={object.id} object={object} scale={scale} groundY={state.level.groundY} />
        ))}
        <G>
          <Line
            x1={bodyCenterX}
            y1={hipY - 3 * scale}
            x2={leftFootX}
            y2={footY + legLift}
            stroke="#34446C"
            strokeWidth={9 * scale}
            strokeLinecap="round"
          />
          <Line
            x1={bodyCenterX + 2 * scale}
            y1={hipY - 3 * scale}
            x2={rightFootX}
            y2={footY - legLift}
            stroke="#34446C"
            strokeWidth={9 * scale}
            strokeLinecap="round"
          />
          <Rect
            x={bodyCenterX - player.width * 0.25}
            y={bodyTop}
            width={player.width * 0.5}
            height={bodyHeight}
            rx={12 * scale}
            fill={player.state === 'CROUCHING' ? '#2DB78B' : '#31BD93'}
            stroke="#167757"
            strokeWidth={2 * scale}
          />
          <Path
            d={`M${bodyCenterX - 14 * scale} ${shoulderY} Q${bodyCenterX - 25 * scale} ${shoulderY + (12 + runningAnimation * 5) * scale} ${leftArmEndX} ${shoulderY + (18 - runningAnimation * 5) * scale}`}
            fill="none"
            stroke="#FFD2A8"
            strokeWidth={8 * scale}
            strokeLinecap="round"
          />
          <Path
            d={`M${bodyCenterX + 14 * scale} ${shoulderY} Q${bodyCenterX + 25 * scale} ${shoulderY + (12 - runningAnimation * 5) * scale} ${rightArmEndX} ${rightArmEndY}`}
            fill="none"
            stroke="#FFD2A8"
            strokeWidth={8 * scale}
            strokeLinecap="round"
          />
          {player.attacking && (
            <>
              <Line
                x1={rightArmEndX - 4 * scale}
                y1={rightArmEndY}
                x2={rightArmEndX + 64 * scale}
                y2={rightArmEndY - 24 * scale}
                stroke="#8B552E"
                strokeWidth={10 * scale}
                strokeLinecap="round"
              />
              <Line
                x1={rightArmEndX + 44 * scale}
                y1={rightArmEndY - 17 * scale}
                x2={rightArmEndX + 53 * scale}
                y2={rightArmEndY + 2 * scale}
                stroke="#F4C95D"
                strokeWidth={8 * scale}
                strokeLinecap="round"
              />
              {player.attackHitActive && (
                <Path
                  d={`M${rightArmEndX + 58 * scale} ${rightArmEndY - 32 * scale} Q${rightArmEndX + 82 * scale} ${rightArmEndY - 8 * scale} ${rightArmEndX + 69 * scale} ${rightArmEndY + 18 * scale}`}
                  fill="none"
                  stroke="#FFF4A8"
                  strokeWidth={5 * scale}
                  strokeLinecap="round"
                />
              )}
            </>
          )}
          <Circle
            cx={headX}
            cy={headY}
            r={19 * scale}
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
      </G>

      <SvgText
        x={12 * scale}
        y={height - 12 * scale}
        fill="#5F8E57"
        fontSize={10 * scale}
        fontWeight="700"
      >
        ACTIVE KIDS · ORIGINAL PLACEHOLDER WORLD
      </SvgText>
    </Svg>
  );
}

function Ground({
  state,
  scale,
  height,
}: {
  state: PlatformerSnapshot;
  scale: number;
  height: number;
}) {
  const gaps = state.level.objects
    .filter((object): object is Extract<PlatformerLevelObject, { type: 'GAP' }> => object.type === 'GAP')
    .sort((first, second) => first.x - second.x);
  const segments: { x: number; width: number }[] = [];
  let cursor = 0;
  for (const gap of gaps) {
    if (gap.x > cursor) segments.push({ x: cursor, width: gap.x - cursor });
    cursor = gap.x + gap.width;
  }
  if (state.level.worldWidth > cursor) {
    segments.push({ x: cursor, width: state.level.worldWidth - cursor });
  }

  return (
    <>
      {segments.map((segment) => (
        <G key={`${segment.x}-${segment.width}`}>
          <Rect
            x={segment.x}
            y={state.level.groundY}
            width={segment.width}
            height={height - state.level.groundY + 50 * scale}
            fill="#63B966"
          />
          <Rect
            x={segment.x}
            y={state.level.groundY}
            width={segment.width}
            height={12 * scale}
            fill="#3D9C57"
          />
        </G>
      ))}
    </>
  );
}

function WorldObject({
  object,
  scale,
  groundY,
}: {
  object: PlatformerLevelObject;
  scale: number;
  groundY: number;
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
      return object.collected ? null : (
        <G>
          <Circle cx={object.x} cy={object.y} r={object.radius} fill="#FFD943" stroke="#D69324" strokeWidth={2 * scale} />
          <Polygon points={makeStarPoints(object.x, object.y, object.radius * 0.65, object.radius * 0.3)} fill="#FFF7CA" />
        </G>
      );
    case 'ENEMY':
      return object.defeated ? null : <FriendlySpider object={object} scale={scale} />;
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

function FriendlySpider({ object, scale }: { object: EnemyObject; scale: number }) {
  const centerX = object.x + object.width / 2;
  const centerY = object.y + object.height * 0.57;
  return (
    <G>
      <G stroke="#69547E" strokeWidth={4 * scale} strokeLinecap="round" fill="none">
        <Path d={`M${centerX - 8 * scale} ${centerY + 5 * scale} q${-16 * scale} ${-12 * scale} ${-22 * scale} ${-4 * scale}`} />
        <Path d={`M${centerX - 8 * scale} ${centerY + 10 * scale} q${-19 * scale} ${3 * scale} ${-24 * scale} ${14 * scale}`} />
        <Path d={`M${centerX - 4 * scale} ${centerY + 12 * scale} q${-10 * scale} ${13 * scale} ${-16 * scale} ${20 * scale}`} />
        <Path d={`M${centerX + 8 * scale} ${centerY + 5 * scale} q${16 * scale} ${-12 * scale} ${22 * scale} ${-4 * scale}`} />
        <Path d={`M${centerX + 8 * scale} ${centerY + 10 * scale} q${19 * scale} ${3 * scale} ${24 * scale} ${14 * scale}`} />
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
