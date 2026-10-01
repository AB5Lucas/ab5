# Programação by client + new "Serviços" page

## What changes for you

**Programação**
- One box per **client** for the day, instead of one per service. All the client's people appear together, in alphabetical order.
- Everything else stays as it is: dates, dragging, search, VT dots, integrations, absences, copying the day before (a Monday copies the Friday before), the extra boxes.
- When someone is dragged into a client box, they go into one of that client's services automatically:
  - the service they were in the last time they worked for that client;
  - if they've never worked there, the client's first active service.
- A client with only one active service works exactly as today.

**Serviços (new page, in the Planejamento menu, below Programação)**
- Pick the **client** and the **date**, using the same date bar and arrows as Programação.
- Main area: one box for each active service of that client.
- Right side: the people scheduled for that client in Programação on that day.
- Drag people between services. It saves right away, for that date, client, service and person.
- Only people scheduled for that client in Programação appear. Anyone taken out of Programação disappears from the services too.
- **Copiar dia anterior** copies the split from the day before (a Monday copies the Friday before). Only people scheduled for that client today are included.
- **+ Novo Serviço** opens a window with the service name. The client is already filled in and can't be changed. The new service shows up right away, and also under Obras → Serviços.

**RDO, Resultados, VT and Transporte**
- They keep reading each person's service.
- A client with several services: they follow the split you make in Serviços.
- A client with only one service: they keep using Programação, as today.

**Permissions**
- The Serviços page appears in Acessos, so you can switch it on or off for each user type, including Encarregado.
- Encarregado and Coordenador see only the clients of the jobs assigned to them in Usuários. They can only create services and move people for those clients.
- Administrador and Programador see every client.

## Technical details

- Data model stays the same: `daily_allocations.work_id` is the service. Programação groups allocations by `works.client_id` in the UI. Dropping into a client box picks a `work_id` (the person's last `work_id` for that client, otherwise the first active work of the client by name). Copying keeps `work_id`, so the Serviços split is copied too.
- New route `src/routes/_authenticated/programacao.servicos.tsx`, added to `MENU_GROUPS` (Planejamento). `menuUrlFor` handles it on its own path, before the `/programacao` prefix fallback.
- Migration:
  - RPC `move_allocation_service(_alloc_id, _work_id)`, SECURITY DEFINER. It checks that the target work has the same `client_id` and that the caller has `can_write()` or a `foreman_works` link to a work of that client.
  - RPC `copy_service_split(_client_id, _date)`. It copies the previous schedule day's `work_id` per collaborator for allocations of that client.
  - RPC `create_client_service(_client_id, _name)`. It inserts into `works` (active) after the same client-access check.
- Helper `can_access_client(_client_id)` = `can_write()` or a foreman link to any work of that client.
- Client list on the Serviços page: all active clients for writers. For encarregado and coordenador, clients derived from their `foreman_works`.
- `schedule-planner-board.tsx`: refactor work cards into client cards. Copy-dialog "copiar todos juntos" becomes unnecessary and is removed. Per-work VT dot becomes per-client: it writes `schedule_work_vt` for every work of the client.
