ALTER TABLE public.work_entries ADD COLUMN IF NOT EXISTS split_group uuid, ADD COLUMN IF NOT EXISTS split_total numeric, ADD COLUMN IF NOT EXISTS split_note text;
CREATE INDEX IF NOT EXISTS work_entries_split_group_idx ON public.work_entries(split_group);
WITH g AS (
  SELECT id, entry_date, category, created_at,
    trim(regexp_replace(coalesce(description,''), '(\s—\s)?Rateio [0-9.,]+% \([0-9]+h\)$', '')) AS base
  FROM public.work_entries WHERE description ~ 'Rateio [0-9.,]+% \([0-9]+h\)$'
), k AS (
  SELECT entry_date, category, created_at, base, gen_random_uuid() AS gid
  FROM g GROUP BY entry_date, category, created_at, base
)
UPDATE public.work_entries e SET split_group = k.gid, split_note = nullif(k.base,''),
  split_total = (SELECT sum(e2.amount) FROM public.work_entries e2 JOIN g g2 ON g2.id = e2.id
                 WHERE g2.entry_date=k.entry_date AND g2.category=k.category AND g2.created_at=k.created_at AND g2.base=k.base)
FROM g JOIN k USING (entry_date, category, created_at, base)
WHERE e.id = g.id;