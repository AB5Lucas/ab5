<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- RDO: tabelas rdos/rdo_workforce/rdo_services/rdo_scaffolds/rdo_media/rdo_signatures ligadas a obra+data; efetivo sincroniza com daily_allocations enquanto rascunho; classificação de ausência move para daily_status_entries (lib/rdo.ts). Por quê: base para fechamento de custos sem duplicar cadastros.
- Page access: MENU_GROUPS in src/lib/menu.ts is the single menu source; role_page_access (admin-only writes) + useAccess gate sidebar and _authenticated layout. Why: Acessos page must mirror the real menu.
