-- Rules a CHECK or FOREIGN KEY cannot express: cross-table integrity, immutability, exclusion constraints, hash chain,
-- reporting views and reference data. Applied AFTER the generated table migration.

-- ============================================================================================================
-- 1. Foreign keys that close import cycles between modules
-- ============================================================================================================
ALTER TABLE expenses            ADD CONSTRAINT expenses_supplier_invoice_fk  FOREIGN KEY (supplier_invoice_id) REFERENCES supplier_invoices(id);
--> statement-breakpoint
ALTER TABLE assets              ADD CONSTRAINT assets_supplier_invoice_line_fk FOREIGN KEY (source_supplier_invoice_line_id) REFERENCES supplier_invoice_lines(id);
--> statement-breakpoint
ALTER TABLE reorder_alerts      ADD CONSTRAINT reorder_alerts_pr_fk          FOREIGN KEY (purchase_request_id) REFERENCES purchase_requests(id);
--> statement-breakpoint
ALTER TABLE purchase_orders     ADD CONSTRAINT purchase_orders_delegation_fk FOREIGN KEY (approved_via_delegation_id) REFERENCES approval_delegations(id);
--> statement-breakpoint

-- ============================================================================================================
-- 2. Exclusion constraints: no double booking, no overlapping leave/delegation
-- ============================================================================================================
ALTER TABLE class_sessions ADD CONSTRAINT class_sessions_no_room_overlap
  EXCLUDE USING gist (room_id WITH =, tsrange(session_date + start_time, session_date + end_time) WITH &&) WHERE (status <> 'cancelled');
--> statement-breakpoint
ALTER TABLE class_sessions ADD CONSTRAINT class_sessions_no_instructor_overlap
  EXCLUDE USING gist (instructor_id WITH =, tsrange(session_date + start_time, session_date + end_time) WITH &&) WHERE (status <> 'cancelled');
--> statement-breakpoint
ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_no_overlap
  EXCLUDE USING gist (employee_id WITH =, daterange(start_date, end_date, '[]') WITH &&) WHERE (status IN ('pending','approved'));
--> statement-breakpoint
ALTER TABLE approval_delegations ADD CONSTRAINT approval_delegations_no_overlap
  EXCLUDE USING gist (delegator_member_id WITH =, scope WITH =, daterange(valid_from, valid_to, '[]') WITH &&) WHERE (status IN ('proposed','approved'));
--> statement-breakpoint

-- ============================================================================================================
-- 3. updated_at maintenance on every table that has the column
-- ============================================================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'updated_at' AND table_name NOT IN ('education_records','education_audit','org_members')
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', 'trg_' || r.table_name || '_updated_at', r.table_name);
  END LOOP;
END
$$;
--> statement-breakpoint

-- ============================================================================================================
-- 4. Append-only ledgers
-- ============================================================================================================
CREATE TRIGGER trg_stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER trg_audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER trg_audit_events_no_truncate BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER trg_stock_movements_no_truncate BEFORE TRUNCATE ON stock_movements FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

-- ============================================================================================================
-- 5. Audit hash chain: every row stores the hash of the previous row; verify_audit_chain() finds the first break.
-- ============================================================================================================
CREATE OR REPLACE FUNCTION audit_row_hash(e audit_events) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT encode(digest(concat_ws('|', coalesce(e.prev_hash, ''), e.occurred_at::text, coalesce(e.actor_member_id::text, ''),
         e.action, e.subject_type, coalesce(e.subject_id::text, ''), coalesce(e.subject_no, ''), e.result,
         coalesce(e.before_state::text, ''), coalesce(e.after_state::text, ''), coalesce(e.reason, ''),
         coalesce(e.otp_challenge_id::text, ''), coalesce(e.otp_sent_at::text, ''), coalesce(e.otp_verified_at::text, ''),
         coalesce(host(e.ip_sent), ''), coalesce(host(e.ip_verified), ''), coalesce(e.content_hash, '')), 'sha256'), 'hex')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_chain_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(7340101);                                  -- serialise appends so the chain has one order
  SELECT row_hash INTO NEW.prev_hash FROM audit_events ORDER BY id DESC LIMIT 1;
  NEW.row_hash := audit_row_hash(NEW);
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER trg_audit_events_chain BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_chain_before_insert();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION verify_audit_chain() RETURNS TABLE (first_bad_id bigint, reason text) LANGUAGE plpgsql STABLE AS $$
DECLARE r audit_events; prev text := NULL; first boolean := true;
BEGIN
  FOR r IN SELECT * FROM audit_events ORDER BY id LOOP
    IF coalesce(r.prev_hash, '') <> coalesce(prev, '') THEN first_bad_id := r.id; reason := 'prev_hash does not match the previous row'; RETURN NEXT; RETURN; END IF;
    IF r.row_hash <> audit_row_hash(r) THEN first_bad_id := r.id; reason := 'row_hash does not match the row content'; RETURN NEXT; RETURN; END IF;
    prev := r.row_hash;
  END LOOP;
