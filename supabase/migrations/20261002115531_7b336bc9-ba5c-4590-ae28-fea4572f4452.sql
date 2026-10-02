CREATE TABLE public.city_distances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_a text NOT NULL,
  city_b text NOT NULL,
  km numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_a, city_b)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.city_distances TO authenticated;
GRANT ALL ON public.city_distances TO service_role;
ALTER TABLE public.city_distances ENABLE ROW LEVEL SECURITY;
CREATE POLICY cd_select ON public.city_distances FOR SELECT TO authenticated USING (true);
CREATE POLICY cd_write ON public.city_distances FOR ALL TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());
INSERT INTO public.city_distances (city_a, city_b, km) VALUES
('jaguariuna','salto de pirapora',160),('jaguariuna','paulinia',20),('jaguariuna','limeira',60),('jaguariuna','mogi guacu',45),('jaguariuna','jundiai',70),('jaguariuna','mogi mirim',30),('jaguariuna','itapira',40),('jaguariuna','itu',100),('jaguariuna','guararema',140),('jaguariuna','pouso alegre',150),('jaguariuna','sumare',35),('jaguariuna','amparo',30),
('pouso alegre','salto de pirapora',290),('pouso alegre','paulinia',170),('pouso alegre','limeira',200),('pouso alegre','mogi guacu',165),('pouso alegre','jundiai',170),('pouso alegre','mogi mirim',175),('pouso alegre','itapira',150),('pouso alegre','itu',230),('pouso alegre','guararema',190),('pouso alegre','sumare',185),('pouso alegre','amparo',130);