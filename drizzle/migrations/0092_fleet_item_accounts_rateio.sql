-- Frota › Notas › Item Conta: o mesmo CC pode ter mais de um rateio (ex.: 1001999 Indústria e Pátio).
-- description passa a ser o nome do rateio e a chave única vira CC + rateio.
ALTER TABLE public.fleet_item_accounts DROP CONSTRAINT IF EXISTS fleet_item_accounts_cc_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS fleet_item_accounts_cc_rateio ON public.fleet_item_accounts (cc_code, coalesce(description, ''));

-- Tabela de rateios enviada pelo Compras (nov/2026).
INSERT INTO public.fleet_item_accounts (description, cc_code, item_account) VALUES
('DIRETORIA','2000','010'),('COMERCIAL INDÚSTRIA','1001000','013'),('PPO','1001001','003'),('JATO','1001002','002'),
('REMOÇÃO','1001003','003'),('PLIQ','1001004','002'),('INDÚSTRIA','1001999','003'),('PATIO','1001999','008'),
('COMERCIAL SERVIÇOS','2000999','013'),('SERVIÇOS','2000999','007'),('ADM MARS','2004221','018'),('CALDEIRARIA MARS','2004222','007'),
('OPERAÇÕES MARS','2004223','007'),('MARS','2004999','008'),('TENNECO','2005999','006'),('ZINGA COCA COLA','2025015','006'),
('COCA COLA','2025999','008'),('MARS GUARAREMA','2026999','006'),('SUZANO','2030999','008'),('COCA COLA ITABIRITO','2032999','008'),
('ROUSSELOT','2035999','007'),('CORTAG','2037999','006'),('YPÊ AMPARO','2043999','006'),('PAPIRUS','2049999','008'),
('BRK','2052999','008'),('VEILING','2060999','007'),('UNILEVER AGUAÍ','2061999','006'),('CORTEVA','2066999','007'),
('BOEHRINGER','2067999','008'),('MOINHOS GUAÇU','2069999','006'),('HYSTER-YALE','2070999','006'),('CASTERTECH','2072999','006'),
('PLATIBANDAS TAKEDA','2075005','007'),('TAKEDA','2075999','007'),('SESI ITAPIRA','2077999','007'),('SESI MOGI GUAÇU','2078999','007'),
('ENGEKO','2079999','008'),('LAVITTTA','2084999','008'),('ENGEMOM','2085999','008'),('OTMIX','2086999','008'),
('RENOVENT','2087999','008'),('SESI SJBV','2089999','007'),('SESI TAMBAÚ','2090999','007'),('MAHLE MOGI GUAÇU','2092999','007'),
('NORMOM','2093999','008'),('RAIZEN','2094999','007'),('UMICORE','2095999','008'),('SUSPENSYS','2097999','007'),
('WÜRTH','2098999','006'),('MONSTEEL','2099999','006'),('GRIMALDI','2100999','008'),('ADIMAX','2101999','006'),
('SYENSQO','2104999','007'),('GENERAL MILLS','2111999','006'),('YARA','2113999','007'),('CRISTÁLIA JAGUARIÚNA','2115999','007'),
('CRISTÁLIA ITAPIRA','2116999','007'),('TRÊS CORAÇÕES','2117999','006')
ON CONFLICT (cc_code, coalesce(description, '')) DO UPDATE SET item_account = EXCLUDED.item_account, updated_at = now();