END
$$;
--> statement-breakpoint

-- ============================================================================================================
-- 6. Inventory: no negative stock, automatic reorder alerts
-- ============================================================================================================
CREATE OR REPLACE FUNCTION stock_movement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bal numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.warehouse_id::text || ':' || NEW.item_id::text, 0));
  SELECT coalesce(sum(qty_delta), 0) INTO bal FROM stock_movements WHERE warehouse_id = NEW.warehouse_id AND item_id = NEW.item_id;
  IF bal + NEW.qty_delta < 0 THEN
    RAISE EXCEPTION 'insufficient stock: balance % cannot absorb movement %', bal, NEW.qty_delta USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER trg_stock_movements_guard BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION stock_movement_guard();
--> statement-breakpoint

-- Opens ONE alert when the balance reaches the minimum (and closes it again when stock is back above it). The partial
-- unique index reorder_alerts_one_open_uq guarantees a single open alert per item and warehouse.
CREATE OR REPLACE FUNCTION stock_movement_alert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bal numeric; lvl numeric;
BEGIN
  SELECT min_qty INTO lvl FROM stock_levels WHERE warehouse_id = NEW.warehouse_id AND item_id = NEW.item_id;
  IF lvl IS NULL THEN RETURN NEW; END IF;
  SELECT coalesce(sum(qty_delta), 0) INTO bal FROM stock_movements WHERE warehouse_id = NEW.warehouse_id AND item_id = NEW.item_id;
  IF bal <= lvl THEN
    INSERT INTO reorder_alerts (warehouse_id, item_id, qty_at_trigger, min_qty) VALUES (NEW.warehouse_id, NEW.item_id, bal, lvl)
    ON CONFLICT (warehouse_id, item_id) WHERE status IN ('open','in_progress') DO NOTHING;
  ELSE
    UPDATE reorder_alerts SET status = 'closed', closed_at = now()
     WHERE warehouse_id = NEW.warehouse_id AND item_id = NEW.item_id AND status = 'open';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER trg_stock_movements_alert AFTER INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION stock_movement_alert();
--> statement-breakpoint

-- ============================================================================================================
-- 7. Academic integrity
-- ============================================================================================================
CREATE OR REPLACE FUNCTION subject_level_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM levels WHERE id = NEW.level_id AND diploma_id = NEW.diploma_id) THEN
    RAISE EXCEPTION 'level % does not belong to diploma %', NEW.level_id, NEW.diploma_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER trg_subjects_level_guard BEFORE INSERT OR UPDATE OF level_id, diploma_id ON subjects FOR EACH ROW EXECUTE FUNCTION subject_level_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION prerequisite_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s record; p record;
BEGIN
  SELECT sb.diploma_id, l.level_no INTO s FROM subjects sb JOIN levels l ON l.id = sb.level_id WHERE sb.id = NEW.subject_id;
  SELECT sb.diploma_id, l.level_no INTO p FROM subjects sb JOIN levels l ON l.id = sb.level_id WHERE sb.id = NEW.prerequisite_id;
  IF p.diploma_id <> s.diploma_id OR p.level_no >= s.level_no THEN
    RAISE EXCEPTION 'a prerequisite must be in the same diploma and an earlier level' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER trg_subject_prerequisites_guard BEFORE INSERT OR UPDATE ON subject_prerequisites FOR EACH ROW EXECUTE FUNCTION prerequisite_guard();
--> statement-breakpoint

