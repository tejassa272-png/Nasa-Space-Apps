import { useMemo } from 'react'
import { Activity, Pill, ShieldAlert } from 'lucide-react'
import { useStore } from './store'
import { PROTOCOLS, STATUS_COLOR, clamp, computeSynergy, getKit, readiness } from './lib/engine'
import BioTwin from './components/BioTwin'
import Sandbox from './components/Sandbox'

export default function App() {
    const inputs = useStore((s) => s.inputs)
    const selected = useStore((s) => s.selected)
    const select = useStore((s) => s.select)

    const systems = useMemo(() => computeSynergy(inputs), [inputs])
    const list = Object.values(systems)
    const worst = list.reduce((a, b) => (b.risk > a.risk ? b : a))
    const active = systems[selected ?? worst.id]
    const score = readiness(systems)
    const scoreColor = score >= 65 ? STATUS_COLOR.nominal : score >= 40 ? STATUS_COLOR.caution : STATUS_COLOR.critical
    const protocol = PROTOCOLS[active.id]
    const kit = getKit(active.id, inputs.days)

    const co2N = clamp((inputs.co2 - 400) / 4600)
    const radN = clamp(inputs.radiation / 100)
    const sleepDef = clamp((8 - inputs.sleep) / 4)
    const vitals = [
        { label: 'Heart Rate', value: `${Math.round(62 + radN * 28 + sleepDef * 10)} bpm` },
        { label: 'SpO₂', value: `${Math.round(98 - co2N * 6)} %` },
        { label: 'Blood Pressure', value: `${Math.round(116 + co2N * 16)}/${Math.round(76 + co2N * 8)}` },
        { label: 'Cabin CO₂', value: `${inputs.co2} ppm` },
    ]

    const R = 42
    const C = 2 * Math.PI * R
    const vignette = clamp((inputs.radiation - 60) / 40)

    return (
        <div className="relative flex h-full flex-col">
            <div className="pointer-events-none absolute inset-0 z-20 scanlines" />
            <div
                className="pointer-events-none absolute inset-0 z-20 transition-all duration-500"
                style={{ boxShadow: `inset 0 0 ${120 * vignette}px rgba(239,68,68,${0.55 * vignette})` }}
            />

            <header className="z-10 flex items-center justify-between px-6 py-3">
                <div className="flex items-center gap-3">
                    <Activity className="text-sky-400" size={22} />
                    <h1 className="font-display text-xl font-bold tracking-[0.3em] text-sky-300">ASTROTWIN</h1>
                    <span className="text-[11px] text-slate-500">EARTH-INDEPENDENT MEDICAL OPS</span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                    <span className="text-slate-400">MISSION T+{inputs.days}d</span>
                    <span
                        className="flex items-center gap-2 rounded-full border px-3 py-1"
                        style={{ borderColor: STATUS_COLOR[worst.status], color: STATUS_COLOR[worst.status] }}
                    >
                        <ShieldAlert size={14} /> {worst.status.toUpperCase()}
                    </span>
                </div>
            </header>

            <main className="relative z-10 grid min-h-0 flex-1 grid-cols-[300px_1fr_340px] gap-4 px-4 pb-4">
                {/* LEFT */}
                <section className="hud-panel flex flex-col gap-4 overflow-y-auto p-4">
                    <div className="flex items-center gap-4">
                        <svg width="100" height="100" viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(148,163,184,0.2)" strokeWidth="8" />
                            <circle
                                cx="50" cy="50" r={R} fill="none" stroke={scoreColor} strokeWidth="8" strokeLinecap="round"
                                strokeDasharray={C} strokeDashoffset={C * (1 - score / 100)}
                                transform="rotate(-90 50 50)" style={{ transition: 'all 0.6s ease' }}
                            />
                            <text x="50" y="56" textAnchor="middle" fill={scoreColor} fontSize="22" fontWeight="700">{score}</text>
                        </svg>
                        <div>
                            <div className="font-display text-xs tracking-widest text-sky-300">MISSION READINESS</div>
                            <div className="text-[11px] text-slate-500">Crew-wide score</div>
                        </div>
                    </div>

                    <div>
                        <div className="mb-2 font-display text-[11px] tracking-widest text-slate-400">BODY SYSTEMS</div>
                        {list.map((s) => (
                            <button
                                key={s.id}
                                onClick={() => select(s.id)}
                                className={`mb-2 w-full rounded-lg border p-2 text-left transition ${active.id === s.id ? 'border-sky-400/60 bg-sky-400/10' : 'border-transparent hover:bg-white/5'}`}
                            >
                                <div className="flex items-center justify-between text-xs">
                                    <span>{s.label}</span>
                                    <span style={{ color: STATUS_COLOR[s.status] }}>{s.status}</span>
                                </div>
                                <div className="mt-1 h-1.5 rounded bg-slate-700/60">
                                    <div
                                        className="h-full rounded transition-all duration-500"
                                        style={{ width: `${Math.max(4, s.risk * 100)}%`, background: STATUS_COLOR[s.status] }}
                                    />
                                </div>
                            </button>
                        ))}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        {vitals.map((v) => (
                            <div key={v.label} className="rounded-lg border border-slate-700/60 p-2">
                                <div className="text-[10px] text-slate-500">{v.label}</div>
                                <div className="text-sm text-sky-200">{v.value}</div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* CENTER */}
                <section className="hud-panel relative overflow-hidden">
                    <BioTwin systems={systems} selected={selected} onSelect={select} />
                    <div className="pointer-events-none absolute left-4 top-3 font-display text-[11px] tracking-widest text-sky-300/70">
                        3D ANATOMICAL BIO-TWIN · CLICK AN ORGAN
                    </div>
                </section>

                {/* RIGHT */}
                <section className="hud-panel flex flex-col gap-3 overflow-y-auto p-4">
                    <div className="font-display text-[11px] tracking-widest text-slate-400">TRIAGE PROTOCOL</div>
                    <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ background: STATUS_COLOR[active.status], boxShadow: `0 0 10px ${STATUS_COLOR[active.status]}` }} />
                        <h2 className="font-display text-sm text-sky-200">{active.label}</h2>
                    </div>
                    <p className="text-xs text-slate-400">{active.reason}</p>

                    {active.status === 'nominal' ? (
                        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-300">
                            No intervention required. Routine check logged.
                        </p>
                    ) : (
                        <div>
                            <div className="mb-2 text-xs text-sky-300">{protocol.title}</div>
                            <ol className="space-y-2">
                                {protocol.steps.map((step, i) => (
                                    <li key={i} className="flex gap-2 text-xs">
                                        <span className="text-sky-400">{i + 1}.</span>
                                        <span>{step}</span>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}

                    {kit && active.status !== 'nominal' && (
                        <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                            <div className="mb-1 flex items-center gap-2 text-amber-300"><Pill size={14} /> MEDICAL KIT CHECK</div>
                            <div>Recommended: {kit.drug}</div>
                            <div>Inventory: {kit.stock} remaining</div>
                            <div>Location: {kit.location}</div>
                            <div className="mt-1 text-amber-400">Warning: {kit.warning}</div>
                        </div>
                    )}
                </section>
            </main>

            <Sandbox />
        </div>
    )
}