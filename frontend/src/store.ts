import { create } from 'zustand'
import { DEFAULT_INPUTS } from './lib/engine'
import type { Inputs, SystemId } from './lib/engine'

interface State {
    inputs: Inputs
    selected: SystemId | null
    sandboxOpen: boolean
    authed: boolean
    bypass: boolean
    unlocked: string[]
    setInput: (key: keyof Inputs, value: number) => void
    setInputs: (inputs: Inputs) => void
    select: (id: SystemId | null) => void
    toggleSandbox: () => void
    login: (bypass?: boolean) => void
    logout: () => void
    unlock: (drawer: string) => void
}

export const useStore = create<State>((set) => ({
    inputs: DEFAULT_INPUTS,
    selected: null,
    sandboxOpen: false,
    authed: false,
    bypass: false,
    unlocked: [],
    setInput: (key, value) => set((s) => ({ inputs: { ...s.inputs, [key]: value } })),
    setInputs: (inputs) => set({ inputs }),
    select: (id) => set({ selected: id }),
    toggleSandbox: () => set((s) => ({ sandboxOpen: !s.sandboxOpen })),
    login: (bypass = false) => set({ authed: true, bypass }),
    logout: () => set({ authed: false, bypass: false }),
    unlock: (drawer) => set((s) => (s.unlocked.includes(drawer) ? s : { unlocked: [...s.unlocked, drawer] })),
}))