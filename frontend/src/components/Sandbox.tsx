import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { FlaskConical, X } from 'lucide-react'
import { useStore } from '../store'
import { DEFAULT_INPUTS } from '../lib/engine'
import type { Inputs } from '../lib/engine'

const SLIDERS: { key: keyof Inputs; label: string; unit: string; min: number; max: number; step: number }[] = [
    { key: 'co2', label: 'Cabin CO₂', unit: 'ppm', min: 400, max: 5000, step: 50 },
    { key: 'radiation', label: 'Solar Radiation Flux', unit: 'idx', min: 0, max: 100, step: 1 },
    { key: 'days', label: 'Days in Space', unit: 'd', min: 0, max: 900, step: 5 },
    { key: 'sleep', label: 'Hours of Sleep', unit: 'h', min: 3, max: 9, step: 0.5 },
]

const PRESETS: { name: string; values: Inputs }[] = [
    { name: 'Nominal', values: DEFAULT_INPUTS },
    { name: 'Radiation storm', values: { co2: 1500, radiation: 92, days: 120, sleep: 6 } },
    { name: 'Scrubber failure', values: { co2: 4600, radiation: 20, days: 90, sleep: 5.5 } },
    { name: 'Mars transit', values: { co2: 2600, radiation: 55, days: 700, sleep: 6 } },
    { name: 'Perfect storm', values: { co2: 4800, radiation: 95, days: 400, sleep: 4 } },
]

export default function Sandbox() {
    const { inputs, setInput, setInputs, sandboxOpen, toggleSandbox } = useStore()

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'j') toggleSandbox() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [toggleSandbox])

    return (
        <>
            <button
                onClick={toggleSandbox}
                className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full border border-sky-400/40 bg-slate-900/80 px-4 py-2 text-xs text-sky-300 hover:bg-slate-800"
                title="Press J"
            >
                <FlaskConical size={16} /> Judge's Sandbox
            </button>

            <AnimatePresence>
                {sandboxOpen && (
                    <motion.aside
                        initial={{ x: 380 }}
                        animate={{ x: 0 }}
                        exit={{ x: 380 }}
                        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
                        className="hud-panel fixed right-0 top-0 z-40 h-full w-[360px] overflow-y-auto rounded-none p-5"
                    >
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="font-display text-sm tracking-widest text-sky-300">DEEP-SPACE ANOMALY SIMULATOR</h2>
                            <button onClick={toggleSandbox}><X size={18} /></button>
                        </div>

                        <div className="mb-5 flex flex-wrap gap-2">
                            {PRESETS.map((p) => (
                                <button
                                    key={p.name}
                                    onClick={() => setInputs(p.values)}
                                    className="rounded border border-sky-400/30 px-2 py-1 text-[11px] text-sky-200 hover:bg-sky-400/10"
                                >
                                    {p.name}
                                </button>
                            ))}
                        </div>

                        {SLIDERS.map((s) => (
                            <div key={s.key} className="mb-5">
                                <div className="mb-1 flex justify-between text-xs">
                                    <span>{s.label}</span>
                                    <span className="text-sky-300">{inputs[s.key]} {s.unit}</span>
                                </div>
                                <input
                                    type="range"
                                    min={s.min}
                                    max={s.max}
                                    step={s.step}
                                    value={inputs[s.key]}
                                    onChange={(e) => setInput(s.key, Number(e.target.value))}
                                />
                            </div>
                        ))}
                        <p className="text-[11px] text-slate-500">Press J to open or close this panel.</p>
                    </motion.aside>
                )}
            </AnimatePresence>
        </>
    )
}