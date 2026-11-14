import { Suspense, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Html, Line, OrbitControls, Stars, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { STATUS_COLOR } from '../lib/engine'
import type { SystemId, SystemState } from '../lib/engine'

// ---- Tuning knobs ----
const MODEL_URL = '/models/spacesuit.glb'
const MODEL_HEIGHT = 3.9 // suit height in the scene
const FEET_Y = -1.82 // where the feet sit
const ROTATION_Y = 0 // set to Math.PI if the suit faces backwards
const HOTSPOT_Y = 0 // move ALL anchors and dots up (+) or down (-)
const HOTSPOT_Z = 0 // move ALL anchors and dots toward the camera (+) or back (-)
const DOT_SPREAD = 1.9 // distance of each dot from the body centre (bigger = more space)
const CAMERA_Z = 6.0 // smaller = suit looks bigger
const VIEW_Y = 0.1 // bigger = suit moves down in the view
// ----------------------

type Vec3 = [number, number, number]

// anchor = the point on the suit. The dot floats straight out to the side at the same height.
// Keep dots on the same side at least ~0.65 apart in height so their labels never overlap.
const HOTSPOTS: Record<SystemId, { anchor: Vec3; side: 'left' | 'right' }> = {
    brain: { anchor: [0.1, 1.9, 0.25], side: 'right' },
    eyes: { anchor: [-0.05, 1.72, 0.4], side: 'left' },
    lungs: { anchor: [-0.22, 1.02, 0.4], side: 'left' },
    heart: { anchor: [0.18, 0.7, 0.4], side: 'right' },
    immune: { anchor: [-0.2, 0.3, 0.38], side: 'left' },
    bones: { anchor: [-0.2, -0.5, 0.3], side: 'right' },
}

function Hotspot({ sys, selected, onSelect }: { sys: SystemState; selected: boolean; onSelect: (id: SystemId) => void }) {
    const [hover, setHover] = useState(false)
    const h = HOTSPOTS[sys.id]
    const color = STATUS_COLOR[sys.status]
    const left = h.side === 'left'
    const dot: Vec3 = [left ? -DOT_SPREAD : DOT_SPREAD, h.anchor[1], h.anchor[2]]
    const showLabel = selected || hover || sys.status !== 'nominal'

    return (
        <>
            <mesh position={h.anchor} renderOrder={10}>
                <sphereGeometry args={[0.035, 16, 16]} />
                <meshBasicMaterial color={color} depthTest={false} />
            </mesh>
            <Line points={[h.anchor, dot]} color={color} lineWidth={1.2} transparent opacity={0.75} depthTest={false} />

            <Html position={dot} center zIndexRange={[20, 0]}>
                <div className="relative h-0 w-0">
                    <button
                        onClick={() => onSelect(sys.id)}
                        onMouseEnter={() => setHover(true)}
                        onMouseLeave={() => setHover(false)}
                        className="absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full"
                        style={{ border: `1px solid ${color}`, background: 'rgba(2,6,23,0.55)', boxShadow: `0 0 12px ${color}` }}
                    >
                        {sys.status !== 'nominal' && (
                            <span className="absolute inset-0 animate-ping rounded-full" style={{ background: color, opacity: 0.35 }} />
                        )}
                        <span
                            className="relative h-3 w-3 rounded-full border-2 border-white"
                            style={{ background: color, transform: selected ? 'scale(1.35)' : 'scale(1)', transition: 'transform .2s' }}
                        />
                    </button>

                    {showLabel && (
                        <div
                            className={`pointer-events-none absolute top-0 flex -translate-y-1/2 items-center ${left ? 'flex-row-reverse' : 'flex-row'}`}
                            style={left ? { right: 18 } : { left: 18 }}
                        >
                            <span className="block h-px w-4" style={{ background: color }} />
                            <div
                                className="whitespace-nowrap rounded px-2 py-1 font-mono text-[11px]"
                                style={{ border: `1px solid ${color}`, background: 'rgba(2,6,23,0.88)', color: '#e2e8f0' }}
                            >
                                <div className="font-semibold" style={{ color }}>{sys.label}</div>
                                <div className="text-slate-400">{Math.round(sys.risk * 100)}% risk · {sys.status}</div>
                            </div>
                        </div>
                    )}
                </div>
            </Html>
        </>
    )
}

interface Fit { scale: number; position: Vec3 }

function Suit() {
    const { scene } = useGLTF(MODEL_URL)

    // Measure the model ONCE (while it is still untouched) and remember the result on the model itself.
    if (!scene.userData.fit) {
        scene.updateMatrixWorld(true)
        const box = new THREE.Box3().setFromObject(scene)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const s = MODEL_HEIGHT / (size.y || 1)
        scene.userData.fit = {
            scale: s,
            position: [-center.x * s, FEET_Y - box.min.y * s, -center.z * s],
        } as Fit
    }
    const fit = scene.userData.fit as Fit

    // The scale is applied to a wrapper group, never to the model, so reloads cannot shrink it.
    return (
        <group position={fit.position} scale={fit.scale} rotation={[0, ROTATION_Y, 0]}>
            <primitive object={scene} />
        </group>
    )
}

useGLTF.preload(MODEL_URL)

function Figure({ systems, selected, onSelect }: Props) {
    const ref = useRef<THREE.Group>(null!)
    useFrame(({ clock }) => { ref.current.rotation.y = Math.sin(clock.elapsedTime * 0.4) * 0.12 })

    return (
        <group ref={ref}>
            <Suspense fallback={null}>
                <Suit />
            </Suspense>

            {/* Sacrificial empty overlay: the first overlay in the scene is the one that fails to appear. */}
            <Html position={[0, -5, 0]}>
                <span />
            </Html>

            <group position={[0, HOTSPOT_Y, HOTSPOT_Z]}>
                {Object.values(systems).map((s) => (
                    <Hotspot key={s.id} sys={s} selected={selected === s.id} onSelect={onSelect} />
                ))}
            </group>
        </group>
    )
}

interface Props {
    systems: Record<SystemId, SystemState>
    selected: SystemId | null
    onSelect: (id: SystemId | null) => void
}

export default function BioTwin({ systems, selected, onSelect }: Props) {
    return (
        <Canvas camera={{ position: [0, VIEW_Y + 0.1, CAMERA_Z], fov: 40 }} onPointerMissed={() => onSelect(null)}>
            <ambientLight intensity={1.2} />
            <hemisphereLight args={['#ffffff', '#334155', 0.8]} />
            <directionalLight position={[3, 4, 5]} intensity={2.2} />
            <directionalLight position={[-4, 2, -3]} intensity={0.8} />
            <Stars radius={60} depth={40} count={2500} factor={3} fade speed={1} />

            <mesh position={[0, FEET_Y + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.85, 0.95, 64]} />
                <meshBasicMaterial color="#38bdf8" transparent opacity={0.5} />
            </mesh>

            <Figure systems={systems} selected={selected} onSelect={onSelect} />

            <OrbitControls
                enablePan={false}
                minDistance={4}
                maxDistance={9}
                minAzimuthAngle={-Math.PI / 4}
                maxAzimuthAngle={Math.PI / 4}
                minPolarAngle={1.1}
                maxPolarAngle={1.8}
                target={[0, VIEW_Y, 0]}
            />
        </Canvas>
    )
}