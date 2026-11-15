import { useEffect, useRef, useState } from 'react'
import { BACKGROUNDS, DIM } from './backgrounds'

const KEY = 'astrotwin-bg'

export default function BackgroundVideo() {
    const [index, setIndex] = useState<number>(() => {
        try {
            const saved = localStorage.getItem(KEY)
            if (saved !== null) {
                const n = Number(saved)
                if (Number.isInteger(n) && n >= -1 && n < BACKGROUNDS.length) return n
            }
        } catch {
            // storage unavailable, use the default
        }
        return BACKGROUNDS.length > 0 ? 0 : -1
    })
    const videoRef = useRef<HTMLVideoElement>(null)
    const current = index >= 0 ? BACKGROUNDS[index] : null

    useEffect(() => {
        try {
            localStorage.setItem(KEY, String(index))
        } catch {
            // ignore
        }
    }, [index])

    useEffect(() => {
        const v = videoRef.current
        if (!v) return
        v.muted = true
        v.play().catch(() => { })
    }, [current?.file])

    return (
        <>
            <div className="mission-background" aria-hidden="true">
                {current && (
                    <video
                        key={current.file}
                        ref={videoRef}
                        src={`${import.meta.env.BASE_URL}backgrounds/${current.file}`}
                        autoPlay
                        muted
                        loop
                        playsInline
                        preload="auto"
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                )}
                <div style={{ position: 'absolute', inset: 0, background: `rgba(2,6,23,${DIM})` }} />
            </div>

            {BACKGROUNDS.length > 0 && (
                <div
                    style={{
                        position: 'fixed',
                        right: 12,
                        bottom: 12,
                        zIndex: 1000,
                        padding: '4px 8px',
                        background: 'rgba(8,16,32,0.8)',
                        border: '1px solid rgba(56,189,248,0.3)',
                        borderRadius: 8,
                        fontSize: '0.7rem',
                        color: '#94a3b8',
                    }}
                >
                    <label htmlFor="mission-background" style={{ marginRight: 6 }}>BACKGROUND</label>
                    <select
                        id="mission-background"
                        value={index}
                        onChange={(e) => setIndex(Number(e.target.value))}
                        style={{ background: '#020617', color: '#e0f2fe', border: '1px solid rgba(56,189,248,0.3)', borderRadius: 4 }}
                    >
                        <option value={-1}>Static (no video)</option>
                        {BACKGROUNDS.map((b, i) => (
                            <option key={b.file} value={i}>{b.name}</option>
                        ))}
                    </select>
                </div>
            )}
        </>
    )
}
