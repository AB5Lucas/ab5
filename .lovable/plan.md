# Conectar este projeto ao GitHub e trazer o código existente

O Lovable não importa um repositório do GitHub direto para dentro de um projeto. O caminho que funciona é o inverso: conectar este projeto a um repositório e usar a sincronia nos dois sentidos para trazer o código antigo.

## Passo a passo

1. **Conectar ao GitHub (você faz na interface)**
   - No editor, abra o menu "+" ao lado do campo de conversa → GitHub → Conectar projeto.
   - Autorize o app do Lovable e escolha a conta ou organização.
   - Clique em "Criar repositório". Isso publica o código atual deste projeto em um repositório novo.

2. **Trazer o código antigo para esse repositório (feito por você, localmente)**
   - Clone o repositório novo criado no passo 1.
   - Copie para dentro dele os arquivos do projeto antigo: telas, componentes, imagens e demais recursos.
   - Envie as alterações. Elas aparecem aqui automaticamente, sem precisar de nenhuma ação extra.

3. **Ajuste da estrutura (eu faço aqui)**
   - Depois que o código chegar, eu adapto o que for necessário para rodar na estrutura deste projeto: organização das páginas, estilos e configuração.
   - Se o projeto antigo usar banco de dados, contas de usuário ou envio de e-mails, eu ativo o Lovable Cloud e recrio essa parte.

## Detalhes técnicos

Este projeto usa TanStack Start (React 19 + Vite 7) com Tailwind v4. Código vindo de outra base provavelmente precisará de adaptação:

- Páginas passam a ser arquivos em `src/routes/` (roteamento por arquivo); `react-router-dom` não é suportado.
- Chamadas de servidor usam `createServerFn`; webhooks e APIs públicas ficam em `src/routes/api/`.
- Estilos globais e tokens de cor ficam em `src/styles.css`.
- Projetos em Vue, Angular, Svelte ou mobile nativo não rodam aqui e precisariam ser reescritos.

## O que preciso de você

- Confirmar quando a conexão com o GitHub estiver feita e o código antigo enviado.
- Dizer quais tecnologias o projeto antigo usa (React? outro framework? tem banco de dados?), para eu já prever o esforço de adaptação.
