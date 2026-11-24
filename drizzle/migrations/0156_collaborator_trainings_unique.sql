-- Um registro por colaborador × treinamento (o mais recente), como já gravam Treinamentos (upsertTrainingRecord)
-- e a importação. A Conferência usava maybeSingle() sem limit e ignorava o erro, podendo inserir uma duplicata.
-- Verificado em 24/11/2026: 751 registros, nenhum par (collaborator_id, training_id) repetido; o DELETE abaixo
-- não apagou nada. Se houver duplicatas, mantém o de vencimento mais recente (sem vencimento = o melhor).
DELETE FROM public.collaborator_trainings ct
USING (
  SELECT id, row_number() OVER (PARTITION BY collaborator_id, training_id
    ORDER BY (expires_at IS NULL) DESC, expires_at DESC NULLS LAST, completed_at DESC NULLS LAST, id) AS rn
  FROM public.collaborator_trainings
) d
WHERE d.id = ct.id AND d.rn > 1;
CREATE UNIQUE INDEX IF NOT EXISTS collaborator_trainings_collab_training_key
  ON public.collaborator_trainings (collaborator_id, training_id);
