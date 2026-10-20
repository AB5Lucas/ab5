INSERT INTO public.role_page_access (role, path, allowed)
SELECT role, '/ausencias', bool_or(allowed) FROM public.role_page_access
WHERE path IN ('/ausencias/folgas','/ausencias/ferias','/ausencias/atestados') GROUP BY role
ON CONFLICT (role, path) DO NOTHING;
INSERT INTO public.user_page_access (user_id, path, allowed)
SELECT user_id, '/ausencias', bool_or(allowed) FROM public.user_page_access
WHERE path IN ('/ausencias/folgas','/ausencias/ferias','/ausencias/atestados') GROUP BY user_id
ON CONFLICT (user_id, path) DO NOTHING;