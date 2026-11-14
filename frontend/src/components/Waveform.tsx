import { useEffect, useRef } from 'react'

type Kind = 'ecg' | 'pleth' | 'resp'

const g = (x: number, c: number, w: number, a: number) => a * Math.exp(-((x - c) ** 2) / (2 * w * w))

function shape(kind: Kind, p: number): number {
    if (kind === 'ecg') {
        const v = g(p, 0.18, 0.025, 0.12) + g(p, 0.36, 0.008, -0.15) + g(p, 0.385, 0.012, 1) + g(p, 0.41, 0.01, -0.25) + g(p, 0.62, 0.05, 0.25)
        return Math.min(1, Math.max(0, 0.2 + v * 0.75))
    }
    if (kind === 'pleth') return 0.5 + 0.32 * Math.sin(2 * Math.PI * p) + 0.1 * Math.sin(4 * Math.PI * p + 1)
    return 0.5 + 0.4 * Math.sin(2 * Math.PI * p)
}

interface Props { kind: Kind; rate: number; color: string; height?: number }

export default function Waveform({ kind, rate, color, height = 32 }: Props) {
    const ref = useRef<HTMLCanvasElement>(null)
    const rateRef = useRef(rate)

    useEffect(() => { rateRef.current = rate }, [rate])

    useEffect(() => {
        const canvas = ref.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const dpr = window.devicePixelRatio || 1
        const resize = () => {
            const r = canvas.getBoundingClientRect()
            canvas.width = Math.max(1, Math.floor(r.width * dpr))
            canvas.height = Math.max(1, Math.floor(r.height * dpr))
        }
        resize()
        window.addEventListener('resize', resize)

        let raf = 0
        const speed = 80 // px per second
        const draw = (now: number) => {
            const W = canvas.width
            const H = canvas.height
            ctx.clearRect(0, 0, W, H)
            ctx.strokeStyle = color
            ctx.lineWidth = 1.6 * dpr
            ctx.shadowColor = color
            ctx.shadowBlur = 6 * dpr
            ctx.beginPath()
            const perSec = rateRef.current / 60
            for (let x = 0; x <= W; x += 2) {
                const ts = now / 1000 - (W - x) / dpr / speed
                const p = (((ts * perSec) % 1) + 1) % 1
                const y = H * (1 - shape(kind, p) * 0.85 - 0.075)
                if (x === 0) ctx.moveTo(x, y)
                else ctx.lineTo(x, y)
            }
            ctx.stroke()
            raf = requestAnimationFrame(draw)
        }
        raf = requestAnimationFrame(draw)
        return () => {
            cancelAnimationFrame(raf)
            window.removeEventListener('resize', resize)
        }
    }, [kind, color])

    return <canvas ref={ref} style={{ width: '100%', height }} />
}