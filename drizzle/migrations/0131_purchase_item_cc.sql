-- Item da SC: CC digitado à mão (vazio = automático: prefixo do cliente + sufixo do serviço, rateio = 999).
ALTER TABLE public.purchase_request_items ADD COLUMN IF NOT EXISTS cc_code text;
