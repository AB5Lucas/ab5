ALTER TABLE public.daily_allocations ADD COLUMN IF NOT EXISTS overnight boolean NOT NULL DEFAULT false;

ALTER TYPE public.bonus_calculation_type ADD VALUE IF NOT EXISTS 'overnight';

ALTER TABLE public.transport_voucher_rules ADD COLUMN IF NOT EXISTS minimum_distance numeric NOT NULL DEFAULT 0;
ALTER TABLE public.transport_voucher_rules ADD COLUMN IF NOT EXISTS maximum_distance numeric;