-- Room capacity, same branch/diploma, and a student cannot sit in two overlapping sessions.
CREATE OR REPLACE FUNCTION session_student_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s class_sessions; cap int; cnt int; st students;
BEGIN
  SELECT * INTO s FROM class_sessions WHERE id = NEW.session_id;
  SELECT * INTO st FROM students WHERE id = NEW.student_id;
  IF st.branch_id <> s.branch_id OR st.diploma_id <> s.diploma_id THEN
    RAISE EXCEPTION 'student does not belong to the session branch/diploma' USING ERRCODE = 'check_violation';
  END IF;
  SELECT capacity INTO cap FROM rooms WHERE id = s.room_id;
  SELECT count(*) INTO cnt FROM session_students WHERE session_id = NEW.session_id;
  IF cnt + 1 > cap THEN RAISE EXCEPTION 'room capacity (%) exceeded', cap USING ERRCODE = 'check_violation'; END IF;
  IF EXISTS (SELECT 1 FROM session_students ss JOIN class_sessions o ON o.id = ss.session_id
              WHERE ss.student_id = NEW.student_id AND o.id <> s.id AND o.status <> 'cancelled' AND s.status <> 'cancelled'
                AND tsrange(o.session_date + o.start_time, o.session_date + o.end_time) && tsrange(s.session_date + s.start_time, s.session_date + s.end_time)) THEN
    RAISE EXCEPTION 'student already has an overlapping session' USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER trg_session_students_guard BEFORE INSERT ON session_students FOR EACH ROW EXECUTE FUNCTION session_student_guard();
--> statement-breakpoint

-- ============================================================================================================
-- 8. Financial immutability: confirmed money movements never change; corrections are reversal rows.
-- ============================================================================================================
CREATE OR REPLACE FUNCTION confirmed_money_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('confirmed','reversed') THEN RAISE EXCEPTION 'confirmed % rows cannot be deleted; post a reversal instead', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('confirmed','reversed') THEN
    IF to_jsonb(NEW) - 'status' - 'receipt_emailed_at' - 'gross_halalas' IS DISTINCT FROM to_jsonb(OLD) - 'status' - 'receipt_emailed_at' - 'gross_halalas' THEN
      RAISE EXCEPTION 'confirmed % rows are immutable', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NOT (OLD.status = NEW.status OR (OLD.status = 'confirmed' AND NEW.status = 'reversed')) THEN
      RAISE EXCEPTION 'illegal status change % -> %', OLD.status, NEW.status USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER trg_payments_immutable BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION confirmed_money_guard();
--> statement-breakpoint
CREATE TRIGGER trg_expenses_immutable BEFORE UPDATE OR DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION confirmed_money_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION payment_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total bigint; amt bigint; inst_total bigint; inst_paid bigint; same_student boolean;
BEGIN
  SELECT amount_halalas INTO amt FROM payments WHERE id = NEW.payment_id;
  SELECT coalesce(sum(amount_halalas), 0) INTO total FROM payment_allocations WHERE payment_id = NEW.payment_id;
  IF total + NEW.amount_halalas > amt THEN RAISE EXCEPTION 'allocations exceed the payment amount' USING ERRCODE = 'check_violation'; END IF;
  SELECT amount_halalas INTO inst_total FROM installments WHERE id = NEW.installment_id;
  SELECT coalesce(sum(amount_halalas), 0) INTO inst_paid FROM payment_allocations WHERE installment_id = NEW.installment_id;
  IF inst_paid + NEW.amount_halalas > inst_total THEN RAISE EXCEPTION 'allocations exceed the installment amount' USING ERRCODE = 'check_violation'; END IF;
  SELECT (p.student_id = i.student_id) INTO same_student FROM payments p, installments i WHERE p.id = NEW.payment_id AND i.id = NEW.installment_id;
  IF NOT same_student THEN RAISE EXCEPTION 'payment and installment belong to different students' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER trg_payment_allocations_guard BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION payment_allocation_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION payroll_lines_lock_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; rid bigint := coalesce(NEW.run_id, OLD.run_id);
BEGIN
  SELECT status INTO st FROM payroll_runs WHERE id = rid;
  IF st <> 'draft' THEN RAISE EXCEPTION 'payroll run is %; its lines are locked', st USING ERRCODE = 'integrity_constraint_violation'; END IF;
  RETURN coalesce(NEW, OLD);
