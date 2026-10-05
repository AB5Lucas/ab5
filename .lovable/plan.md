# Liberar escalação só nos clientes onde o documento foi aceito

## Como fica
Hoje o cadastro do colaborador (ASO, treinamento) só é atualizado quando a Conferência é **concluída**, ou seja, quando todos os clientes aceitaram. Até lá ele segue bloqueado em todo lugar.

Com a mudança:
- Quando um cliente aceita o documento na Conferência, o colaborador pode ser escalado nos serviços **desse cliente**, mesmo com o ASO/treinamento ainda vencido ou ausente no cadastro.
- Nos clientes que ainda não aceitaram, continua bloqueado com o motivo de sempre ("ASO vencido", "Falta: Treinamento X"), e passa a mostrar também "Documento aguardando aceite deste cliente na Conferência".
- Quando a Conferência for concluída, o cadastro é atualizado como hoje e o bloqueio some em todos os clientes.
- Vale para a Programação diária (arrastar/soltar e "Copiar dia anterior") e para a aba Serviços (Adicionar colaborador).

## Detalhes técnicos
- `fetchScheduleContext` (src/lib/scheduling.ts): carregar também os aceites (`conference_checks` com `approved = true`) cujo item da Conferência não está concluído, juntando com `conference_items` para saber colaborador, tipo (aso / treinamento + training_id) e o cliente que aceitou.
- Novo helper `acceptedForClient(ctx, collaboratorId, kind, clientId, trainingId?)`.
- `checkAso` passa a receber o serviço (opcional): se o ASO estiver vencido/ausente mas houver aceite para o cliente do serviço, retorna "valid" para aquele serviço.
- `checkRequirements` (requisito de treinamento): mesma regra, considerando o training_id aceito para o cliente do serviço.
- Atualizar as chamadas em `schedule-planner-board.tsx` (avaliação, cópia do dia anterior) e `programacao.servicos.tsx` (motivo de bloqueio) para passar o serviço.
- Ao aceitar um cliente na Conferência, invalidar `schedule-ctx` para a Programação refletir na hora.
- Integração por cliente não muda (já é por cliente e só vale após conclusão).
