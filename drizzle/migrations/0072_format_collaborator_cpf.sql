CREATE OR REPLACE FUNCTION public.format_collaborator_cpf()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE d text;
BEGIN
  IF NEW.cpf IS NOT NULL THEN
    d := regexp_replace(NEW.cpf, '\D', '', 'g');
    IF length(d) = 11 THEN
      NEW.cpf := substr(d,1,3)||'.'||substr(d,4,3)||'.'||substr(d,7,3)||'-'||substr(d,10,2);
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_format_collaborator_cpf ON public.collaborators;
CREATE TRIGGER trg_format_collaborator_cpf BEFORE INSERT OR UPDATE OF cpf ON public.collaborators
FOR EACH ROW EXECUTE FUNCTION public.format_collaborator_cpf();
UPDATE public.collaborators SET cpf = cpf WHERE cpf IS NOT NULL AND cpf !~ '^\d{3}\.\d{3}\.\d{3}-\d{2}$';