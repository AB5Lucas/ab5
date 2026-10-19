import {describe, expect, it} from 'vitest';
import {billingSourceKey, uniqueBillingClients} from './billing-equivalences';
describe('equivalências', () => {
 it('não repete os clientes das notas', () => {
  expect(uniqueBillingClients(['SPAL JUNDIAI','SPAL JUNDIAI','spal jundiaí','HYSTER']).map(c=>c.name)).toEqual(['HYSTER','SPAL JUNDIAI']);
 });
 it('aplica uma mesma chave a todas as notas do cliente sem misturar unidades', () => {
  expect(billingSourceKey('spal jundiaí')).toBe('SPALJUNDIAI');
  expect(billingSourceKey('SPAL OUTRA UNIDADE')).not.toBe('SPALJUNDIAI');
 });
});
