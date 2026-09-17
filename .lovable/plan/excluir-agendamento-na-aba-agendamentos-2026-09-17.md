# Excluir agendamento na aba Agendamentos

## O que muda

Na lista de pendências, ao lado do botão X (não realizado), entra um botão "−" que exclui o agendamento de vez.

Antes de excluir, aparece uma janela de confirmação mostrando tipo, colaborador e data do agendamento, com os botões "Cancelar" e "Excluir". Só depois de confirmar o agendamento é apagado; a lista e a Programação Diária se atualizam na hora.

O botão aparece apenas para quem tem permissão de edição, igual aos botões ✓ e X.

## Detalhes técnicos

- `src/routes/_authenticated/agendamentos.tsx`: novo botão ghost `h-7 w-7` com o ícone `Minus` (lucide-react), `aria-label="Excluir agendamento"`, ao lado do X.
- Estado `deleteRow: Row | null`; o botão apenas define esse estado.
- `AlertDialog` (shadcn) de confirmação; ação executa uma mutation `remove` com `supabase.from("appointments").delete().eq("id", row.id)`.
- `onSuccess`: `toast.success("Agendamento excluído")`, fecha o diálogo e chama o `invalidate()` já existente (que revalida `appointments` e `appointments-day`).
