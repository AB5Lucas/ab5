ALTER TABLE public.industry_orders ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
UPDATE public.industry_orders SET aliases = ARRAY['27618'] WHERE order_number = '27619';
--> statement-breakpoint
