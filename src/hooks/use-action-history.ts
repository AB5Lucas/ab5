import { useCallback, useRef, useState } from "react";

/**
 * Desfazer/refazer de ações já gravadas (Comprador e Aprovador): cada passo guarda como desfazer e refazer
 * (normalmente a mesma função de gravação com o valor antigo/novo). Para a lista e os botões de compras/undo-redo.
 */
export type ActionStep = { label: string; undo: () => Promise<void> | void; redo: () => Promise<void> | void };
export function useActionHistory() {
  const past = useRef<ActionStep[]>([]);
  const future = useRef<ActionStep[]>([]);
  const busy = useRef(false);
  const [, bump] = useState(0);
  const refresh = () => bump((n) => n + 1);
  const push = useCallback((s: ActionStep) => { past.current.push(s); if (past.current.length > 100) past.current.shift(); future.current = []; refresh(); }, []);
  const undo = useCallback(async (steps = 1) => {
    if (busy.current) return;
    busy.current = true;
    try {
      for (let i = 0; i < steps && past.current.length; i++) {
        const s = past.current.pop()!;
        await s.undo();
        future.current.push(s);
      }
    } finally { busy.current = false; refresh(); }
  }, []);
  const redo = useCallback(async (steps = 1) => {
    if (busy.current) return;
    busy.current = true;
    try {
      for (let i = 0; i < steps && future.current.length; i++) {
        const s = future.current.pop()!;
        await s.redo();
        past.current.push(s);
      }
    } finally { busy.current = false; refresh(); }
  }, []);
  return {
    push, undo, redo,
    undoLabels: [...past.current].reverse().map((s) => s.label),
    redoLabels: [...future.current].reverse().map((s) => s.label),
  };
}
export type ActionHistory = ReturnType<typeof useActionHistory>;