END
$$;
--> statement-breakpoint
CREATE TRIGGER trg_payroll_lines_lock BEFORE INSERT OR UPDATE OR DELETE ON payroll_lines FOR EACH ROW EXECUTE FUNCTION payroll_lines_lock_guard();
--> statement-breakpoint

-- ============================================================================================================
-- 9. Procurement controls
-- ============================================================================================================
-- Only approved suppliers can quote, and the quote must carry the supplier's registered VAT number.
CREATE OR REPLACE FUNCTION quotation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sup suppliers;
BEGIN
  SELECT * INTO sup FROM suppliers WHERE id = NEW.supplier_id;
  IF sup.status <> 'approved' THEN RAISE EXCEPTION 'supplier % is not approved', sup.supplier_no USING ERRCODE = 'check_violation'; END IF;
  IF sup.vat_number IS DISTINCT FROM NEW.supplier_vat_number THEN RAISE EXCEPTION 'quotation VAT number does not match the supplier register' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER trg_quotations_guard BEFORE INSERT ON quotations FOR EACH ROW EXECUTE FUNCTION quotation_guard();
--> statement-breakpoint

-- Award: three submitted quotes from three different suppliers unless an approved exception exists; the "lowest price"
-- flag must be truthful; a justification is already enforced by rfq_awards_justification_ck.
CREATE OR REPLACE FUNCTION rfq_award_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n int; lowest bigint; chosen bigint; q quotations; ex procurement_exceptions; req int;
BEGIN
  SELECT * INTO q FROM quotations WHERE id = NEW.quotation_id;
  IF q.rfq_id <> NEW.rfq_id THEN RAISE EXCEPTION 'quotation does not belong to this RFQ' USING ERRCODE = 'check_violation'; END IF;
  SELECT coalesce((SELECT value::int FROM org_settings WHERE key = 'procurement.min_quotes'), 3) INTO req;
  SELECT count(DISTINCT supplier_id) INTO n FROM quotations WHERE rfq_id = NEW.rfq_id AND status = 'submitted';
  IF n < req THEN
    SELECT * INTO ex FROM procurement_exceptions WHERE id = NEW.exception_id;
    IF NEW.exception_id IS NULL OR ex.approved_by IS NULL OR ex.exception_type NOT IN ('single_source','late_responses','emergency') THEN
      RAISE EXCEPTION 'at least % quotations from different suppliers are required (found %)', req, n USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  SELECT min(t) , max(CASE WHEN qid = NEW.quotation_id THEN t END) INTO lowest, chosen
    FROM (SELECT ql.quotation_id AS qid, sum(ql.net_halalas) AS t FROM quotation_lines ql JOIN quotations qq ON qq.id = ql.quotation_id
           WHERE qq.rfq_id = NEW.rfq_id AND qq.status = 'submitted' GROUP BY ql.quotation_id) s;
  IF NEW.is_lowest_price AND chosen IS DISTINCT FROM lowest THEN
    RAISE EXCEPTION 'is_lowest_price is true but the selected quotation is not the cheapest' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER trg_rfq_awards_guard BEFORE INSERT ON rfq_awards FOR EACH ROW EXECUTE FUNCTION rfq_award_guard();
--> statement-breakpoint

