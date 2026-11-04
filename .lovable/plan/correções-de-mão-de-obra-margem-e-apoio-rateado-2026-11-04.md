# Correções de mão de obra, margem e apoio rateado

## O que será corrigido
1. **Escalado sem RDO:** considerar zero horas, VT e prêmio viagem quando existir qualquer RDO do cliente naquele dia e o colaborador não constar nele. Manter 8h apenas nos dias sem RDO do cliente. Mostrar os casos na janela de mão de obra.
2. **Margem sem receita:** substituir o percentual enganoso por “—”, em vermelho, com “Sem receita no período”, preservando o valor negativo em reais. Aplicar às telas e exportações compartilhadas.
3. **Apoio rateado:** disponibilizar cadastro por colaborador e cliente em Resultados; ativar Marcelo Henrique Nery de Carvalho e Alan Denilson Ferreira na Três Corações. Distribuir MO, VT e prêmio viagem diários pelas horas dos demais colaboradores em cada serviço, incluindo mensais.

## Preservação das regras
- Não alterar receita dos mensais, adicionais, encargos, impostos, cortes de período nem compras.
- Rateio de apoio conserva o total do cliente. Se não houver horas dos demais colaboradores em nenhum serviço no dia, preservar o destino da escalação e sinalizar a falta de base, evitando perder custos.
- RDO vazio também conta como RDO existente; colaboradores ausentes não recebem horas padrão.

## Verificação e relatório
- Adicionar e executar testes concretos para as três correções e regressões do motor compartilhado.
- Conferir o fluxo autenticado das telas e o cadastro de apoio.
- Auditar outubro/2026: casos de escalado sem RDO com datas, horas/custos removidos e impacto por cliente; serviços sem receita afetados; Três Corações antes/depois por serviço (MO, transporte e margem), separando a correção de horas do efeito do rateio.

## Detalhes técnicos
- Centralizar resolução de horas, existência de RDO por cliente/dia, percentuais indefinidos e pesos diários no motor compartilhado.
- Carregar cabeçalhos de RDO de todos os serviços do cliente, além das linhas de efetivo; manter esse contexto ao dividir consultas em lotes.
- Persistir apoio colaborador/cliente com permissões de leitura/escrita alinhadas ao acesso a Resultados e ao cliente. Não duplicar lançamentos de custo no banco.