import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Save,Pencil,Trash2} from 'lucide-react';
import {toast} from 'sonner';
import {supabase} from '@/integrations/supabase/client';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {fetchAll} from '@/lib/results-engine';
import {uniqueBillingClients} from '@/lib/billing-equivalences';
import type {Database} from '@/integrations/supabase/types';
type Equivalence=Database['public']['Tables']['billing_client_equivalences']['Row'];
type Client={id:string;name:string};
export function BillingEquivalences({names,reprocess}:{names:string[];reprocess:()=>Promise<unknown>}) {
 const qc=useQueryClient();
 const [search,setSearch]=useState('');const [source,setSource]=useState('');const [target,setTarget]=useState('');
 const aliases=useQuery({queryKey:['billing-sync','equivalences'],queryFn:()=>fetchAll<Equivalence>((a,b)=>supabase.from('billing_client_equivalences').select('*').order('source_key').range(a,b))});
 const clients=useQuery({queryKey:['billing-equivalence-clients'],queryFn:()=>fetchAll<Client>((a,b)=>supabase.from('clients').select('id,name').order('name').order('id').range(a,b))});
 const sources=uniqueBillingClients([...names,...(aliases.data??[]).map(e=>e.source_name)]);
 const matches=(name:string)=>name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'));
 const save=useMutation({mutationFn:async(remove?:string)=>{
  if(remove){const {error}=await supabase.from('billing_client_equivalences').delete().eq('source_key',remove);if(error)throw error;}
  else {const selected=sources.find(c=>c.key===source);if(!selected||!target)throw new Error('Selecione os dois clientes');const {error}=await supabase.from('billing_client_equivalences').upsert({source_key:source,source_name:selected.name,client_id:target,updated_at:new Date().toISOString()});if(error)throw error;}
 },onSuccess:async()=>{
  await qc.invalidateQueries({queryKey:['billing-sync','equivalences']});toast.success('Equivalências salvas');
  try {await reprocess();await qc.invalidateQueries({queryKey:['billing-sync']});toast.success('Notas reprocessadas');}
  catch {toast.error('Equivalência salva; não foi possível reprocessar agora. Tente Sincronizar agora.');}
 },onError:(e:Error)=>toast.error(e.message)});
 return <div className="space-y-4">
 {(clients.error||aliases.error)&&<p role="alert" className="text-destructive">Não foi possível carregar as equivalências.</p>}
 <div className="flex flex-wrap items-end gap-3">
 <div className="w-full sm:w-60"><Label htmlFor="equivalence-search">Filtrar clientes das notas</Label><Input id="equivalence-search" placeholder="Nome do cliente" value={search} onChange={e=>setSearch(e.target.value)}/></div>
 <div className="w-full sm:w-72"><Label>Cliente nas notas</Label><Select value={source} onValueChange={v=>{setSource(v);setTarget(aliases.data?.find(e=>e.source_key===v)?.client_id??'');}}><SelectTrigger aria-label="Cliente nas notas"><SelectValue placeholder="Selecionar cliente"/></SelectTrigger><SelectContent>{sources.filter(c=>matches(c.name)||c.key===source).map(c=><SelectItem key={c.key} value={c.key}>{c.name}</SelectItem>)}</SelectContent></Select></div>
 <div className="w-full sm:w-72"><Label>Cliente correspondente</Label><Select value={target} onValueChange={setTarget}><SelectTrigger aria-label="Cliente correspondente"><SelectValue placeholder="Selecionar cliente cadastrado"/></SelectTrigger><SelectContent>{clients.data?.map(c=><SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
 <Button disabled={!source||!target||save.isPending} onClick={()=>save.mutate(undefined)}><Save className="h-4 w-4"/>{save.isPending?'Salvando…':'Salvar equivalência'}</Button>
 </div>
 <Table><TableHeader><TableRow><TableHead>Cliente nas notas</TableHead><TableHead>Cliente correspondente</TableHead><TableHead className="w-24"/></TableRow></TableHeader><TableBody>{aliases.data?.filter(e=>matches(e.source_name)).map(e=><TableRow key={e.source_key}><TableCell>{e.source_name}</TableCell><TableCell>{clients.data?.find(c=>c.id===e.client_id)?.name??'Carregando…'}</TableCell><TableCell className="whitespace-nowrap"><Button variant="ghost" size="icon" aria-label={`Editar equivalência ${e.source_name}`} title="Editar equivalência" disabled={save.isPending} onClick={()=>{setSource(e.source_key);setTarget(e.client_id);}}><Pencil className="h-4 w-4"/></Button><Button variant="ghost" size="icon" aria-label={`Remover equivalência ${e.source_name}`} title="Remover equivalência" disabled={save.isPending} onClick={()=>{if(window.confirm(`Remover a equivalência de ${e.source_name}?`))save.mutate(e.source_key);}}><Trash2 className="h-4 w-4"/></Button></TableCell></TableRow>)}</TableBody></Table>
 {!aliases.isLoading&&!aliases.data?.length&&<p className="py-6 text-center text-muted-foreground">Nenhuma equivalência cadastrada</p>}
 </div>;
}
