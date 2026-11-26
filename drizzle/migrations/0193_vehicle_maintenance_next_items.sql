-- Manutenção: próximos serviços informados à mão (serviço + km) e km atual informado à mão (com data),
-- usados junto com a regra de revisão (o que vier primeiro). Carga dos dados passados pelo usuário em 26/11.
ALTER TABLE public.vehicle_maintenance_plans
  ADD COLUMN IF NOT EXISTS next_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS km_reading numeric,
  ADD COLUMN IF NOT EXISTS km_reading_date date;

INSERT INTO public.vehicle_maintenance_plans (vehicle_id, km_reading, km_reading_date, next_items, notes, updated_at)
SELECT v.id, d.km, d.dt::date, d.items::jsonb, d.notes, now()
FROM (VALUES
  ('FRE2I10', 412735, '2026-11-24', '[{"service":"Troca de óleo e filtros","km":414700}]', NULL),
  ('MNL0D94', 100981, '2026-11-24', '[{"service":"Troca de óleo e filtros","km":115000},{"service":"Verificar rolamentos de rodas e freios","km":117000}]', NULL),
  ('TDJ9B47', 90586, '2026-11-24', '[{"service":"Revisão","km":100000}]', NULL),
  ('UQR7J58', 10705, '2026-11-24', '[{"service":"Revisão","km":20000}]', 'Jefferson'),
  ('UPZ9F62', 20334, '2026-11-24', '[{"service":"Revisão","km":40000}]', 'Marcelo Guilherme'),
  ('UOQ4C20', 15598, '2026-11-24', '[{"service":"Revisão","km":20000}]', 'Marcelo Negro'),
  ('FXW1G64', 499922, '2026-11-24', '[{"service":"Troca de óleo","km":505000}]', NULL),
  ('FZZ0A13', 234160, '2026-11-25', '[{"service":"Troca de óleo e filtros","km":235000}]', NULL),
  ('EJZ2930', 305552, '2026-11-25', '[{"service":"Troca de óleo e filtros + alinhamento","km":312500}]', 'Uno preto'),
  ('CYT2B52', 217526, '2026-11-25', '[{"service":"Troca de óleo e filtros","km":218500}]', 'Strada marrom'),
  ('UPF9I34', 13857, '2026-11-25', '[{"service":"Revisão","km":20000}]', 'Fabio Teixeira')
) AS d(plate, km, dt, items, notes)
JOIN public.vehicles v ON upper(replace(v.plate, '-', '')) = d.plate
ON CONFLICT (vehicle_id) DO UPDATE SET km_reading = EXCLUDED.km_reading, km_reading_date = EXCLUDED.km_reading_date,
  next_items = EXCLUDED.next_items, notes = coalesce(vehicle_maintenance_plans.notes, EXCLUDED.notes), updated_at = now();
