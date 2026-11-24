import { useCallback, useRef, useState } from "react";

/**
 * Histórico de desfazer/refazer de um estado em edição (só na tela; nada é gravado).
 * push(antes, rótulo, chave): guarda o estado anterior; mudanças seguidas com a mesma chave em até
 * `groupMs` viram um passo só (digitação contínua no mesmo campo não desfaz letra por letra).
 */
export type HistoryStep<T> = { snap: T; label: string };
export function useEditHistory<T>(groupMs = 500) {
  const past = useRef<HistoryStep<T>[]>([]);
  const future = useRef<HistoryStep<T>[]>([]);
  const last = useRef<{ key: string; at: number } | null>(null);
  const [, bump] = useState(0);
  const refresh = () => bump((n) => n + 1);

  const push = useCallback((before: T, label: string, key?: string) => {
    const now = Date.now();
    const l = last.current;
    future.current = [];
    if (key && l && l.key === key && now - l.at <= groupMs && past.current.length) {
      l.at = now; // mesmo passo: mantém o "antes" do início da digitação
      refresh();
      return;
    }
    past.current.push({ snap: before, label });
    if (past.current.length > 200) past.current.shift();
    last.current = key ? { key, at: now } : null;
    refresh();
  }, [groupMs]);

  /** Desfaz `steps` passos a partir do estado atual; devolve o estado a aplicar (ou null). */
  const undo = useCallback((current: T, steps = 1): T | null => {
    let cur = current;
    let out: T | null = null;
    for (let i = 0; i < steps && past.current.length; i++) {
      const s = past.current.pop()!;
      future.current.push({ snap: cur, label: s.label });
      cur = s.snap;
      out = s.snap;
    }
    last.current = null;
    refresh();
    return out;
  }, []);

  const redo = useCallback((current: T, steps = 1): T | null => {
    let cur = current;
    let out: T | null = null;
    for (let i = 0; i < steps && future.current.length; i++) {
      const s = future.current.pop()!;
      past.current.push({ snap: cur, label: s.label });
      cur = s.snap;
      out = s.snap;
    }
    last.current = null;
    refresh();
    return out;
  }, []);

  const clear = useCallback(() => { past.current = []; future.current = []; last.current = null; refresh(); }, []);

  return {
    push, undo, redo, clear,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    /** Rótulos do mais recente para o mais antigo (lista da seta). */
    undoLabels: past.current.map((s) => s.label).reverse(),
    redoLabels: future.current.map((s) => s.label).reverse(),
  };
}
