-- Diagnóstico da sincronização de Compras: trecho das linhas do arquivo quando algo não confere.
ALTER TABLE purchase_sync_files ADD COLUMN IF NOT EXISTS debug jsonb;
