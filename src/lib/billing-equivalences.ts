export function billingSourceKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
export function uniqueBillingClients(names: string[]) {
  const clients = new Map<string, string>();
  for (const name of names) {
    const key = billingSourceKey(name);
    if (key && !clients.has(key)) clients.set(key, name.trim());
  }
  return [...clients].map(([key, name]) => ({key, name})).sort((a,b) => a.name.localeCompare(b.name,'pt-BR'));
}
