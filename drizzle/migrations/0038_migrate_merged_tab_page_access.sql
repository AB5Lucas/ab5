WITH m(old_path, new_path) AS (VALUES
 ('/treinamentos','/agendamentos'),('/colaboradores/asos','/agendamentos'),('/obras/integracoes','/agendamentos'),
 ('/colaboradores/estrutura','/colaboradores'),('/colaboradores/turnos','/colaboradores'),
 ('/veiculos','/veiculos/transporte'),('/veiculos/motoristas','/veiculos/transporte'),('/veiculos/relatorios','/veiculos/transporte'),
 ('/beneficios/premio-motorista','/fechamento'),('/beneficios/premio-viagem','/fechamento'),('/beneficios/vale-transporte','/fechamento'))
INSERT INTO public.role_page_access (role, path, allowed)
SELECT DISTINCT r.role, m.new_path, true FROM public.role_page_access r JOIN m ON m.old_path = r.path
WHERE r.allowed AND NOT EXISTS (SELECT 1 FROM public.role_page_access x WHERE x.role = r.role AND x.path = m.new_path);

WITH m(old_path, new_path) AS (VALUES
 ('/treinamentos','/agendamentos'),('/colaboradores/asos','/agendamentos'),('/obras/integracoes','/agendamentos'),
 ('/colaboradores/estrutura','/colaboradores'),('/colaboradores/turnos','/colaboradores'),
 ('/veiculos','/veiculos/transporte'),('/veiculos/motoristas','/veiculos/transporte'),('/veiculos/relatorios','/veiculos/transporte'),
 ('/beneficios/premio-motorista','/fechamento'),('/beneficios/premio-viagem','/fechamento'),('/beneficios/vale-transporte','/fechamento'))
INSERT INTO public.user_page_access (user_id, path, allowed)
SELECT DISTINCT u.user_id, m.new_path, true FROM public.user_page_access u JOIN m ON m.old_path = u.path
WHERE u.allowed AND NOT EXISTS (SELECT 1 FROM public.user_page_access x WHERE x.user_id = u.user_id AND x.path = m.new_path);