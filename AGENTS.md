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
- Programação shows one box per client; the service of each person is daily_allocations.work_id, set in /programacao/servicos via RPCs (move_allocation_service, copy_service_split, create_client_service) guarded by can_access_client. Why: client-level scheduling without breaking RDO/costs per service.
- Fechamento (/fechamento) calcula refeições/VT/prêmio em src/lib/closing.ts a partir de programação, quadros, ausências e RDO; ajustes manuais ficam só em closing_adjustments. Por quê: sem lógica paralela nem duplicidade.
- Aba Serviços: permissão = can_access_page('/programacao/servicos') (via can_access_client), nunca o perfil; no sábado/domingo ela adiciona/remove pessoas e veículos por RPCs weekend_* com advisory lock. Por quê: escalação de fim de semana sem permissões paralelas e sem conflito concorrente.
