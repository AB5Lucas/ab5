import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

// Opt-in against a real authenticated app session; temporary records are removed in finally.
const url = process.env['VITE_SUPABASE_URL'];
const key = process.env['VITE_SUPABASE_PUBLISHABLE_KEY'];
const token = process.env['RECURRING_TEST_TOKEN'];
const enabled = !!url && !!key && !!token;
const work = '4ab9b2e2-d667-47ba-8fa1-d3cb3afd17a0';
const suite = enabled ? describe : describe.skip;
suite('recorrências mensais — banco real', () => {
  const client = createClient(url ?? 'http://localhost', key ?? 'test', { auth: { persistSession: false }, accessToken: async () => token ?? null });
  const month = new Date().toISOString().slice(0, 7) + '-01';
  const nextMonth = () => { const date = new Date(month); date.setUTCMonth(date.getUTCMonth() + 1); return date.toISOString().slice(0, 10); };
  async function temporary(active: boolean, start: string, end: string | null, fn: (id: string, description: string) => Promise<void>) {
    const description = 'Teste recorrência ' + crypto.randomUUID();
    const result = await client.from('work_entry_recurrences').insert({ work_id: work, category: 'ferramentas', description, amount: 1.23, start_month: start, end_month: end, active }).select('id').single();
    if (result.error || !result.data) throw result.error ?? new Error('Missing recurrence');
    try { await fn(result.data.id, description); } finally {
      const entries = await client.from('work_entries').delete().eq('work_id', work).eq('description', description);
      if (entries.error) throw entries.error;
      const rule = await client.from('work_entry_recurrences').delete().eq('id', result.data.id);
      if (rule.error) throw rule.error;
    }
  }
  async function generate() { const r = await client.rpc('generate_recurring_entries', { _work_ids: [work] }); if (r.error) throw r.error; }
  async function rows(id: string) { const r = await client.from('work_entries').select('*').eq('recurrence_id', id); if (r.error) throw r.error; return r.data ?? []; }
  it('adota manual igual sem duplicar', async () => temporary(true, month, month, async (id, description) => {
    const manual = await client.from('work_entries').insert({ work_id: work, category: 'ferramentas', description, amount: 1.23, entry_date: month }).select('id').single();
    if (manual.error) throw manual.error;
    await generate(); const entries = await rows(id);
    expect(entries).toHaveLength(1); expect(entries[0]?.id).toBe(manual.data?.id); expect(entries[0]?.recurrence_month).toBe(month);
  }));
  it('chamadas concorrentes geram exatamente um lançamento no dia 01', async () => temporary(true, month, null, async id => {
    await Promise.all([generate(), generate(), generate()]); const entries = await rows(id);
    expect(entries).toHaveLength(1); expect(entries[0]?.entry_date).toBe(month); expect(Number(entries[0]?.amount)).toBe(1.23);
  }));
  it('mês final limita geração e alteração preserva histórico', async () => temporary(true, '2026-10-01', '2026-10-01', async id => {
    await generate(); const changed = await client.from('work_entry_recurrences').update({ amount: 2.34 }).eq('id', id); if(changed.error) throw changed.error;
    await generate();const entries = await rows(id);expect(entries).toHaveLength(1);expect(entries[0]?.entry_date).toBe('2026-10-01');expect(Number(entries[0]?.amount)).toBe(1.23);
  }));
  it('recorrência encerrada não gera lançamentos', async () => temporary(false, month, null, async id => { await generate(); expect(await rows(id)).toHaveLength(0); }));
  it('não antecipa meses futuros', async () => temporary(true, nextMonth(), null, async id => { await generate(); expect(await rows(id)).toHaveLength(0); }));
  it('Amcor tem 24 meses únicos e R$108360', async () => {
    const r = await client.from('work_entries').select('entry_date,amount').eq('work_id', work).eq('category', 'andaimes').eq('description', '430 m³').eq('amount', 4515).gte('entry_date','2024-12-01').lte('entry_date','2026-11-30');
    if(r.error) throw r.error;expect(r.data).toHaveLength(24);expect(new Set(r.data?.map(e=>e.entry_date.slice(0,7))).size).toBe(24);expect(r.data?.reduce((sum,e)=>sum+Number(e.amount),0)).toBe(108360);
  });
});