-- A purchase order needs: an approved award (standard path) or an approved exception (direct_small / exceptions),
-- the awarded supplier, matching VAT snapshot, and an approved supplier.
CREATE OR REPLACE FUNCTION purchase_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pr purchase_requests; aw rfq_awards; qt quotations; ex procurement_exceptions; sup suppliers;
BEGIN
  SELECT * INTO pr FROM purchase_requests WHERE id = NEW.pr_id;
  SELECT * INTO sup FROM suppliers WHERE id = NEW.supplier_id;
  IF sup.status <> 'approved' OR sup.vat_number IS DISTINCT FROM NEW.supplier_vat_number THEN
    RAISE EXCEPTION 'purchase orders require an approved supplier with a matching VAT number' USING ERRCODE = 'check_violation';
  END IF;
  IF pr.path = 'standard' AND NEW.rfq_id IS NOT NULL THEN
    SELECT * INTO aw FROM rfq_awards WHERE rfq_id = NEW.rfq_id;
    IF aw.rfq_id IS NULL OR aw.approved_by IS NULL THEN RAISE EXCEPTION 'the RFQ award has not been approved' USING ERRCODE = 'check_violation'; END IF;
    SELECT * INTO qt FROM quotations WHERE id = aw.quotation_id;
    IF qt.supplier_id <> NEW.supplier_id THEN RAISE EXCEPTION 'purchase order supplier differs from the awarded supplier' USING ERRCODE = 'check_violation'; END IF;
  ELSE
    SELECT * INTO ex FROM procurement_exceptions WHERE id = NEW.exception_id;
    IF ex.id IS NULL OR ex.approved_by IS NULL OR ex.pr_id <> NEW.pr_id THEN
      RAISE EXCEPTION 'purchase order needs an approved exception for this request' USING ERRCODE = 'check_violation';
    END IF;
    IF pr.path = 'direct_small' AND ex.exception_type <> 'direct_small' THEN RAISE EXCEPTION 'direct purchases require a direct_small approval' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER trg_purchase_orders_guard BEFORE INSERT ON purchase_orders FOR EACH ROW EXECUTE FUNCTION purchase_order_guard();
--> statement-breakpoint

-- After the preparer confirms (status leaves 'draft'), commercial fields and lines are frozen. Changes need a new version.
-- Generated columns (gross_halalas) are excluded from the comparison: they are not yet recomputed inside BEFORE triggers.
CREATE OR REPLACE FUNCTION purchase_order_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    IF (to_jsonb(NEW) - 'status' - 'approved_by' - 'approved_at' - 'approved_via_delegation_id' - 'sent_at' - 'acknowledged_at' - 'document_hash' - 'updated_at' - 'prepared_at' - 'gross_halalas')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'status' - 'approved_by' - 'approved_at' - 'approved_via_delegation_id' - 'sent_at' - 'acknowledged_at' - 'document_hash' - 'updated_at' - 'prepared_at' - 'gross_halalas') THEN
      RAISE EXCEPTION 'purchase order % is frozen; create a new version instead', OLD.po_no USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER trg_purchase_orders_freeze BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION purchase_order_freeze();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION purchase_order_lines_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; pid bigint := coalesce(NEW.po_id, OLD.po_id);
BEGIN
  SELECT status INTO st FROM purchase_orders WHERE id = pid;
  IF st <> 'draft' THEN RAISE EXCEPTION 'purchase order lines are frozen once the order is %', st USING ERRCODE = 'integrity_constraint_violation'; END IF;
  RETURN coalesce(NEW, OLD);
END
$$;
--> statement-breakpoint
CREATE TRIGGER trg_purchase_order_lines_freeze BEFORE INSERT OR UPDATE OR DELETE ON purchase_order_lines FOR EACH ROW EXECUTE FUNCTION purchase_order_lines_freeze();
--> statement-breakpoint

-- Goods may not be accepted beyond the ordered quantity (cumulative across receipts).
CREATE OR REPLACE FUNCTION goods_receipt_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ordered numeric; got numeric;
BEGIN
  SELECT quantity INTO ordered FROM purchase_order_lines WHERE id = NEW.po_line_id;
  SELECT coalesce(sum(qty_accepted), 0) INTO got FROM goods_receipt_lines WHERE po_line_id = NEW.po_line_id AND id IS DISTINCT FROM NEW.id;
  IF got + NEW.qty_accepted > ordered THEN RAISE EXCEPTION 'accepted quantity exceeds the ordered quantity' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER trg_goods_receipt_lines_guard BEFORE INSERT OR UPDATE ON goods_receipt_lines FOR EACH ROW EXECUTE FUNCTION goods_receipt_line_guard();
--> statement-breakpoint

-- ============================================================================================================
-- 10. Reporting views
-- ============================================================================================================
CREATE VIEW v_stock_balances AS
  SELECT warehouse_id, item_id, sum(qty_delta) AS qty_on_hand, max(occurred_at) AS last_movement_at
    FROM stock_movements GROUP BY warehouse_id, item_id;
