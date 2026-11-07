import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useOtpGate } from "@/components/otp-gate";
import { errorText } from "@/lib/domain";
import { useWorkspace } from "@/hooks/use-data";

/**
 * Data access for the inventory and procurement screens. These endpoints are newer than the generated OpenAPI client, so they use
 * the shared fetch wrapper directly (same cookies, errors and OTP header handling as the generated hooks).
 */
export function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  return customFetch<T>(`/api${path}`, {
    method: init?.method ?? "GET",
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body), headers: { "content-type": "application/json" } } : {}),
  });
}

export function useOps<T>(key: unknown[], path: string, enabled = true) {
  return useQuery({ queryKey: ["ops", ...key], queryFn: () => api<T>(path), enabled, staleTime: 15_000, refetchOnWindowFocus: true });
}

/**
 * Runs a write, shows the result as a toast, refreshes the listed queries and, when the server asks for a confirmation code (428),
 * opens the OTP dialog and repeats the same call once the code is verified. Render `dialog` once in the page.
 */
export function useAct() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const otp = useOtpGate();
  const run = useCallback((fn: () => Promise<unknown>, opts: { success: string; refresh?: string[]; onDone?: () => void }) => {
    const attempt = (): void => {
      fn().then(() => {
        toast({ title: opts.success });
        for (const k of opts.refresh ?? []) void qc.invalidateQueries({ queryKey: ["ops", k] });
        opts.onDone?.();
      }).catch((e: unknown) => { if (!otp.handle(e, attempt)) toast({ title: "تعذر إتمام العملية", description: errorText(e), variant: "destructive" }); });
    };
    attempt();
  }, [qc, toast, otp]);
  return { run, dialog: otp.dialog };
}

export const STOCK_WRITERS = ["super_admin", "branch_manager", "warehouse_keeper"];
export const BUYERS = ["super_admin", "procurement_officer"];
export const APPROVERS = ["super_admin", "branch_manager", "procurement_officer"];   // procurement officers can approve only as an approved delegate; the server decides
export const REQUESTERS = ["super_admin", "branch_manager", "warehouse_keeper", "procurement_officer"];

export function useRole() {
  const ws = useWorkspace();
  const role = ws.data?.role ?? "";
  return { role, isLoading: ws.isLoading, canWriteStock: STOCK_WRITERS.includes(role), canBuy: BUYERS.includes(role), canApprove: APPROVERS.includes(role), canRequest: REQUESTERS.includes(role), isAdmin: role === "super_admin" };
}

export const toHalalas = (sar: string | number) => Math.round(Number(sar) * 100);
export const fromHalalas = (h: number) => h / 100;

// ---- response shapes (only the fields the screens use) ----
export type Catalogue = {
  categories: { id: number; code: string; name: string }[];
  units: { id: number; code: string; name: string }[];
  items: { id: number; itemCode: string; name: string; itemType: string; unitId: number; categoryId: number }[];
  warehouses: { id: number; branchId: number; code: string; name: string }[];
  rooms: { id: number; branchId: number; name: string }[];
  branches: { id: number; name: string }[];
};
export type Balance = { item_id: number; item_code: string; name: string; unit: string; qty_on_hand: number; min_qty: number | null; max_qty: number | null; reorder_qty: number | null; needs_reorder: boolean };
export type Alert = { id: number; warehouse_id: number; warehouse: string; item_id: number; item_code: string; item_name: string; qty_at_trigger: number; min_qty: number; status: string; opened_at: string; branch_id: number };
export type Consumption = { month: string; room: string | null; item_code: string; item_name: string; qty_issued: number; indicative_cost_halalas: number };
export type Note = { id: number; title: string; body: string | null; createdAt: string; readAt: string | null };
export type Supplier = { id: number; supplierNo: string; legalName: string; vatNumber: string | null; status: string; city: string | null };
export type PurchaseRequest = { id: number; pr_no: string; status: string; reason: string | null; created_at: string; branch: string; warehouse: string; line_count: number; rfq_id: number | null; branch_id: number };
export type PurchaseOrder = { id: number; po_no: string; status: string; issue_date: string; net_halalas: number; vat_halalas: number; gross_halalas: number; supplier: string; via_delegation: boolean; branch_id: number };
export type Comparison = {
  rfq: { id: number; rfqNo: string; status: string; deadlineAt: string; prId: number }; branchId: number; minQuotes: number;
  invited: { id: number; legal_name: string }[];
  quotations: { quotation_id: number; supplier_id: number; legal_name: string; supplier_no: string; delivery_days: number | null; net_halalas: number; vat_halalas: number; technical: number | null; quality: number | null; commercial: number | null; isLowest: boolean }[];
  award: { quotationId: number; isLowestPrice: boolean; justification: string | null; approvedBy: number | null } | null;
};
export type PrDetail = { request: { id: number; prNo: string; status: string; branchId: number; warehouseId: number }; lines: { item_id: number; item_code: string; name: string; unit: string; qty: number }[]; rfq: { id: number } | null };

export const PR_STATUS: Record<string, string> = { draft: "مسودة", submitted: "مقدَّم", rfq: "طلب عروض", awarded: "تمت الترسية", po_issued: "صدر أمر الشراء", closed: "مغلق", cancelled: "ملغى" };
export const PO_STATUS: Record<string, string> = { draft: "مسودة", prepared: "بانتظار الاعتماد", approved: "معتمد", sent: "مُرسَل", acknowledged: "أكّده المورد", partially_received: "استلام جزئي", received: "مستلم", closed: "مغلق", cancelled: "ملغى" };
export const SUPPLIER_STATUS: Record<string, string> = { pending: "بانتظار الاعتماد", approved: "معتمد", suspended: "موقوف", blocked: "محظور" };

export type OrderLine = { id: number; line_no: number; item_id: number; item_code: string; name: string; unit: string; qty: number; unit_price_halalas: number; vat_rate: number; net_halalas: number; vat_halalas: number; received: number; invoiced: number };
export type InvoiceRow = { id: number; supplier_invoice_no: string; status: string; invoice_date: string; net_halalas: number; vat_halalas: number; gross_halalas: number; paid_halalas: number; match_result?: { lines?: { ok: boolean; reasons: string[] }[] } | null; supplier?: string; po_no?: string | null };
export type OrderDetail = { po: { id: number; poNo: string; status: string; supplierId: number; netHalalas: number; vatHalalas: number; grossHalalas: number; branchId: number }; lines: OrderLine[]; receipts: { id: number; grn_no: string; received_at: string; delivery_note_no: string | null }[]; invoices: InvoiceRow[] };
export const INVOICE_STATUS: Record<string, string> = { received: "مستلمة", matched: "مطابقة", mismatch: "بفروقات", approved: "معتمدة", paid: "مسدّدة", disputed: "متنازع عليها" };
export const INVOICE_WRITERS = ["super_admin", "finance", "procurement_officer"];
export const INVOICE_APPROVERS = ["super_admin", "finance", "branch_manager"];
export const PAYERS = ["super_admin", "finance"];
