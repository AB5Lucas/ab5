import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";
import { pageTabsStore, usePageTabs, type PageTab } from "@/lib/page-tabs-store";

/** Registro das abas de uma página (só no Tabs com `pageTabs`); abas aninhadas não entram. */
const PageTabsCtx = React.createContext<{ register: (value: string, label: string) => () => void } | null>(null);

type TabsProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> & {
  /** Abas principais da página: aparecem no menu lateral estendido (e saem do topo da página). */
  pageTabs?: boolean;
};

const PageTabsRoot = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Root>, Omit<TabsProps, "pageTabs">>(
  ({ value: valueProp, defaultValue, onValueChange, ...props }, ref) => {
    const controlled = valueProp !== undefined;
    const [inner, setInner] = React.useState(defaultValue);
    const value = controlled ? valueProp : inner;
    const [items, setItems] = React.useState<PageTab[]>([]);
    const onChangeRef = React.useRef(onValueChange);
    onChangeRef.current = onValueChange;
    const change = React.useCallback((v: string) => {
      if (!controlled) {
        setInner(v);
        // Sem controle da página, a subaba vai para o endereço (#), para link e recarregar abrirem nela.
        try { history.replaceState(history.state, "", `${location.pathname}${location.search}#${v}`); } catch { /* ignora */ }
      }
      onChangeRef.current?.(v);
    }, [controlled]);
    const register = React.useCallback((v: string, label: string) => {
      setItems((list) => (list.some((x) => x.value === v) ? list.map((x) => (x.value === v ? { value: v, label } : x)) : [...list, { value: v, label }]));
      return () => setItems((list) => list.filter((x) => x.value !== v));
    }, []);
    // Abre na subaba do endereço (#fiscal), quando ela existe.
    const hashDone = React.useRef(false);
    React.useEffect(() => {
      if (hashDone.current || controlled || !items.length) return;
      hashDone.current = true;
      const h = decodeURIComponent(location.hash.slice(1));
      if (h && h !== value && items.some((x) => x.value === h)) setInner(h);
    }, [items, controlled, value]);
    React.useEffect(() => { pageTabsStore.set({ items, value: value ?? null, setValue: change }); }, [items, value, change]);
    React.useEffect(() => () => pageTabsStore.set({ items: [], value: null, setValue: null }), []);
    const ctx = React.useMemo(() => ({ register }), [register]);
    return (
      <PageTabsCtx.Provider value={ctx}>
        <TabsPrimitive.Root ref={ref} {...(value !== undefined ? { value } : {})} onValueChange={change} {...props} />
      </PageTabsCtx.Provider>
    );
  },
);
PageTabsRoot.displayName = "PageTabsRoot";

const Tabs = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Root>, TabsProps>(({ pageTabs, ...props }, ref) =>
  pageTabs ? <PageTabsRoot ref={ref} {...props} /> : (
    <PageTabsCtx.Provider value={null}>
      <TabsPrimitive.Root ref={ref} {...props} />
    </PageTabsCtx.Provider>
  ),
);
Tabs.displayName = TabsPrimitive.Root.displayName;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => {
  const pageCtx = React.useContext(PageTabsCtx);
  const { menuExtended } = usePageTabs();
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
        className,
        // Abas da página ficam no menu lateral quando ele está estendido.
        pageCtx && menuExtended && "hidden",
      )}
      {...props}
    />
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

/** Nome da aba sem os números de aviso: só o texto direto; senão, o texto todo. */
const labelOf = (el: HTMLElement) => {
  const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? "").join(" ").trim();
  return own || (el.textContent ?? "").trim();
};

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, value, ...props }, ref) => {
  const pageCtx = React.useContext(PageTabsCtx);
  const local = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    if (!pageCtx || !local.current) return;
    return pageCtx.register(value, labelOf(local.current));
  }, [pageCtx, value]);
  return (
    <TabsPrimitive.Trigger
      ref={(el) => {
        local.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      value={value}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow",
        className,
      )}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
