# Escalação de fim de semana pela aba Serviços

## O que muda para o usuário

1. **Permissão única = acesso à aba Serviços** (Planejamento → Serviços, em Acessos).
   - Quem tem acesso pode usar todas as funções da aba: dividir efetivo, Montar Efetivo, Montar Transporte, escolher carros e trocar motorista.
   - O perfil (encarregado, coordenador, programador...) deixa de decidir quem pode escalar. Não será criada nenhuma permissão nova.
   - Continua valendo a regra de clientes: encarregado/coordenador só vê os clientes atribuídos a ele em Usuários.

2. **Sábado e domingo: montar o efetivo direto na aba Serviços**
   - Em sábados e domingos, a lista de clientes passa a mostrar os clientes atribuídos mesmo sem ninguém escalado na Programação.
   - O painel direito ganha a opção "Adicionar colaborador", com a lista de todos os colaboradores ativos.
   - Cada colaborador aparece com uma bolinha e o motivo, quando estiver bloqueado:
     - "Já escalado em [cliente – serviço] neste dia"
     - "De folga / férias / atestado"
     - "ASO vencido", "Integração vencida/ausente para este cliente", "Falta treinamento X" (mesmas regras de aptidão da Programação)
   - Bloqueados não podem ser arrastados nem selecionados. Aptos podem ser arrastados direto para uma caixa de serviço.
   - Remover alguém de um serviço no fim de semana tira a pessoa do dia (some da Programação também).
   - Segunda a sexta continua igual a hoje: a aba só divide quem já está na Programação.

3. **Veículos no fim de semana (Montar Transporte)**
   - Botão "Adicionar veículo" lista todos os carros ativos.
   - Carro já usado em outro cliente/serviço no dia aparece bloqueado com "Já alocado em [cliente]". Carro em manutenção também fica bloqueado.
   - Motorista escolhido segue a mesma regra dos colaboradores (não pode estar escalado em outra obra).

4. **Conflitos à prova de duas pessoas ao mesmo tempo**
   - A checagem acontece na tela (ao escolher) e de novo no banco ao salvar. Se outra pessoa escalou o colaborador ou o carro segundos antes, aparece a mensagem "Colaborador já escalado em outra obra neste dia" / "Veículo já alocado em outra obra neste dia" e nada é gravado.

## Detalhes técnicos

- Nova função de banco `can_access_page('/programacao/servicos')` (já existe a genérica) usada em todas as RPCs da aba no lugar de `can_write()`; o escopo de cliente continua via `foreman_works` para quem não é admin/programador.
- Novas RPCs SECURITY DEFINER:
  - `weekend_add_allocation(_client_id, _work_id, _date, _collaborator_id)`: valida sábado/domingo, acesso à página + cliente, `pg_advisory_xact_lock` por colaborador+data, rejeita se já houver `daily_allocations` no dia em outro cliente ou ausência (days_off/vacations/medical_leaves); cria `daily_schedules` do dia se não existir; insere com `service_assigned = true`, `source = 'manual'`.
  - `weekend_remove_allocation(_alloc_id)`: apaga a alocação (só sábado/domingo).
  - `weekend_add_vehicle(_client_id, _work_id, _date, _vehicle_id, _driver_id)`: lock por veículo+data, rejeita se o veículo já tiver `vehicle_schedules` no dia ou status `maintenance/inactive`; cria o registro com KM do cliente.
  - Índice único parcial não é possível entre clientes diferentes de forma simples, por isso os locks transacionais garantem a concorrência.
- Aptidão na tela reaproveita `fetchScheduleContext`, `checkAso`, `checkIntegration`, `checkRequirements` de `src/lib/scheduling.ts`; ASO/integração/requisitos são checados só na tela (como na Programação), enquanto conflito de obra/veículo e ausência são revalidados no banco.
- Arquivos: `programacao.servicos.tsx` (lista de clientes no fim de semana, painel "Adicionar colaborador"), `transport-builder-dialog.tsx` (adicionar veículo), uma migration com as RPCs e troca de `can_access_client` para considerar o acesso à página.
