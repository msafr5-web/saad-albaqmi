import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetWorkspace,
  useListRecords,
  useGetSummary,
  useGetPayroll,
  useGetLedger,
  useGetCostPolicy,
  useSaveCostPolicyDraft,
  useApproveCostPolicy,
  useGetCostReport,
  getGetCostPolicyQueryKey,
  getGetCostReportQueryKey,
  getGetPayrollQueryKey,
  getGetLedgerQueryKey,
  useCreateRecord,
  useUpdateRecord,
  useDeleteRecord,
  getGetWorkspaceQueryKey,
  getListRecordsQueryKey,
  getGetSummaryQueryKey,
  type EducationRecord,
} from "@workspace/api-client-react";
import type { Kind } from "@/lib/domain";

const q = { staleTime: 30_000, refetchOnWindowFocus: true } as const;

export function useWorkspace() {
  return useGetWorkspace({ query: { ...q, staleTime: 60_000, queryKey: getGetWorkspaceQueryKey() } });
}
export function useRecords() {
  return useListRecords({ query: { ...q, queryKey: getListRecordsQueryKey() } });
}
export function useSummary() {
  return useGetSummary({ query: { ...q, queryKey: getGetSummaryQueryKey() } });
}

export function usePayroll(from: string, to: string) {
  const params = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
  return useGetPayroll(params, { query: { ...q, queryKey: getGetPayrollQueryKey(params) } });
}
export function useLedger() {
  return useGetLedger({ query: { ...q, queryKey: getGetLedgerQueryKey() } });
}

export function useCostPolicy() {
  return useGetCostPolicy({ query: { ...q, queryKey: getGetCostPolicyQueryKey() } });
}
export function useCostReport(from: string, to: string) {
  const params = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
  return useGetCostReport(params, { query: { ...q, queryKey: getGetCostReportQueryKey(params) } });
}
export function useCostPolicyMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: getGetCostPolicyQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCostReportQueryKey() });
  };
  return { save: useSaveCostPolicyDraft({ mutation: { onSuccess: refresh } }), approve: useApproveCostPolicy({ mutation: { onSuccess: refresh } }) };
}

export function useRecordIndex(records: EducationRecord[] | undefined) {
  return useMemo(() => {
    const byId = new Map<number, EducationRecord>();
    const byKind: Partial<Record<Kind, EducationRecord[]>> = {};
    for (const r of records ?? []) {
      byId.set(r.id, r);
      (byKind[r.kind] ??= []).push(r);
    }
    const of = (k: Kind) => byKind[k] ?? [];
    const nameOf = (id: unknown) => {
      const n = Number(id);
      return n ? byId.get(n)?.name ?? `#${n}` : "—";
    };
    return { byId, of, nameOf };
  }, [records]);
}

export function useRecordMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: getListRecordsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetSummaryQueryKey() });
    qc.invalidateQueries({ queryKey: getGetPayrollQueryKey() });
    qc.invalidateQueries({ queryKey: getGetLedgerQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCostReportQueryKey() });
  };
  const create = useCreateRecord({ mutation: { onSuccess: refresh } });
  const update = useUpdateRecord({ mutation: { onSuccess: refresh } });
  const remove = useDeleteRecord({ mutation: { onSuccess: refresh } });
  return { create, update, remove };
}

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} | صرح د. سعد البقمي التعليمي` : "صرح د. سعد البقمي التعليمي";
  }, [title]);
}

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function useInstallPrompt() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(
    typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches,
  );
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BIPEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setEvt(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  const install = async () => {
    if (!evt) return false;
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    setEvt(null);
    return outcome === "accepted";
  };
  return { canPrompt: !!evt, installed, install };
}