--> statement-breakpoint
CREATE VIEW v_reorder_status AS
  SELECT sl.warehouse_id, sl.item_id, i.item_code, i.name AS item_name, coalesce(b.qty_on_hand, 0) AS qty_on_hand, sl.min_qty, sl.reorder_qty,
         coalesce(b.qty_on_hand, 0) <= sl.min_qty AS needs_reorder,
         EXISTS (SELECT 1 FROM reorder_alerts a WHERE a.warehouse_id = sl.warehouse_id AND a.item_id = sl.item_id AND a.status IN ('open','in_progress')) AS has_open_alert
    FROM stock_levels sl JOIN items i ON i.id = sl.item_id
    LEFT JOIN v_stock_balances b ON b.warehouse_id = sl.warehouse_id AND b.item_id = sl.item_id;
--> statement-breakpoint
CREATE VIEW v_consumption_monthly AS
  SELECT w.branch_id, m.issued_to_room_id AS room_id, m.issued_to_department_id AS department_id, m.item_id,
         date_trunc('month', m.occurred_at)::date AS month, sum(-m.qty_delta) AS qty_issued,
         sum(-m.qty_delta * coalesce(m.unit_cost_halalas, 0))::bigint AS indicative_cost_halalas
    FROM stock_movements m JOIN warehouses w ON w.id = m.warehouse_id
   WHERE m.movement_type = 'issue'
   GROUP BY w.branch_id, m.issued_to_room_id, m.issued_to_department_id, m.item_id, date_trunc('month', m.occurred_at);
--> statement-breakpoint
CREATE VIEW v_student_ledger AS
  SELECT s.id AS student_id, s.student_no, s.full_name, s.branch_id,
         coalesce((SELECT sum(amount_halalas) FROM installments i WHERE i.student_id = s.id AND i.status <> 'cancelled'), 0) AS planned_halalas,
         coalesce((SELECT sum(amount_halalas) FROM payments p WHERE p.student_id = s.id AND p.status = 'confirmed' AND p.reverses_payment_id IS NULL), 0) AS paid_halalas,
         coalesce((SELECT sum(amount_halalas) FROM installments i WHERE i.student_id = s.id AND i.status IN ('pending','partial') AND i.due_date < current_date), 0) AS overdue_candidate_halalas
    FROM students s;
--> statement-breakpoint
CREATE VIEW v_branch_budget_status AS
  SELECT b.branch_id, b.period_month, b.category_id, b.amount_halalas AS budget_halalas,
         coalesce((SELECT sum(e.net_halalas) FROM expenses e
                    WHERE e.branch_id = b.branch_id AND e.status = 'confirmed' AND e.reverses_expense_id IS NULL
                      AND date_trunc('month', e.expense_date) = b.period_month
                      AND (b.category_id IS NULL OR e.category_id = b.category_id)), 0) AS actual_halalas,
         CASE WHEN b.category_id IS NULL THEN coalesce((SELECT sum(po.net_halalas) FROM purchase_orders po
                    WHERE po.branch_id = b.branch_id AND date_trunc('month', po.issue_date) = b.period_month
                      AND po.status IN ('approved','sent','acknowledged','partially_received','received')
                      AND NOT EXISTS (SELECT 1 FROM supplier_invoices si WHERE si.po_id = po.id AND si.status IN ('approved','paid'))), 0) ELSE 0 END AS committed_halalas,
         b.warn_at_percent
    FROM branch_budgets b;
--> statement-breakpoint
CREATE VIEW v_purchase_period_usage AS
  SELECT po.branch_id, 'weekly'::text AS period, date_trunc('week', po.issue_date)::date AS period_start, sum(po.net_halalas)::bigint AS ordered_halalas
    FROM purchase_orders po WHERE po.status NOT IN ('draft','cancelled') GROUP BY po.branch_id, date_trunc('week', po.issue_date)
  UNION ALL
  SELECT po.branch_id, 'monthly', date_trunc('month', po.issue_date)::date, sum(po.net_halalas)::bigint
    FROM purchase_orders po WHERE po.status NOT IN ('draft','cancelled') GROUP BY po.branch_id, date_trunc('month', po.issue_date);
--> statement-breakpoint
-- VAT display reports (trial period): output VAT on issued sales invoices, input VAT on approved/paid supplier invoices.
CREATE VIEW v_vat_sales AS
  SELECT branch_id, date_trunc('month', issue_date)::date AS month, count(*) AS invoices, sum(net_halalas)::bigint AS net_halalas, sum(vat_halalas)::bigint AS vat_halalas, sum(gross_halalas)::bigint AS gross_halalas
    FROM sales_invoices WHERE status = 'issued' GROUP BY branch_id, date_trunc('month', issue_date);
