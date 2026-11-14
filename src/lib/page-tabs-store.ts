import { useSyncExternalStore } from "react";

/**
 * Subabas da página aberta, compartilhadas com o menu lateral: a página registra as abas (Tabs com `pageTabs`)
 * e o menu estendido as mostra embaixo da página atual. Com o menu estendido, a fileira de abas da página some.
 */
export type PageTab = { value: string; label: string };
type State = { items: PageTab[]; value: string | null; setValue: ((v: string) => void) | null; menuExtended: boolean };

let state: State = { items: [], value: null, setValue: null, menuExtended: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const pageTabsStore = {
  get: () => state,
  set(patch: Partial<State>) {
    const next = { ...state, ...patch };
    if (next.items === state.items && next.value === state.value && next.setValue === state.setValue && next.menuExtended === state.menuExtended) return;
    state = next;
    emit();
  },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};

export const usePageTabs = () => useSyncExternalStore(pageTabsStore.subscribe, pageTabsStore.get, pageTabsStore.get);
