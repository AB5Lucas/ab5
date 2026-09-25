ALTER TABLE public.asos DROP COLUMN expires_at;
ALTER TABLE public.asos ADD COLUMN expires_at date NOT NULL GENERATED ALWAYS AS (((exam_date + interval '1 year')::date - 1)) STORED;

UPDATE public.collaborator_trainings ct
SET expires_at = ct.expires_at - 1
FROM public.trainings t
WHERE t.id = ct.training_id
  AND ct.expires_at = (ct.completed_at + make_interval(months => t.validity_months))::date;

UPDATE public.client_integrations
SET expires_at = expires_at - 1
WHERE expires_at = (integration_date + interval '1 year')::date;