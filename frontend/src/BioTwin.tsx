import { Component, Suspense, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import { Bone, Box, Brain, ChevronLeft, ChevronRight, Eye, HeartPulse, RotateCcw, ScanLine, Shield, Wind } from 'lucide-react';
import { MathUtils, Spherical } from 'three';
import { STATUS_COLOR, type Status, type SystemId, type SystemState } from './engine';
import HumanModel from './HumanModel';
import './BioTwin.css';

const MODEL_HEIGHT = 3.2;
const FEET_Y = -1.6;
const CAMERA_ANGLE_LIMIT = Math.PI / 4;
const CAMERA = { position: [0, 0.1, 5.25] as [number, number, number], fov: 46 };

const HOTSPOTS = {
  brain: { anchor: [0.00, 0.95], height: 0.91, side: 1, label: 'Cognition', icon: Brain },
  eyes: { anchor: [-0.06, 0.89], height: 0.87, side: -1, label: 'Vision', icon: Eye },
  heart: { anchor: [0.15, 0.69], height: 0.64, side: 1, label: 'Heart', icon: HeartPulse },
  lungs: { anchor: [-0.15, 0.72], height: 0.63, side: -1, label: 'Lungs', icon: Wind },
  immune: { anchor: [-0.08, 0.54], height: 0.39, side: -1, label: 'Immune', icon: Shield },
  bones: { anchor: [0.16, 0.27], height: 0.27, side: 1, label: 'Bones & muscles', icon: Bone },
} satisfies Record<SystemId, { anchor: [number, number]; height: number; side: number; label: string; icon: typeof Brain }>;

interface Props {
  systems: Record<SystemId, SystemState>;
  selected: SystemId | null;
  onSelect: (id: SystemId | null) => void;
  tint: Status;
}

type CameraCommand = { action: 'left' | 'right' | 'reset' };

class ModelBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function CameraControls({ command }: { command: CameraCommand | null }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    const orbit = controls.current;
    if (!orbit || !command) return;

    if (command.action === 'reset') {
      orbit.reset();
      return;
    }

    const offset = camera.position.clone().sub(orbit.target);
    const angle = new Spherical().setFromVector3(offset);
    const step = command.action === 'left' ? -Math.PI / 12 : Math.PI / 12;
    angle.theta = MathUtils.clamp(angle.theta + step, -CAMERA_ANGLE_LIMIT, CAMERA_ANGLE_LIMIT);
    camera.position.copy(offset.setFromSpherical(angle).add(orbit.target));
    orbit.update();
  }, [camera, command]);

  return (
    <OrbitControls
      ref={controls}
      enableDamping={false}
      enableZoom={false}
      enablePan={false}
      minAzimuthAngle={-CAMERA_ANGLE_LIMIT}
      maxAzimuthAngle={CAMERA_ANGLE_LIMIT}
      minPolarAngle={1.16}
      maxPolarAngle={1.8}
    />
  );
}

function Marker({ system, selected, onSelect }: { system: SystemState; selected: boolean; onSelect: () => void }) {
  const color = STATUS_COLOR[system.status];
  const marker = HOTSPOTS[system.id];

  return (
    <button
      className={`bt-marker ${marker.side < 0 ? 'bt-marker-left' : 'bt-marker-right'}`}
      type="button"
      aria-label={`View ${system.label}, ${system.status}`}
      aria-pressed={selected}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <span className="bt-marker-core" style={{ color }} aria-hidden="true" />
      <span className="bt-marker-label" aria-hidden="true">{marker.label}</span>
    </button>
  );
}

function ModelScene({
  systems, selected, onSelect, tint, command, onReady,
}: Props & { command: CameraCommand | null; onReady: (ready: boolean) => void }) {
  const tone = tint === 'nominal' ? '#5ce4db' : STATUS_COLOR[tint];

  useEffect(() => onReady(true), [onReady]);

  return (
    <>
      <hemisphereLight args={['#d8f0ff', '#516785', 2.3]} />
      <directionalLight position={[-2, 5, 4]} color="#e4f4ff" intensity={2.4} />
      <directionalLight position={[2, 2, -3]} color={tone} intensity={3.2} />

      <group position={[0, FEET_Y, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.78, 0.79, 80]} />
          <meshBasicMaterial color={tone} transparent opacity={0.55} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1, 1.01, 80]} />
          <meshBasicMaterial color={tone} transparent opacity={0.25} />
        </mesh>
        <HumanModel height={MODEL_HEIGHT} />

        {Object.values(systems).map((system) => {
          const { anchor, height, side } = HOTSPOTS[system.id];
          const lineStart: [number, number, number] = [anchor[0], anchor[1] * MODEL_HEIGHT, 0.38];
          const endpoint: [number, number, number] = [side * 1.25, height * MODEL_HEIGHT, 0.38];
          const color = STATUS_COLOR[system.status];

          return (
            <group key={system.id}>
              <Line points={[lineStart, endpoint]} color={color} lineWidth={1} transparent opacity={0.5} depthTest={false} />
              <mesh position={lineStart} renderOrder={2}>
                <sphereGeometry args={[0.028, 12, 12]} />
                <meshBasicMaterial color={color} depthTest={false} />
              </mesh>
              <Html position={endpoint} center zIndexRange={[10, 1]}>
                <Marker system={system} selected={selected === system.id} onSelect={() => onSelect(system.id)} />
              </Html>
            </group>
          );
        })}
      </group>
      <CameraControls command={command} />
    </>
  );
}

