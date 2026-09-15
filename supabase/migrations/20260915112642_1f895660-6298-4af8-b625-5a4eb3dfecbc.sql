CREATE TYPE public.contract_type AS ENUM ('efetivo', 'pj', 'intermitente');
ALTER TABLE public.collaborators ADD COLUMN salary numeric, ADD COLUMN contract_type public.contract_type;