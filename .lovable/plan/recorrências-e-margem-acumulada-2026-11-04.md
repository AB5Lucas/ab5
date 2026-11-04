# Recorrências e margem acumulada

## Entrega
- Adicionar “Tornar recorrente” e uma lista para editar ou encerrar recorrências na janela de lançamentos de Resultados.
- Gerar lançamentos no primeiro dia de cada mês, com rotina agendada e conferência ao abrir Resultados. Adotar lançamentos manuais iguais, sem duplicá-los.
- Cadastrar Amcor desde dezembro/2024 e completar outubro e novembro/2026: 24 lançamentos de R$ 4.515,00, total R$ 108.360,00.
- Corrigir a margem acumulada de serviços mensais para descontar todo o custo acumulado, não apenas meses com pedido.
- Preservar receita e margem de cada mês individual, apoio rateado e demais regras.
- Testar recorrência, adoção, concorrência, encerramento e margem; conferir telas e entregar comparação da Amcor e dos demais mensais afetados.

## Detalhes técnicos
- Cadastro protegido pelas permissões existentes do serviço, com geração atômica e chave única recorrência/mês.
- Uma função compartilhada gera apenas meses já iniciados; alterações do cadastro valem para meses ainda não gerados, preservando o histórico.
- Usar `full.last.cost` em `totalMargin()` e manter consumidores no motor compartilhado.
- Comparações financeiras até outubro/2026; novembro também será confirmado para os lançamentos recorrentes.