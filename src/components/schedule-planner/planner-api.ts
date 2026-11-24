import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { Tables } from "@/integrations/supabase/types";
import type { PendingOccurrence } from "@/lib/rdo";
import type { Lodging } from "@/lib/lodging";
import type { Collaborator, ScheduleContext } from "@/lib/scheduling";
import type { DragPayload } from "@/components/schedule-planner/boxes";

export type PlannerRow = Tables<"daily_allocations">;
export type PlannerEntry = Tables<"daily_status_entries">;
export type PlannerWork = ScheduleContext["works"][number];
export type PlannerGroup = { key: string; works: PlannerWork[]; rep: PlannerWork; label: string };

type Mut<T> = { mutate: (v: T) => void; isPending: boolean };

/**
 * Leituras e ações da Programação usadas pelos quadros (WorkBox/StatusBox). O quadro recebe a referência
 * (sempre a versão atual) e redesenha pelo `version`, para o memo não desenhar todos a cada arrastar.
 */
export type PlannerApi = {
  date: string;
  rows: PlannerRow[];
  allocById: Map<string, PlannerRow>;
  occByKey: Map<string, PendingOccurrence>;
  ctx: ScheduleContext | undefined;
  pendingOcc: PendingOccurrence[];
  nightToday: Set<string>;
  nightCarry: Map<string, string[]> | undefined;
  rdoOrigin: Map<string, string[]> | undefined;
  personById: Map<string, Collaborator>;
  positionById: Map<string, string>;
  allocByCollaborator: Map<string, PlannerRow>;
  canClassify: boolean;
  setSelectedWork: Dispatch<SetStateAction<string | null>>;
  setHoverWork: Dispatch<SetStateAction<string | null>>;
  setHoverBox: Dispatch<SetStateAction<string | null>>;
  setDragging: Dispatch<SetStateAction<DragPayload | null>>;
  setEditingBox: Dispatch<SetStateAction<string | null>>;
  setOpenEntry: Dispatch<SetStateAction<string | null>>;
  setOccOpen: (o: PendingOccurrence) => void;
  setClearBox: (v: { label: string; ids: string[] }) => void;
  readPayload: (e: React.DragEvent) => DragPayload | null;
  startDrag: (e: React.DragEvent, payload: DragPayload) => void;
  dropOnGroup: (p: DragPayload, g: PlannerGroup) => Promise<void>;
  drop: Mut<DragPayload & { workId: string; beforeSort?: number }>;
  dropBox: Mut<DragPayload & { boxKey: string }>;
  removeRow: Mut<string>;
  clearRows: Mut<string[]>;
  askRemoveEntry: (id: string) => Promise<void>;
  copyWorks: (w: PlannerWork, list: PlannerWork[]) => void;
  copyPeopleCpf: (ids: string[]) => void;
  buildBoxMessage: (boxKey: string, boxLabel: string, names: string[], ids?: string[]) => string;
  noticeTitle: (id: string) => string | undefined;
  noticeClass: (id: string) => string;
  lodgingOf: (id: string) => Lodging | null;
  workPaysVt: (workId: string) => boolean;
  workPaysTravel: (workId: string) => boolean;
  allocVtOn: (workId: string, collaboratorId: string, override: boolean | null | undefined) => boolean;
  defaultAllocTravel: (workId: string, collaboratorId: string) => boolean;
  travelInfo: { off: Set<string> } | undefined;
  setGroupVt: Mut<{ ids: string[]; value: boolean }>;
  setGroupTravel: Mut<{ ids: string[]; value: boolean }>;
  setGroupOvernight: Mut<{ ids: string[]; value: boolean }>;
  toggleAllocVt: Mut<{ id: string; workId: string; collaboratorId: string; current: boolean }>;
  toggleAllocTravel: Mut<{ id: string; workId: string; collaboratorId: string; current: boolean }>;
  toggleOvernight: Mut<{ id: string; current: boolean; travelOff?: boolean | null }>;
  boxPaysVt: (key: string) => boolean;
  toggleBoxVt: Mut<string>;
  saveBoxTitle: Mut<{ key: string; title: string }>;
  travelDot: (key: string, collaboratorId?: string) => ReactNode;
  personBenefits: (key: string, collaboratorId: string) => ReactNode;
};
