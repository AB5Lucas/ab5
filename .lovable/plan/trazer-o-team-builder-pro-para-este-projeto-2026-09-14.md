# Trazer o Team Builder Pro para este projeto

Li o repositório `AB5Lucas/team-builder-pro`. Boa notícia: ele já usa exatamente a mesma base deste projeto, então é uma cópia direta, sem reescrita.

## O que o app tem hoje

Sistema de gestão de equipes de obra, com login e 22 telas:

- Painel geral (dashboard) e relatórios
- Colaboradores: lista e estrutura (departamentos, setores, cargos)
- Obras: lista, equipes-base e requisitos
- Programação: hoje, diária, semanal e histórico
- Ausências: férias, atestados e folgas
- Benefícios: vale-transporte e prêmio-viagem
- Veículos: frota, motoristas e transporte
- Treinamentos
- Administração: usuários, configurações e auditoria

O banco tem 22 tabelas (colaboradores, obras, escalas, alocações, férias, veículos, regras de vale-transporte e prêmio-viagem, registros de auditoria, entre outras), com controle de acesso por perfil de usuário.

## Como vou trazer

1. **Ativar o Lovable Cloud** neste projeto, para ter banco de dados e login.
2. **Copiar todo o código**: as 22 telas, o menu lateral, o quadro de programação diária, o gerenciador de ausências, as regras de cálculo e o design (cores e estilos).
3. **Recriar o banco**: aplicar as três migrações do repositório, criando tabelas, permissões e regras de acesso idênticas.
4. **Ajustar o login** para a base de contas deste projeto.
5. **Testar**: abrir cada área principal, criar e editar um registro de exemplo e conferir que nada quebrou. Depois apago os registros de teste.

## O que não vem junto

- **Os dados já cadastrados** (colaboradores, obras, escalas) não vêm no código. O app abre com o banco vazio. Se quiser trazer os registros, você exporta as tabelas em CSV no projeto antigo e me envia depois.
- **As contas de usuário** também não migram. Será preciso cadastrar de novo as pessoas que vão acessar.

## Detalhes técnicos

- Mesmo stack: TanStack Start + React 19 + Vite + Tailwind v4 + shadcn/ui.
- Diferenças de versão de pacotes são mínimas; mantenho as versões fixadas deste projeto e adiciono `@supabase/supabase-js`.
- Rotas protegidas ficam sob `_authenticated/`, com o gate já presente no repositório de origem, adaptado à integração gerenciada aqui.
- Migrações: `20260804133011`, `20260804133032`, `20260914124652`, aplicadas na ordem.

## O que preciso de você

- Aprovar este plano para eu começar.
- Opcional: exportar os dados atuais em CSV, se quiser o conteúdo junto.
