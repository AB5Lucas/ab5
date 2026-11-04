import { createFileRoute } from '@tanstack/react-router';
import { authenticateCronRequest } from '@/integrations/supabase/cron-auth';

export const Route = createFileRoute('/api/public/jobs/recurring-entries')({
  server: { handlers: { POST: async ({ request }) => {
    const failure = await authenticateCronRequest(request);
    if (failure) return failure;
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const result = await supabaseAdmin.rpc('generate_recurring_entries');
    if (result.error) return Response.json({ error: 'Generation failed' }, { status: 503 });
    return Response.json({ generated: result.data });
  } } },
});