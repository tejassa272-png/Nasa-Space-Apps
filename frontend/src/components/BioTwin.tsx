import { useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import * as THREE from 'three'
import { STATUS_COLOR } from '../lib/engine'
import type { SystemId, SystemState } from '../lib/engine'

type Vec3 = [number, number, number]
interface Part { kind: 'sphere' | 'capsule'; pos: Vec3; size: number[] }

const PARTS: Record<SystemId, Part[]> = {
    brain: [{ kind: 'sphere', pos: [0, 1.66, 0], size: [0.2] }],
    eyes: [
        { kind: 'sphere', pos: [-0.11, 1.62, 0.27], size: [0.055] },
        { kind: 'sphere', pos: [0.11, 1.62, 0.27], size: [0.055] },
    ],
    heart: [{ kind: 'sphere', pos: [-0.08, 0.62, 0.14], size: [0.13] }],
    lungs: [
        { kind: 'capsule', pos: [-0.27, 0.7, 0], size: [0.13, 0.36] },
        { kind: 'capsule', pos: [0.27, 0.7, 0], size: [0.13, 0.36] },
    ],
    immune: [{ kind: 'sphere', pos: [0, 0.05, 0.1], size: [0.15] }],
    bones: [
        { kind: 'capsule', pos: [-0.22, -1.25, 0], size: [0.1, 0.9] },
        { kind: 'capsule', pos: [0.22, -1.25, 0], size: [0.1, 0.9] },
        { kind: 'capsule', pos: [0, 0.4, -0.2], size: [0.06, 0.9] },
    ],
}

function Organ({ sys, selected, onSelect }: { sys: SystemState; selected: boolean; onSelect: (id: SystemId) => void }) {
    const material = useMemo(
        () => new THREE.MeshStandardMaterial({ color: STATUS_COLOR.nominal, emissive: STATUS_COLOR.nominal, roughness: 0.35, metalness: 0.2 }),
        [],
    )
    const target = useMemo(() => new THREE.Color(STATUS_COLOR[sys.status]), [sys.status])

    useFrame(({ clock }) => {
        const t = clock.elapsedTime
        material.color.lerp(target, 0.08)
        material.emissive.lerp(target, 0.08)
        const base =
            sys.status === 'critical' ? 1.3 + Math.sin(t * 6) * 0.7 : sys.status === 'caution' ? 0.9 + Math.sin(t * 3) * 0.3 : 0.5
        material.emissiveIntensity = base + (selected ? 0.6 : 0)
    })

    return (
        <group
            onClick={(e) => { e.stopPropagation(); onSelect(sys.id) }}
            onPointerOver={() => { document.body.style.cursor = 'pointer' }}
            onPointerOut={() => { document.body.style.cursor = 'auto' }}
        >
            {PARTS[sys.id].map((p, i) => (
                <mesh key={i} position={p.pos}>
                    {p.kind === 'sphere' ? (
                        <sphereGeometry args={[p.size[0], 32, 32]} />
                    ) : (
                        <capsuleGeometry args={[p.size[0], p.size[1], 8, 16]} />
                    )}
                    <primitive object={material} attach="material" />
                </mesh>
            ))}
        </group>
    )
}

function Wire({ pos, rot, scale, children }: { pos: Vec3; rot?: Vec3; scale?: Vec3; children: ReactNode }) {
    return (
        <mesh position={pos} rotation={rot} scale={scale}>
            {children}
            <meshBasicMaterial color="#38bdf8" wireframe transparent opacity={0.2} />
        </mesh>
    )
}

function Shell() {
    return (
        <group>
            <Wire pos={[0, 1.62, 0]}><sphereGeometry args={[0.34, 24, 24]} /></Wire>
            <Wire pos={[0, 0.35, 0]} scale={[1, 1, 0.65]}><capsuleGeometry args={[0.45, 0.9, 8, 20]} /></Wire>
            <Wire pos={[-0.72, 0.4, 0]} rot={[0, 0, 0.15]}><capsuleGeometry args={[0.12, 0.85, 8, 12]} /></Wire>
            <Wire pos={[0.72, 0.4, 0]} rot={[0, 0, -0.15]}><capsuleGeometry args={[0.12, 0.85, 8, 12]} /></Wire>
            <Wire pos={[-0.22, -1.25, 0]}><capsuleGeometry args={[0.17, 0.9, 8, 12]} /></Wire>
            <Wire pos={[0.22, -1.25, 0]}><capsuleGeometry args={[0.17, 0.9, 8, 12]} /></Wire>
        </group>
    )
}

function Scanner() {
    const ref = useRef<THREE.Mesh>(null!)
    useFrame(({ clock }) => { ref.current.position.y = Math.sin(clock.elapsedTime * 0.9) * 2 })
    return (
        <mesh ref={ref} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.95, 0.01, 8, 64]} />
            <meshBasicMaterial color="#38bdf8" transparent opacity={0.7} />
        </mesh>
    )
}

interface Props {
    systems: Record<SystemId, SystemState>
    selected: SystemId | null
    onSelect: (id: SystemId | null) => void
}

export default function BioTwin({ systems, selected, onSelect }: Props) {
    return (
        <Canvas camera={{ position: [0, 0.2, 6], fov: 40 }} onPointerMissed={() => onSelect(null)}>
            <ambientLight intensity={0.8} />
            <directionalLight position={[3, 4, 5]} intensity={1.5} />
            <Stars radius={60} depth={40} count={2500} factor={3} fade speed={1} />
            <Shell />
            <Scanner />
            {Object.values(systems).map((s) => (
                <Organ key={s.id} sys={s} selected={selected === s.id} onSelect={onSelect} />
            ))}
            <OrbitControls enablePan={false} minDistance={3} maxDistance={8} autoRotate autoRotateSpeed={0.6} />
        </Canvas>
    )
}