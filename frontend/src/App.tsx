import { useMemo } from 'react'
import { Activity, LogOut, Pill, Radio, ShieldAlert, Sun } from 'lucide-react'
import { useStore } from './store'
import { PROTOCOLS, STATUS_COLOR, clamp, computeSynergy, getKit, readiness, toStatus } from './lib/engine'
import type { Status } from './lib/engine'
import BioTwin from './components/BioTwin'
import Sandbox from './components/Sandbox'
import Waveform from './components/Waveform'
import Login from './components/Login'

const TABS = ['MISSION OVERVIEW', 'BIO-TWIN 3D', 'TRIAGE & RAG', 'SANDBOX', 'MEDICAL LOCKER']

const CREW = [
    { name: 'CDR Sarah Lin', hr: 64, bias: -0.1 },
    { name: 'PLT Marcus Vance', hr: 72, bias: 0.25 },
    { name: 'MS Alex Mercer', hr: 58, bias: 0 },
]

const STATUS_LABEL: Record<Status, string> = { nominal: 'Optimal', caution: 'Warning', critical: 'Critical' }

const WAVES = [
    { label: 'ECG', kind: 'ecg', color: '#4ade80' },
    { label: 'SpO₂', kind: 'pleth', color: '#38bdf8' },
    { label: 'RESP', kind: 'resp', color: '#a78bfa' },
] as const

