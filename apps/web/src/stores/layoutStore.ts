import { create } from 'zustand';

interface LayoutState {
  /** Serialized Dockview JSON. */
  serialized: string | null;
  setSerialized: (s: string | null) => void;
  /** Open tab metadata. */
  tabs: Record<string, { fileId: string; cursor: number; scroll: number }>;
  setTab: (id: string, meta: { fileId: string; cursor: number; scroll: number }) => void;
  removeTab: (id: string) => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  serialized: null,
  setSerialized: (s) => set({ serialized: s }),
  tabs: {},
  setTab: (id, meta) => set((st) => ({ tabs: { ...st.tabs, [id]: meta } })),
  removeTab: (id) =>
    set((st) => {
      const next = { ...st.tabs };
      delete next[id];
      return { tabs: next };
    }),
}));
