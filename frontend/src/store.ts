import { create } from 'zustand'
import { DEFAULT_INPUTS } from './lib/engine'
import type { Inputs, SystemId } from './lib/engine'

interface State {
    inputs: Inputs
    selected: SystemId | null
    sandboxOpen: boolean
    setInput: (key: keyof Inputs, value: number) => void
    setInputs: (inputs: Inputs) => void
    select: (id: SystemId | null) => void
    toggleSandbox: () => void
}

export const useStore = create<State>((set) => ({
    inputs: DEFAULT_INPUTS,
    selected: null,
    sandboxOpen: false,
    setInput: (key, value) => set((s) => ({ inputs: { ...s.inputs, [key]: value } })),
    setInputs: (inputs) => set({ inputs }),
    select: (id) => set({ selected: id }),
    toggleSandbox: () => set((s) => ({ sandboxOpen: !s.sandboxOpen })),
}))