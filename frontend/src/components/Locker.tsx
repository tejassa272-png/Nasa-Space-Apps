import { Lock } from 'lucide-react'
import { useStore } from '../store'

interface Kit { drug: string; stock: number; location: string; warning: string; drawer: string }

const DRAWERS = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4']

export default function Locker({ kit }: { kit: Kit }) {
    const unlocked = useStore((s) => s.unlocked)
    const unlock = useStore((s) => s.unlock)
    const open = unlocked.includes(kit.drawer)

    return (
        <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
            <div className="mb-2 flex items-center gap-2 text-amber-300"><Lock size={14} /> MEDICAL LOCKER MAP</div>

            <div className="mb-3 grid grid-cols-4 gap-1.5">
                {DRAWERS.map((d) => {
                    const target = d === kit.drawer
                    const style = !target
                        ? 'border-slate-700 text-slate-600'
                        : open
                            ? 'border-emerald-400 bg-emerald-400/10 text-emerald-300'
                            : 'animate-pulse border-sky-400 bg-sky-400/15 text-sky-200'
                    return (
                        <div key={d} className={`rounded border py-2 text-center text-[11px] ${style}`}>
                            {d}
                        </div>
                    )
                })}
            </div>

            <div>Recommended: {kit.drug}</div>
            <div>Inventory: {kit.stock - (open ? 1 : 0)} remaining</div>
            <div>Location: {kit.location}</div>
            <div className="mt-1 text-amber-400">Warning: {kit.warning}</div>

            <button
                onClick={() => unlock(kit.drawer)}
                disabled={open}
                className={`mt-3 w-full rounded py-2 font-display text-[11px] font-bold tracking-widest ${open ? 'border border-emerald-400/50 text-emerald-300' : 'bg-sky-400 text-slate-950 hover:bg-sky-300'}`}
            >
                {open ? `DRAWER ${kit.drawer} UNLOCKED · DISPENSE LOGGED` : `ACKNOWLEDGE & UNLOCK DRAWER ${kit.drawer}`}
            </button>
        </div>
    )
}