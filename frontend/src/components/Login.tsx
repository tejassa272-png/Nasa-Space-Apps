import { useState } from 'react'
import { motion } from 'framer-motion'
import { Eye, EyeOff, Fingerprint, ShieldAlert } from 'lucide-react'
import { useStore } from '../store'

export default function Login() {
    const login = useStore((s) => s.login)
    const [id, setId] = useState('')
    const [key, setKey] = useState('')
    const [show, setShow] = useState(false)
    const [scanning, setScanning] = useState(false)
    const [error, setError] = useState('')

    const authenticate = () => {
        if (!id.trim() || !key.trim()) {
            setError('Commander ID and passkey are required.')
            return
        }
        setError('')
        setScanning(true)
        setTimeout(() => login(false), 1400)
    }

    const field =
        'w-full rounded-md border border-sky-400/25 bg-slate-950/70 px-3 py-2.5 text-sm text-sky-100 outline-none placeholder:text-slate-600 focus:border-sky-400/70'

    return (
        <div
            className="flex h-full items-center justify-center"
            style={{
                background:
                    'radial-gradient(ellipse at 20% 30%, rgba(30,64,175,.35), transparent 55%), radial-gradient(ellipse at 80% 70%, rgba(14,116,144,.30), transparent 50%), #02040a',
            }}
        >
            <motion.form
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                onSubmit={(e) => { e.preventDefault(); authenticate() }}
                className="hud-panel w-[420px] p-8"
            >
                <h1 className="mb-1 text-center font-display text-3xl font-bold tracking-[0.3em] text-sky-300">ASTROTWIN</h1>
                <p className="mb-8 text-center text-[11px] tracking-widest text-slate-500">EARTH-INDEPENDENT MEDICAL OPERATIONS</p>

                <label className="mb-1 block text-[11px] tracking-widest text-slate-400">COMMANDER ID</label>
                <input className={`${field} mb-5`} placeholder="COMMANDER ID" value={id} onChange={(e) => setId(e.target.value)} />

                <label className="mb-1 block text-[11px] tracking-widest text-slate-400">BIOMETRIC PASSKEY</label>
                <div className="relative mb-2">
                    <input
                        className={`${field} pr-20`}
                        type={show ? 'text' : 'password'}
                        placeholder="••••••••••"
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                    />
                    <button type="button" onClick={() => setShow(!show)} className="absolute right-10 top-1/2 -translate-y-1/2 text-slate-400">
                        {show ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                    <Fingerprint size={18} className={`absolute right-3 top-1/2 -translate-y-1/2 ${scanning ? 'animate-pulse text-sky-300' : 'text-sky-500'}`} />
                </div>

                <p className="mb-4 h-4 text-[11px] text-red-400">{error}</p>

                <button
                    type="submit"
                    disabled={scanning}
                    className="relative w-full overflow-hidden rounded-md bg-sky-400/90 py-2.5 font-display text-sm font-bold tracking-widest text-slate-950 hover:bg-sky-300 disabled:opacity-80"
                >
                    {scanning ? 'SCANNING BIOMETRICS…' : 'AUTHENTICATE'}
                    {scanning && (
                        <motion.span
                            className="absolute bottom-0 left-0 h-1 bg-slate-950/60"
                            initial={{ width: '0%' }}
                            animate={{ width: '100%' }}
                            transition={{ duration: 1.4, ease: 'linear' }}
                        />
                    )}
                </button>

                <button
                    type="button"
                    onClick={() => login(true)}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-red-500/60 bg-red-600/80 py-2.5 font-display text-sm font-bold tracking-widest text-white hover:bg-red-500"
                >
                    <ShieldAlert size={16} /> EMERGENCY BYPASS
                </button>
                <p className="mt-6 text-center text-[10px] text-slate-600">AUTONOMOUS MODE · FULLY OFFLINE · DEMO LOGIN ACCEPTS ANY CREDENTIALS</p>
            </motion.form>
        </div>
    )
}