function Dashboard() {
    const inputs = useStore((s) => s.inputs)
    const selected = useStore((s) => s.selected)
    const select = useStore((s) => s.select)
    const toggleSandbox = useStore((s) => s.toggleSandbox)
    const logout = useStore((s) => s.logout)
    const bypass = useStore((s) => s.bypass)

    const systems = useMemo(() => computeSynergy(inputs), [inputs])
    const list = Object.values(systems)
    const worst = list.reduce((a, b) => (b.risk > a.risk ? b : a))
    const active = systems[selected ?? worst.id]
    const score = readiness(systems)
    const scoreColor = score >= 65 ? STATUS_COLOR.nominal : score >= 40 ? STATUS_COLOR.caution : STATUS_COLOR.critical
    const protocol = PROTOCOLS[active.id]
    const kit = getKit(active.id, inputs.days)
    const avgRisk = list.reduce((s, x) => s + x.risk, 0) / list.length
    const anomaly = list.filter((s) => s.status === 'critical').length >= 2
    const storm = inputs.radiation > 60

    const co2N = clamp((inputs.co2 - 400) / 4600)
    const radN = clamp(inputs.radiation / 100)
    const sleepDef = clamp((8 - inputs.sleep) / 4)
    const hr = Math.round(62 + radN * 28 + sleepDef * 10)
    const spo2 = Math.round(98 - co2N * 6)
    const resp = Math.round(14 + co2N * 8)
    const temp = (36.8 + radN * 0.6).toFixed(1)

    const delaySec = Math.round((3 + (inputs.days / 900) * 22) * 60)
    const delay = `${Math.floor(delaySec / 60)}m ${String(delaySec % 60).padStart(2, '0')}s`

    const R = 34
    const C = 2 * Math.PI * R
    const vignette = clamp((inputs.radiation - 60) / 40)

    return (
        <div className="relative flex h-full flex-col">
            <div className="pointer-events-none absolute inset-0 z-20 scanlines" />
            <div
                className="pointer-events-none absolute inset-0 z-20 transition-all duration-500"
                style={{ boxShadow: `inset 0 0 ${120 * vignette}px rgba(239,68,68,${0.55 * vignette})` }}
            />

            <header className="z-10 flex items-center justify-between px-6 pt-3">
                <div className="flex items-center gap-3">
                    <Activity className="text-sky-400" size={22} />
                    <div>
                        <h1 className="font-display text-xl font-bold tracking-[0.3em] text-sky-300">ASTROTWIN</h1>
                        <div className="text-[10px] text-slate-500">EARTH-INDEPENDENT MEDICAL OPERATIONS (EIMO) — MISSION: ARES-V</div>
                    </div>
                </div>
                <div className="flex items-center gap-3 text-[11px]">
                    {bypass && <span className="rounded border border-red-500/60 px-2 py-1 text-red-400">EMERGENCY BYPASS ACTIVE</span>}
                    <span className="flex items-center gap-2 rounded border border-sky-400/40 bg-sky-400/5 px-3 py-1 text-sky-300">
                        <Radio size={13} /> COMM DELAY: {delay} (AUTONOMOUS MODE ACTIVE)
                    </span>
                    <span
                        className="flex items-center gap-2 rounded border px-3 py-1"
                        style={{
                            borderColor: storm ? STATUS_COLOR.caution : STATUS_COLOR.nominal,
                            color: storm ? STATUS_COLOR.caution : STATUS_COLOR.nominal,
                            background: storm ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.06)',
                        }}
                    >
                        <Sun size={13} /> DONKI API: {storm ? 'SOLAR STORM DETECTED' : 'SPACE WEATHER NOMINAL'}
                    </span>
                    <button onClick={logout} title="Log out" className="text-slate-500 hover:text-slate-200"><LogOut size={16} /></button>
                </div>
            </header>

            <nav className="z-10 mt-2 flex gap-1 px-6">
                {TABS.map((t) => (
                    <button
                        key={t}
                        onClick={() => { if (t === 'SANDBOX') toggleSandbox() }}
                        className={`border-b-2 px-3 py-1.5 text-[11px] tracking-widest ${t === 'BIO-TWIN 3D' ? 'border-sky-400 text-sky-300' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                    >
                        {t}
                    </button>
                ))}
            </nav>

            <main className="relative z-10 mt-3 grid min-h-0 flex-1 grid-cols-[300px_1fr_340px] gap-4 px-4 pb-4">
                {/* LEFT */}
                <section className="hud-panel flex flex-col gap-4 overflow-y-auto p-4">
                    <div>
                        <div className="mb-2 font-display text-[11px] tracking-widest text-slate-400">CREW STATUS</div>
                        {CREW.map((c) => {
                            const risk = clamp(avgRisk + c.bias)
                            const st = toStatus(risk)
                            return (
                                <div key={c.name} className="mb-2 rounded-lg border p-2" style={{ borderColor: `${STATUS_COLOR[st]}66`, background: `${STATUS_COLOR[st]}0d` }}>
                                    <div className="flex items-center justify-between text-xs">
                                        <span>{c.name}</span>
                                        <span style={{ color: STATUS_COLOR[st] }}>{STATUS_LABEL[st]} · {Math.round(c.hr + risk * 38)} bpm</span>
                                    </div>
                                    <Waveform kind="ecg" rate={c.hr + risk * 38} color={STATUS_COLOR[st]} height={22} />
                                    {st !== 'nominal' && <div className="text-[10px]" style={{ color: STATUS_COLOR[st] }}>▲ ANOMALY DETECTED</div>}
                                </div>
                            )
                        })}
                    </div>

                    <div className="flex items-center gap-3">
                        <svg width="80" height="80" viewBox="0 0 80 80">
                            <circle cx="40" cy="40" r={R} fill="none" stroke="rgba(148,163,184,0.2)" strokeWidth="7" />
                            <circle
                                cx="40" cy="40" r={R} fill="none" stroke={scoreColor} strokeWidth="7" strokeLinecap="round"
                                strokeDasharray={C} strokeDashoffset={C * (1 - score / 100)}
                                transform="rotate(-90 40 40)" style={{ transition: 'all 0.6s ease' }}
                            />
                            <text x="40" y="46" textAnchor="middle" fill={scoreColor} fontSize="18" fontWeight="700">{score}</text>
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
                                    <div className="h-full rounded transition-all duration-500" style={{ width: `${Math.max(4, s.risk * 100)}%`, background: STATUS_COLOR[s.status] }} />
                                </div>
                            </button>
                        ))}
                    </div>
                </section>

                {/* CENTER */}
                <div className="flex min-h-0 flex-col gap-4">
                    <section className="hud-panel relative min-h-0 flex-1 overflow-hidden">
                        <BioTwin systems={systems} selected={selected} onSelect={select} />
                        <div className="pointer-events-none absolute left-4 top-3 font-display text-[11px] tracking-widest text-sky-300/70">
                            3D BIO-TWIN · CLICK AN ORGAN
                        </div>
                        {anomaly && (
                            <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 animate-pulse items-center gap-2 rounded border border-red-500/70 bg-red-600/25 px-4 py-2 font-display text-xs tracking-widest text-red-300">
                                <ShieldAlert size={15} /> MULTI-STRESSOR ANOMALY DETECTED
                            </div>
                        )}
                    </section>

                    <section className="hud-panel grid h-[176px] shrink-0 grid-cols-[1fr_240px] gap-4 p-3">
                        <div className="min-w-0">
                            <div className="mb-1 font-display text-[11px] tracking-widest text-slate-400">
                                TEMPUS PRO / WEARABLE STREAM <span className="ml-2 text-emerald-400">● LIVE</span>
                            </div>
                            {WAVES.map((w) => (
                                <div key={w.label} className="flex items-center gap-2">
                                    <span className="w-10 text-[10px] text-slate-500">{w.label}</span>
                                    <div className="min-w-0 flex-1">
                                        <Waveform kind={w.kind} rate={w.kind === 'resp' ? resp : hr} color={w.color} height={34} />
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            {[
                                { l: 'HEART RATE', v: `${hr} bpm` },
                                { l: 'SpO₂', v: `${spo2} %` },
                                { l: 'RESPIRATION', v: `${resp} rpm` },
                                { l: 'BODY TEMP', v: `${temp} °C` },
                            ].map((x) => (
                                <div key={x.l} className="rounded-lg border border-slate-700/60 p-2">
                                    <div className="text-[9px] text-slate-500">{x.l}</div>
                                    <div className="text-base text-sky-200">{x.v}</div>
                                </div>
                            ))}
                        </div>
                    </section>
                </div>

                {/* RIGHT */}
                <section className="hud-panel flex flex-col gap-3 overflow-y-auto p-4">
                    <div className="font-display text-[11px] tracking-widest text-slate-400">AI TRIAGE & STEWARDSHIP</div>
                    {active.status !== 'nominal' && (
                        <div className="rounded border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                            AUTONOMOUS TRIAGE PROTOCOL EN ROUTE (no Earth contact required)
                        </div>
                    )}
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

export default function App() {
    const authed = useStore((s) => s.authed)
    return authed ? <Dashboard /> : <Login />
}