function BodyDiagram({ systems, selected, onSelect, unavailable = false }: Omit<Props, 'tint'> & { unavailable?: boolean }) {
  return (
    <div className="bt-diagram">
      <div className="bt-diagram-figure" aria-hidden="true">
        <div className="bt-diagram-pack" />
        <div className="bt-diagram-helmet" />
        <div className="bt-diagram-body" />
        <div className="bt-diagram-arm bt-diagram-arm-left" />
        <div className="bt-diagram-arm bt-diagram-arm-right" />
        <div className="bt-diagram-leg bt-diagram-leg-left" />
        <div className="bt-diagram-leg bt-diagram-leg-right" />
      </div>
      {Object.values(systems).map((system) => {
        const marker = HOTSPOTS[system.id];
        return (
          <div
            key={system.id}
            className="bt-diagram-marker"
            data-side={marker.side < 0 ? 'left' : 'right'}
            style={{ top: `${(1 - marker.height) * 73 + 11}%`, left: `calc(50% + ${marker.side * 70}px)` }}
          >
            <Marker system={system} selected={selected === system.id} onSelect={() => onSelect(system.id)} />
          </div>
        );
      })}
      {unavailable && <p className="bt-diagram-note" role="status">3D view unavailable. Select a system on the diagram.</p>}
    </div>
  );
}

export default function BioTwin({ systems, selected, onSelect, tint }: Props) {
  const [diagram, setDiagram] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [command, setCommand] = useState<CameraCommand | null>(null);
  const fallback = <BodyDiagram systems={systems} selected={selected} onSelect={onSelect} unavailable />;

  return (
    <div className="bt">
      <div className="bt-stage">
        {diagram ? (
          <>
            <BodyDiagram systems={systems} selected={selected} onSelect={onSelect} />
            <div className="bt-toolbar">
              <button type="button" className="bt-view-toggle" onClick={() => setDiagram(false)}>
                <Box size={14} aria-hidden="true" /> 3D view
              </button>
            </div>
          </>
        ) : (
          <ModelBoundary fallback={fallback}>
            <div className="bt-canvas">
              <Canvas
                camera={CAMERA}
                dpr={[1, 1.5]}
                frameloop="demand"
              >
                <Suspense fallback={null}>
                  <ModelScene systems={systems} selected={selected} onSelect={onSelect} tint={tint} command={command} onReady={setModelReady} />
                </Suspense>
              </Canvas>
            </div>
            {!modelReady && <span className="bt-loading" role="status">Loading crew model…</span>}
            <div className="bt-toolbar">
              <div className="bt-camera-actions" role="group" aria-label="3D view controls">
                <button type="button" title="Rotate left" aria-label="Rotate left" onClick={() => setCommand({ action: 'left' })}>
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <button type="button" title="Reset view" aria-label="Reset view" onClick={() => setCommand({ action: 'reset' })}>
                  <RotateCcw size={14} aria-hidden="true" />
                </button>
                <button type="button" title="Rotate right" aria-label="Rotate right" onClick={() => setCommand({ action: 'right' })}>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
              <button type="button" className="bt-view-toggle" onClick={() => {
                setDiagram(true);
                setModelReady(false);
                setCommand(null);
              }}>
                <ScanLine size={14} aria-hidden="true" /> Diagram
              </button>
            </div>
          </ModelBoundary>
        )}
      </div>

      <div className="bt-systems" role="group" aria-label="Body systems">
        {Object.values(systems).map((system) => {
          const { icon: Icon, label } = HOTSPOTS[system.id];
          const color = STATUS_COLOR[system.status];
          const risk = Math.round(system.risk * 100);
          return (
            <button
              key={system.id}
              type="button"
              className="bt-system"
              aria-label={`${system.label}, ${system.status}, ${risk}% modeled risk`}
              aria-pressed={selected === system.id}
              onClick={() => onSelect(system.id)}
            >
              <Icon size={15} aria-hidden="true" />
              <span className="bt-system-info"><span>{label}</span><small>{risk}% risk</small></span>
              <span className="bt-system-dot" style={{ background: color }} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      {!diagram && (
        <a className="bt-credit" href="https://sketchfab.com/3d-models/astronaut-482bf87662fd4b378bcb3a2931d59ca3" target="_blank" rel="noreferrer">
          Astronaut model by Antropik · CC BY 4.0
        </a>
      )}
    </div>
  );
}
