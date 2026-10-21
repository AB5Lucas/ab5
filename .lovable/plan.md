# Faturamento e Pedidos: Serviços e Indústria

## O que já foi confirmado
- As duas planilhas da Indústria estão acessíveis pela mesma conexão do Excel já usada hoje.
- **Pedidos (26 OUT.xlsx, pasta PCP/PROGRAMAÇÃO/2026):** os dados ficam na aba **Dados**, e não na primeira aba (MDO). Os títulos estão na linha 6 (OP, Cliente, DIV, MP REAL, REALIZ. R$, DATA FINAL). Hoje há 175 pedidos com número e 37 linhas com REC.
- **Faturamento (Fat. Por Vendedor.xls, pasta Faturamento/13 RELATÓRIOS - FATURAMENTO POR VENDEDOR/2026/10 OUTUBRO 2026):** é um relatório em formato .xls antigo. O arquivo é baixado e lido inteiro, linha por linha, usando as colunas B, H, M, Q e AR. As linhas de título e subtotal ficam de fora.
- Na planilha aparecem os códigos de serviço CARR, JATO, PLQ, PPO, **PPO N**, REM e REN. "PPO N" será tratado como PPO.
- Os serviços da INDUSTRIA no sistema são: PPO, Carrinhos, Pliq, Remoção, Jato, Apoio e Manutenção.

## O que muda na tela
1. No menu, **Sincronização** passa a se chamar **Faturamento**. O endereço da página e as permissões continuam os mesmos.
2. A página Faturamento ganha as subabas **Serviços** e **Indústria**:
   - **Serviços** reúne tudo o que existe hoje (notas, exceções, equivalências e histórico) e deixa de usar o nome "Notas Fiscais".
   - **Indústria** segue o mesmo layout e mostra as notas lidas da planilha "Fat. Por Vendedor".
   - O topo de cada subaba mostra só a planilha dela, com a última sincronização, o mês de referência e a situação.
3. A página **Pedidos** ganha as subabas **Serviços** (exatamente como está hoje) e **Indústria**. Na Indústria aparecem pedido, cliente real, serviço, valor, data, matéria-prima e o que já foi faturado.

## Regras da Indústria
- Pedidos e notas são guardados sem zeros à esquerda: 027578 vira 27578.
- O cliente vem da planilha (coluna D nos pedidos e coluna M no faturamento), nunca o texto fixo "Industria".
- Linhas com REC ou sem número de pedido válido não são importadas. Quando receberem número, entram normalmente.
- Classificação dos serviços: PPO, N, REN e PPO N viram PPO; CARR vira Carrinhos; PLQ vira Pliq; REM vira Remoção; JATO vira Jato. Um código desconhecido fica pendente para conferência, sem ser atribuído a nenhum serviço.
- **Matéria-prima:** a coluna J de cada pedido válido vira um custo de Materiais no serviço do pedido, na data do pedido. Se a sincronização rodar de novo, esse custo é atualizado, nunca repetido.
- **Faturamento:** cada nota é ligada ao pedido pelo número (coluna Q) e lançada como faturamento do serviço desse pedido. Uma nota cujo pedido ainda não foi importado fica pendente e é lançada assim que o pedido aparecer.
- Uma mesma nota pode ter vários itens (por exemplo, a nota 28613 tem duas linhas). Os itens são somados e a nota é identificada por número e data, para que uma nova leitura não crie cópias.

## Localização automática e tolerância
- **Pedidos:** pasta do ano, depois o arquivo "AA MÊS" (26 OUT, 26 NOV, 27 JAN...).
- **Faturamento Indústria:** pasta do ano, depois "MM MÊS AAAA" e então "Fat. Por Vendedor.xls".
- **Faturamento Serviços:** o arquivo "VENDAS SERVIÇOS AAAA" é procurado pelo ano, em vez de ficar fixo em 2026.
- Se o arquivo do mês ainda não existir e o mês tiver começado há até 7 dias (prazo ajustável), a situação fica "Aguardando planilha". Os dados anteriores continuam valendo e o sistema tenta de novo na próxima execução. Passado o prazo, a situação vira erro de acesso à fonte.
- Durante os primeiros dias do mês, o mês anterior também é relido, para pegar notas e pedidos que chegaram depois do fechamento.
- Cada fonte roda de forma independente: se uma falhar, as outras continuam.

## Histórico
Cada execução registra a categoria, a fonte (pedidos ou faturamento), o mês de referência, a pasta e o arquivo usados, a quantidade de novos, atualizados, ignorados, pendentes e erros, e a situação: concluída, com pendências, aguardando planilha, erro de acesso ou erro de processamento.

## Revisão retroativa
Depois de pronto, executo a sincronização da Indústria de outubro de 2026, executo a de Serviços de novo e apresento o resumo do que foi importado, atualizado, deixado pendente e das divergências encontradas.

## Detalhes técnicos
- Novas tabelas `industry_orders` (chave única: número do pedido) e `industry_invoices` (chave única: NF + data de emissão, com o total somado dos itens e os itens originais guardados). Ambas registram origem, mês de referência e situação.
- `work_entries` ganha `industry_order_id` e `industry_invoice_id`, com índice único parcial. Assim, a matéria-prima e o faturamento são criados ou atualizados no lugar, sem duplicar, e o motor de resultados lê esses valores sem nenhuma alteração.
- `billing_sync_runs` ganha as colunas categoria, fonte, mês de referência, arquivo e contadores. A situação "aguardando planilha" passa a ser aceita.
- `src/lib/industry-sync.ts` (funções puras, com testes) cuida de: limpar zeros à esquerda, classificar o serviço, montar os nomes de pasta e arquivo por mês, calcular a tolerância e ler as linhas.
- `src/lib/industry-sync.server.ts` encontra cada arquivo navegando pelas pastas, baixa o conteúdo, lê com a biblioteca de planilhas já instalada e grava tudo de uma vez, numa única operação no banco.
- A rotina diária atual também passa a rodar as fontes da Indústria. O botão manual sincroniza a subaba que está aberta.
- Testes: zeros à esquerda, REC, classificação (incluindo PPO N e códigos desconhecidos), nomes de pasta e arquivo na virada do ano, prazo de 7 dias e soma dos itens de uma mesma nota.