--> statement-breakpoint
CREATE VIEW v_vat_purchases AS
  SELECT branch_id, date_trunc('month', invoice_date)::date AS month, count(*) AS invoices, sum(net_halalas)::bigint AS net_halalas, sum(vat_halalas)::bigint AS vat_halalas, sum(gross_halalas)::bigint AS gross_halalas
    FROM supplier_invoices WHERE status IN ('approved','paid') GROUP BY branch_id, date_trunc('month', invoice_date);
--> statement-breakpoint
CREATE VIEW v_audit_workflow AS
  SELECT a.id, a.occurred_at, a.action, a.subject_type, a.subject_no, a.actor_member_id, a.actor_role, a.branch_id, a.result,
         a.otp_sent_at, a.otp_verified_at, extract(epoch FROM (a.otp_verified_at - a.otp_sent_at))::int AS seconds_to_confirm,
         a.ip_sent, a.ip_verified, a.reason
    FROM audit_events a;
--> statement-breakpoint

-- ============================================================================================================
-- 11. Reference data (idempotent)
-- ============================================================================================================
INSERT INTO tax_rates (code, name, rate, category, valid_from) VALUES
  ('VAT15', 'ضريبة القيمة المضافة 15%', 15, 'standard', '2020-07-01'),
  ('VAT0',  'نسبة صفرية', 0, 'zero_rated', '2018-01-01'),
  ('VATEX', 'معفى', 0, 'exempt', '2018-01-01')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO units (code, name) VALUES ('PCS','قطعة'),('BOX','علبة'),('CARTON','كرتون'),('PACK','رزمة'),('REAM','رزمة ورق'),('LITER','لتر'),('KG','كيلوجرام'),('SET','طقم'),('HOUR','ساعة')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO expense_categories (code, name, is_petty) VALUES
  ('SALARY','رواتب',false),('RENT','إيجار',false),('UTILITY','مرافق',false),('MAINT','صيانة عامة',false),('AC_MAINT','صيانة المكيفات',false),
  ('SECURITY','خدمات أمنية',false),('CLEANING','خدمات نظافة',false),('EQUIP','تجهيزات',false),('MARKETING','تسويق',false),
  ('PAPER','ورقيات',true),('LIGHTING','لمبات وإضاءة',true),('STATIONERY','قرطاسية',true),('CLEAN_SUPPLIES','مستلزمات نظافة',true),('OTHER','أخرى',false)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO item_categories (code, name) VALUES
  ('LAB','مستهلكات المعامل'),('STAT','قرطاسية'),('BOOK','كتب وملازم'),('MAINT','صيانة وتكييف'),('CLEAN','نظافة'),('IT','أجهزة وتجهيزات'),('OTHER','أخرى')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO leave_types (code, name, is_paid, annual_days) VALUES
  ('ANNUAL','إجازة سنوية',true,30),('SICK','إجازة مرضية',true,NULL),('UNPAID','إجازة بدون راتب',false,NULL),
  ('EMERGENCY','إجازة اضطرارية',true,NULL),('HAJJ','إجازة حج',true,NULL),('MARRIAGE','إجازة زواج',true,5)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO match_tolerances (category_id, price_percent, qty_percent, valid_from) VALUES (NULL, 0, 0, '2026-01-01')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO org_settings (key, value, description) VALUES
  ('vat.default_rate','15','نسبة ضريبة القيمة المضافة الافتراضية'),
  ('vat.mode','display_only','فترة التجربة: عرض الضريبة دون ربط مع منصة فاتورة'),
  ('otp.ttl_seconds','300','مدة صلاحية رمز التأكيد'),
  ('otp.max_attempts','5','عدد محاولات إدخال الرمز'),
  ('otp.resend_cooldown_seconds','60','الفاصل بين إعادة الإرسال'),
  ('procurement.min_quotes','3','الحد الأدنى لعروض الأسعار لكل طلب (ثابت لكل المبالغ)'),
  ('procurement.escalation_hours','24','مهلة تصعيد الاعتماد إلى الإدارة الرئيسية'),
  ('budget.period','monthly','دورة الميزانية')
ON CONFLICT DO NOTHING;
