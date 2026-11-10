# قاموس بيانات قاعدة `saad_albaqmi`

مولَّد آليًا من القاعدة الحية بواسطة `lib/db/scripts/er.mjs`؛ لا يُعدَّل يدويًا. **90 جدولًا، 202 علاقة (مفتاح أجنبي)، 10 عروضًا، 35 محفّزًا.**

الرموز: **PK** مفتاح أساسي، **FK** مفتاح أجنبي، **UK** فريد. المبالغ بالهللات (`*_halalas`) والكميات `numeric(14,3)`.

## فهرس المجالات

| المجال | الجداول |
|---|---|
| المؤسسة والإعدادات | [`branches`](#branches)، [`document_sequences`](#document_sequences)، [`documents`](#documents)، [`notifications`](#notifications)، [`org_settings`](#org_settings) |
| الموارد البشرية والتفويض | [`approval_delegations`](#approval_delegations)، [`departments`](#departments)، [`employee_shifts`](#employee_shifts)، [`employees`](#employees)، [`job_titles`](#job_titles)، [`leave_requests`](#leave_requests)، [`leave_types`](#leave_types)، [`payroll_lines`](#payroll_lines)، [`payroll_runs`](#payroll_runs)، [`shifts`](#shifts) |
| المرافق والأصول | [`asset_categories`](#asset_categories)، [`asset_maintenance`](#asset_maintenance)، [`assets`](#assets)، [`electricity_meters`](#electricity_meters)، [`rooms`](#rooms) |
| الدبلومات والمناهج | [`diplomas`](#diplomas)، [`levels`](#levels)، [`subject_prerequisites`](#subject_prerequisites)، [`subjects`](#subjects) |
| الطلاب والمدربون | [`instructor_evaluations`](#instructor_evaluations)، [`instructor_subjects`](#instructor_subjects)، [`instructors`](#instructors)، [`student_subjects`](#student_subjects)، [`students`](#students) |
| الجدولة والحضور والدرجات | [`attendance_records`](#attendance_records)، [`class_sessions`](#class_sessions)، [`grades`](#grades)، [`session_recurrences`](#session_recurrences)، [`session_students`](#session_students) |
| المبيعات والتحصيل | [`installments`](#installments)، [`payment_allocations`](#payment_allocations)، [`payments`](#payments)، [`sales_invoice_lines`](#sales_invoice_lines)، [`sales_invoices`](#sales_invoices)، [`tax_rates`](#tax_rates) |
| المصروفات والميزانيات | [`branch_budgets`](#branch_budgets)، [`cost_report_snapshots`](#cost_report_snapshots)، [`expense_categories`](#expense_categories)، [`expenses`](#expenses)، [`utility_invoices`](#utility_invoices) |
| المخزون | [`item_categories`](#item_categories)، [`items`](#items)، [`reorder_alerts`](#reorder_alerts)، [`stock_count_lines`](#stock_count_lines)، [`stock_counts`](#stock_counts)، [`stock_levels`](#stock_levels)، [`stock_movements`](#stock_movements)، [`stock_transfer_lines`](#stock_transfer_lines)، [`stock_transfers`](#stock_transfers)، [`units`](#units)، [`warehouses`](#warehouses) |
| المشتريات: الموردون وعروض الأسعار | [`procurement_exceptions`](#procurement_exceptions)، [`purchase_request_lines`](#purchase_request_lines)، [`purchase_requests`](#purchase_requests)، [`quotation_evaluations`](#quotation_evaluations)، [`quotation_lines`](#quotation_lines)، [`quotations`](#quotations)، [`rfq_awards`](#rfq_awards)، [`rfq_suppliers`](#rfq_suppliers)، [`rfqs`](#rfqs)، [`supplier_categories`](#supplier_categories)، [`suppliers`](#suppliers) |
| المشتريات: الأوامر والاستلام والفواتير | [`direct_purchase_policies`](#direct_purchase_policies)، [`goods_receipt_lines`](#goods_receipt_lines)، [`goods_receipts`](#goods_receipts)، [`match_tolerances`](#match_tolerances)، [`purchase_limits`](#purchase_limits)، [`purchase_order_lines`](#purchase_order_lines)، [`purchase_orders`](#purchase_orders)، [`supplier_invoice_lines`](#supplier_invoice_lines)، [`supplier_invoices`](#supplier_invoices)، [`supplier_payments`](#supplier_payments) |
| الأمان والهوية والحضور | [`audit_events`](#audit_events)، [`identity_cards`](#identity_cards)، [`local_accounts`](#local_accounts)، [`local_sessions`](#local_sessions)، [`login_codes`](#login_codes)، [`otp_challenges`](#otp_challenges)، [`presence_events`](#presence_events) |
| الطلبات والمهام الداخلية | [`internal_request_events`](#internal_request_events)، [`internal_requests`](#internal_requests) |
| الجداول القديمة (JSONB) التي يستخدمها التطبيق حاليًا | [`cost_policies`](#cost_policies)، [`education_audit`](#education_audit)، [`education_records`](#education_records)، [`org_members`](#org_members) |

## المؤسسة والإعدادات

المخطط: `er/org.mmd` (و`er/org.svg` عند التوليد).

### branches

الفروع (المركز الرئيسي والفروع)، ولكل فرع رقم ضريبي وحالة

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `code` | text | لا |  | UK |  |
| `name` | text | لا |  |  |  |
| `city` | text | لا |  |  |  |
| `is_head_office` | bool | لا | `false` |  |  |
| `status` | text | لا | `'active'::text` |  |  |
| `vat_number` | text | نعم |  |  |  |
| `commercial_reg_no` | text | نعم |  |  |  |
| `address` | text | نعم |  |  |  |
| `phone` | text | نعم |  |  |  |
| `email` | text | نعم |  |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |
| `updated_at` | timestamptz | لا | `now()` |  |  |
| `archived_at` | timestamptz | نعم |  |  |  |

**قيود التحقق:**
- `branches_status_ck`: `((status = ANY (ARRAY['active'::text, 'inactive'::text])))`
- `branches_vat_format_ck`: `(((vat_number IS NULL) OR (vat_number ~ '^3[0-9]{13}3$'::text)))`

**الفهارس:**
- `فريد btree (code)`
- `فريد btree (is_head_office) WHERE is_head_office`

**محفّزات:** `trg_branches_updated_at` (BEFORE UPDATE)

### document_sequences

عدادات الترقيم المتسلسل للمستندات (PO-2026-000123) دون فجوات

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `prefix` | text | لا |  |  |  |
| `year` | int | لا |  |  |  |
| `last_value` | bigint | لا | `0` |  |  |

**الفهارس:**
- `فريد btree (prefix, year)`

### documents

سجل المرفقات (عروض أسعار، فواتير، عقود) مع بصمة الملف ومفتاح التخزين

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `owner_type` | text | لا |  |  |  |
| `owner_id` | bigint | لا |  |  |  |
| `file_name` | text | لا |  |  |  |
| `mime_type` | text | لا |  |  |  |
| `size_bytes` | bigint | لا |  |  |  |
| `storage_key` | text | لا |  | UK |  |
| `sha256` | text | لا |  |  |  |
| `uploaded_by` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `created_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `documents_sha256_ck`: `((sha256 ~ '^[0-9a-f]{64}$'::text))`
- `documents_size_ck`: `((size_bytes > 0))`

**الفهارس:**
- `btree (owner_type, owner_id)`
- `فريد btree (storage_key)`

### notifications

صندوق الإشعارات داخل النظام (تنبيهات الحد الأدنى، الميزانية، الاعتماد)

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `member_id` | int | لا |  | FK | `org_members.id` (NO ACTION) |
| `type` | text | لا |  |  |  |
| `title` | text | لا |  |  |  |
| `body` | text | نعم |  |  |  |
| `link` | text | نعم |  |  |  |
| `subject_type` | text | نعم |  |  |  |
| `subject_id` | bigint | نعم |  |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |
| `read_at` | timestamptz | نعم |  |  |  |
| `email_sent_at` | timestamptz | نعم |  |  |  |

**الفهارس:**
- `btree (member_id, created_at) WHERE (read_at IS NULL)`

### org_settings

إعدادات المؤسسة (نسبة الضريبة، سياسة OTP، عدد العروض المطلوبة...)

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `key` | text | لا |  | PK |  |
| `value` | text | لا |  |  |  |
| `description` | text | نعم |  |  |  |
| `updated_by` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `updated_at` | timestamptz | لا | `now()` |  |  |

**محفّزات:** `trg_org_settings_updated_at` (BEFORE UPDATE)

## الموارد البشرية والتفويض

المخطط: `er/hr.mmd` (و`er/hr.svg` عند التوليد).

### approval_delegations

تفويض الصلاحيات (تقترحه الموارد البشرية ويعتمده المدير العام) بمدة محددة

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `delegator_member_id` | int | لا |  | FK | `org_members.id` (NO ACTION) |
| `delegate_member_id` | int | لا |  | FK | `org_members.id` (NO ACTION) |
| `scope` | text | لا | `'purchase_approval'::text` |  |  |
| `valid_from` | date | لا |  |  |  |
| `valid_to` | date | لا |  |  |  |
| `leave_request_id` | bigint | نعم |  | FK | `leave_requests.id` (NO ACTION) |
| `proposed_by` | int | لا |  | FK | `org_members.id` (NO ACTION) |
| `approved_by` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `approved_at` | timestamptz | نعم |  |  |  |
| `status` | text | لا | `'proposed'::text` |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `approval_delegations_approved_ck`: `(((status <> 'approved'::text) OR ((approved_by IS NOT NULL) AND (approved_by <> proposed_by))))`
- `approval_delegations_dates_ck`: `((valid_to >= valid_from))`
- `approval_delegations_scope_ck`: `((scope = ANY (ARRAY['purchase_approval'::text, 'finance_approval'::text, 'all'::text])))`
- `approval_delegations_self_ck`: `((delegator_member_id <> delegate_member_id))`
- `approval_delegations_status_ck`: `((status = ANY (ARRAY['proposed'::text, 'approved'::text, 'rejected'::text, 'revoked'::text, 'expired'::text])))`

**الفهارس:**
- `btree (delegator_member_id, valid_from)`

### departments

الأقسام الإدارية، عامة أو تابعة لفرع، بتدرج هرمي

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `branch_id` | bigint | نعم |  | FK | `branches.id` (NO ACTION) |
| `parent_id` | bigint | نعم |  | FK | `departments.id` (NO ACTION) |
| `code` | text | لا |  | UK |  |
| `name` | text | لا |  |  |  |
| `manager_employee_id` | bigint | نعم |  | FK | `employees.id` (NO ACTION) |
| `status` | text | لا | `'active'::text` |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |
| `updated_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `departments_parent_ck`: `(((parent_id IS NULL) OR (parent_id <> id)))`
- `departments_status_ck`: `((status = ANY (ARRAY['active'::text, 'inactive'::text])))`

**الفهارس:**
- `btree (branch_id)`
- `فريد btree (code)`

**محفّزات:** `trg_departments_updated_at` (BEFORE UPDATE)

### employee_shifts

إسناد الورديات للموظفين بفترات صلاحية

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `employee_id` | bigint | لا |  | PK,FK | `employees.id` (CASCADE) |
| `shift_id` | bigint | لا |  | FK | `shifts.id` (NO ACTION) |
| `valid_from` | date | لا |  | PK |  |
| `valid_to` | date | نعم |  |  |  |

**مفتاح أساسي مركّب:** (employee_id, valid_from)

**قيود التحقق:**
- `employee_shifts_dates_ck`: `(((valid_to IS NULL) OR (valid_to >= valid_from)))`

### employees

سجل الموظفين: الفرع والقسم والراتب والبيانات الشخصية

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `employee_no` | text | لا |  | UK |  |
| `full_name` | text | لا |  |  |  |
| `branch_id` | bigint | لا |  | FK | `branches.id` (NO ACTION) |
| `department_id` | bigint | نعم |  | FK | `departments.id` (NO ACTION) |
| `job_title_id` | bigint | نعم |  | FK | `job_titles.id` (NO ACTION) |
| `org_member_id` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `national_id` | text | نعم |  |  |  |
| `nationality` | text | نعم |  |  |  |
| `email` | text | نعم |  |  |  |
| `phone` | text | نعم |  |  |  |
| `iban` | text | نعم |  |  |  |
| `employment_type` | text | لا | `'full_time'::text` |  |  |
| `hire_date` | date | لا |  |  |  |
| `termination_date` | date | نعم |  |  |  |
| `status` | text | لا | `'active'::text` |  |  |
| `basic_salary_halalas` | bigint | لا | `0` |  |  |
| `housing_allowance_halalas` | bigint | لا | `0` |  |  |
| `transport_allowance_halalas` | bigint | لا | `0` |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |
| `updated_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `employees_dates_ck`: `(((termination_date IS NULL) OR (termination_date >= hire_date)))`
- `employees_iban_ck`: `(((iban IS NULL) OR (iban ~ '^SA[0-9]{22}$'::text)))`
- `employees_salary_ck`: `(((basic_salary_halalas >= 0) AND (housing_allowance_halalas >= 0) AND (transport_allowance_halalas >= 0)))`
- `employees_status_ck`: `((status = ANY (ARRAY['active'::text, 'on_leave'::text, 'suspended'::text, 'terminated'::text])))`
- `employees_type_ck`: `((employment_type = ANY (ARRAY['full_time'::text, 'part_time'::text, 'contract'::text, 'trainee'::text])))`

**الفهارس:**
- `btree (branch_id)`
- `btree (department_id)`
- `فريد btree (org_member_id) WHERE (org_member_id IS NOT NULL)`
- `فريد btree (national_id) WHERE (national_id IS NOT NULL)`
- `فريد btree (employee_no)`

**محفّزات:** `trg_employees_updated_at` (BEFORE UPDATE)

### job_titles

المسميات الوظيفية

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `name` | text | لا |  | UK |  |
| `grade` | text | نعم |  |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |

**الفهارس:**
- `فريد btree (name)`

### leave_requests

طلبات الإجازة؛ يمنع النظام تداخل إجازتين لنفس الموظف

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `employee_id` | bigint | لا |  | FK | `employees.id` (NO ACTION) |
| `leave_type_id` | bigint | لا |  | FK | `leave_types.id` (NO ACTION) |
| `start_date` | date | لا |  |  |  |
| `end_date` | date | لا |  |  |  |
| `status` | text | لا | `'pending'::text` |  |  |
| `reason` | text | نعم |  |  |  |
| `requested_by` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `decided_by` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `decided_at` | timestamptz | نعم |  |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `leave_requests_dates_ck`: `((end_date >= start_date))`
- `leave_requests_status_ck`: `((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])))`

**الفهارس:**
- `btree (employee_id, start_date)`

### leave_types

أنواع الإجازات (سنوية، مرضية، اضطرارية...)

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `code` | text | لا |  | UK |  |
| `name` | text | لا |  |  |  |
| `is_paid` | bool | لا | `true` |  |  |
| `annual_days` | int | نعم |  |  |  |

**الفهارس:**
- `فريد btree (code)`

### payroll_lines

بنود الرواتب لكل موظف؛ تُقفل بعد اعتماد الدورة

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `run_id` | bigint | لا |  | FK | `payroll_runs.id` (CASCADE) |
| `employee_id` | bigint | لا |  | FK | `employees.id` (NO ACTION) |
| `basic_halalas` | bigint | لا |  |  |  |
| `allowances_halalas` | bigint | لا | `0` |  |  |
| `deductions_halalas` | bigint | لا | `0` |  |  |
| `net_halalas` | bigint | نعم | مولَّد: `((basic_halalas + allowances_halalas) - deductions_halalas)` |  |  |
| `days_worked` | numeric(5,2) | نعم |  |  |  |

**قيود التحقق:**
- `payroll_lines_amounts_ck`: `(((basic_halalas >= 0) AND (allowances_halalas >= 0) AND (deductions_halalas >= 0)))`

**الفهارس:**
- `فريد btree (run_id, employee_id)`

**محفّزات:** `trg_payroll_lines_lock` (BEFORE INSERT/UPDATE/DELETE)

### payroll_runs

دورات الرواتب الشهرية لكل فرع (مسودة، معتمدة، مصروفة)

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `branch_id` | bigint | لا |  | FK | `branches.id` (NO ACTION) |
| `period_month` | date | لا |  |  |  |
| `status` | text | لا | `'draft'::text` |  |  |
| `approved_by` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `approved_at` | timestamptz | نعم |  |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `payroll_runs_month_ck`: `((EXTRACT(day FROM period_month) = (1)::numeric))`
- `payroll_runs_status_ck`: `((status = ANY (ARRAY['draft'::text, 'approved'::text, 'paid'::text])))`

**الفهارس:**
- `فريد btree (branch_id, period_month)`

### shifts

ورديات الدوام وفترة السماح

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `name` | text | لا |  | UK |  |
| `start_time` | time | لا |  |  |  |
| `end_time` | time | لا |  |  |  |
| `grace_minutes` | int | لا | `10` |  |  |

**قيود التحقق:**
- `shifts_grace_ck`: `(((grace_minutes >= 0) AND (grace_minutes <= 120)))`

**الفهارس:**
- `فريد btree (name)`

## المرافق والأصول

المخطط: `er/facilities.mmd` (و`er/facilities.svg` عند التوليد).

### asset_categories

تصنيفات الأصول بتدرج هرمي وعمر افتراضي

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `parent_id` | bigint | نعم |  | FK | `asset_categories.id` (NO ACTION) |
| `name` | text | لا |  |  |  |
| `default_useful_life_months` | int | نعم |  |  |  |

**الفهارس:**
- `فريد btree (parent_id, name)`

### asset_maintenance

جدولة الصيانة وسجلها وتكلفتها

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `asset_id` | bigint | لا |  | FK | `assets.id` (CASCADE) |
| `due_date` | date | لا |  |  |  |
| `performed_at` | date | نعم |  |  |  |
| `cost_halalas` | bigint | لا | `0` |  |  |
| `notes` | text | نعم |  |  |  |
| `status` | text | لا | `'scheduled'::text` |  |  |

**قيود التحقق:**
- `asset_maintenance_cost_ck`: `((cost_halalas >= 0))`
- `asset_maintenance_status_ck`: `((status = ANY (ARRAY['scheduled'::text, 'done'::text, 'cancelled'::text])))`

**الفهارس:**
- `btree (due_date) WHERE (status = 'scheduled'::text)`

### assets

الأصول والتجهيزات داخل القاعات: القيمة والشراء والإهلاك والحالة

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `asset_tag` | text | لا |  | UK |  |
| `branch_id` | bigint | لا |  | FK | `branches.id` (NO ACTION) |
| `room_id` | bigint | نعم |  | FK | `rooms.id` (NO ACTION) |
| `category_id` | bigint | نعم |  | FK | `asset_categories.id` (NO ACTION) |
| `name` | text | لا |  |  |  |
| `serial_no` | text | نعم |  |  |  |
| `specifications` | text | نعم |  |  |  |
| `purchase_date` | date | نعم |  |  |  |
| `purchase_cost_halalas` | bigint | لا |  |  |  |
| `salvage_percent` | numeric(6,3) | لا | `0` |  |  |
| `useful_life_months` | int | نعم |  |  |  |
| `source_supplier_invoice_line_id` | bigint | نعم |  | FK | `supplier_invoice_lines.id` (NO ACTION) |
| `status` | text | لا | `'in_service'::text` |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |
| `updated_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `assets_cost_ck`: `((purchase_cost_halalas >= 0))`
- `assets_life_ck`: `(((useful_life_months IS NULL) OR ((useful_life_months >= 1) AND (useful_life_months <= 600))))`
- `assets_salvage_ck`: `(((salvage_percent >= (0)::numeric) AND (salvage_percent <= (100)::numeric)))`
- `assets_status_ck`: `((status = ANY (ARRAY['in_service'::text, 'maintenance'::text, 'retired'::text, 'lost'::text])))`

**الفهارس:**
- `btree (branch_id)`
- `btree (room_id)`
- `فريد btree (asset_tag)`

**محفّزات:** `trg_assets_updated_at` (BEFORE UPDATE)

### electricity_meters

عدادات الكهرباء الرئيسية والفرعية لكل فرع

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `branch_id` | bigint | لا |  | FK | `branches.id` (NO ACTION) |
| `meter_no` | text | لا |  |  |  |
| `description` | text | نعم |  |  |  |
| `is_sub_meter` | bool | لا | `false` |  |  |
| `status` | text | لا | `'active'::text` |  |  |

**قيود التحقق:**
- `electricity_meters_status_ck`: `((status = ANY (ARRAY['active'::text, 'inactive'::text])))`

**الفهارس:**
- `فريد btree (branch_id, meter_no)`

### rooms

القاعات والمعامل: النوع والمساحة والسعة وقدرة الأجهزة والعداد

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `branch_id` | bigint | لا |  | FK | `branches.id` (NO ACTION) |
| `code` | text | لا |  |  |  |
| `name` | text | لا |  |  |  |
| `room_type` | text | لا |  |  |  |
| `area_m2` | numeric(10,2) | لا |  |  |  |
| `capacity` | int | لا |  |  |  |
| `power_kw` | numeric(8,2) | نعم |  |  |  |
| `meter_id` | bigint | نعم |  | FK | `electricity_meters.id` (NO ACTION) |
| `status` | text | لا | `'active'::text` |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |
| `updated_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `rooms_dimensions_ck`: `(((area_m2 > (0)::numeric) AND (capacity > 0) AND ((power_kw IS NULL) OR (power_kw >= (0)::numeric))))`
- `rooms_status_ck`: `((status = ANY (ARRAY['active'::text, 'maintenance'::text, 'inactive'::text])))`
- `rooms_type_ck`: `((room_type = ANY (ARRAY['classroom'::text, 'lab'::text, 'workshop'::text, 'office'::text])))`

**الفهارس:**
- `فريد btree (branch_id, code)`
- `btree (meter_id)`

**محفّزات:** `trg_rooms_updated_at` (BEFORE UPDATE)

## الدبلومات والمناهج

المخطط: `er/curriculum.mmd` (و`er/curriculum.svg` عند التوليد).

### diplomas

الدبلومات: المدة والساعات وشروط القبول والسعر (شامل/غير شامل الضريبة) مع صافٍ وإجمالي مولَّدين

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `code` | text | لا |  | UK |  |
| `name` | text | لا |  |  |  |
| `duration_months` | int | لا |  |  |  |
| `total_hours` | numeric(8,1) | لا |  |  |  |
| `admission_requirements` | text | نعم |  |  |  |
| `price_halalas` | bigint | لا |  |  |  |
| `price_includes_vat` | bool | لا |  |  |  |
| `vat_rate` | numeric(6,3) | لا | `15` |  |  |
| `net_price_halalas` | bigint | نعم | مولَّد: `vat_net(price_halalas, vat_rate, price_includes_vat)` |  |  |
| `gross_price_halalas` | bigint | نعم | مولَّد: `vat_gross(price_halalas, vat_rate, price_includes_vat)` |  |  |
| `status` | text | لا | `'active'::text` |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |
| `updated_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `diplomas_duration_ck`: `(((duration_months > 0) AND (total_hours > (0)::numeric)))`
- `diplomas_price_ck`: `(((price_halalas >= 0) AND ((vat_rate >= (0)::numeric) AND (vat_rate <= (100)::numeric))))`
- `diplomas_status_ck`: `((status = ANY (ARRAY['active'::text, 'closed'::text, 'draft'::text])))`

**الفهارس:**
- `فريد btree (code)`

**محفّزات:** `trg_diplomas_updated_at` (BEFORE UPDATE)

### levels

مستويات كل دبلوم

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `diploma_id` | bigint | لا |  | FK | `diplomas.id` (NO ACTION) |
| `level_no` | int | لا |  |  |  |
| `name` | text | لا |  |  |  |

**قيود التحقق:**
- `levels_no_ck`: `((level_no >= 1))`

**الفهارس:**
- `فريد btree (diploma_id, level_no)`

### subject_prerequisites

المتطلبات السابقة للمواد (مستوى أسبق في الدبلوم نفسه)

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `subject_id` | bigint | لا |  | PK,FK | `subjects.id` (CASCADE) |
| `prerequisite_id` | bigint | لا |  | PK,FK | `subjects.id` (NO ACTION) |

**مفتاح أساسي مركّب:** (subject_id, prerequisite_id)

**قيود التحقق:**
- `subject_prerequisites_self_ck`: `((subject_id <> prerequisite_id))`

**محفّزات:** `trg_subject_prerequisites_guard` (BEFORE INSERT/UPDATE)

### subjects

المواد: المستوى والسعر والساعات

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `code` | text | لا |  | UK |  |
| `diploma_id` | bigint | لا |  | FK | `diplomas.id` (NO ACTION) |
| `level_id` | bigint | لا |  | FK | `levels.id` (NO ACTION) |
| `name` | text | لا |  |  |  |
| `price_halalas` | bigint | لا |  |  |  |
| `price_includes_vat` | bool | لا |  |  |  |
| `vat_rate` | numeric(6,3) | لا | `15` |  |  |
| `net_price_halalas` | bigint | نعم | مولَّد: `vat_net(price_halalas, vat_rate, price_includes_vat)` |  |  |
| `gross_price_halalas` | bigint | نعم | مولَّد: `vat_gross(price_halalas, vat_rate, price_includes_vat)` |  |  |
| `hours` | numeric(6,1) | لا |  |  |  |
| `status` | text | لا | `'active'::text` |  |  |

**قيود التحقق:**
- `subjects_amounts_ck`: `(((price_halalas >= 0) AND (hours >= 0.5) AND ((vat_rate >= (0)::numeric) AND (vat_rate <= (100)::numeric))))`
- `subjects_status_ck`: `((status = ANY (ARRAY['active'::text, 'closed'::text])))`

**الفهارس:**
- `فريد btree (code)`
- `فريد btree (diploma_id, name)`
- `btree (level_id)`

**محفّزات:** `trg_subjects_level_guard` (BEFORE INSERT/UPDATE)

## الطلاب والمدربون

المخطط: `er/people.mmd` (و`er/people.svg` عند التوليد).

### instructor_evaluations

تقييم أداء المدربين (التدريس، الالتزام، آراء الطلاب)

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `instructor_id` | bigint | لا |  | FK | `instructors.id` (NO ACTION) |
| `period_start` | date | لا |  |  |  |
| `period_end` | date | لا |  |  |  |
| `teaching_score` | int | لا |  |  |  |
| `punctuality_score` | int | لا |  |  |  |
| `student_feedback_score` | int | نعم |  |  |  |
| `notes` | text | نعم |  |  |  |
| `evaluated_by` | int | لا |  | FK | `org_members.id` (NO ACTION) |
| `created_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `instructor_evaluations_period_ck`: `((period_end >= period_start))`
- `instructor_evaluations_scores_ck`: `((((teaching_score >= 0) AND (teaching_score <= 100)) AND ((punctuality_score >= 0) AND (punctuality_score <= 100)) AND ((student_feedback_score IS NULL) OR ((student_feedback_score >= 0) AND (student_feedback_score <= 100)))))`

**الفهارس:**
- `btree (instructor_id, period_end)`

### instructor_subjects

المواد التي يقدمها كل مدرب

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `instructor_id` | bigint | لا |  | PK,FK | `instructors.id` (CASCADE) |
| `subject_id` | bigint | لا |  | PK,FK | `subjects.id` (NO ACTION) |

**مفتاح أساسي مركّب:** (instructor_id, subject_id)

### instructors

المدربون: المؤهل وأجر الساعة والساعات الأسبوعية

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `instructor_no` | text | لا |  | UK |  |
| `branch_id` | bigint | لا |  | FK | `branches.id` (NO ACTION) |
| `employee_id` | bigint | نعم |  | FK | `employees.id` (NO ACTION) |
| `full_name` | text | لا |  |  |  |
| `qualification` | text | نعم |  |  |  |
| `hourly_rate_halalas` | bigint | لا |  |  |  |
| `weekly_hours` | numeric(5,1) | لا |  |  |  |
| `org_member_id` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `status` | text | لا | `'active'::text` |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |
| `updated_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `instructors_amounts_ck`: `(((hourly_rate_halalas >= 0) AND ((weekly_hours >= (0)::numeric) AND (weekly_hours <= (168)::numeric))))`
- `instructors_status_ck`: `((status = ANY (ARRAY['active'::text, 'inactive'::text])))`

**الفهارس:**
- `btree (branch_id)`
- `فريد btree (org_member_id) WHERE (org_member_id IS NOT NULL)`
- `فريد btree (instructor_no)`

**محفّزات:** `trg_instructors_updated_at` (BEFORE UPDATE)

### student_subjects

تسجيل الطالب في المواد وحالته فيها

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `student_id` | bigint | لا |  | FK | `students.id` (NO ACTION) |
| `subject_id` | bigint | لا |  | FK | `subjects.id` (NO ACTION) |
| `enrolled_at` | timestamptz | لا | `now()` |  |  |
| `status` | text | لا | `'enrolled'::text` |  |  |

**قيود التحقق:**
- `student_subjects_status_ck`: `((status = ANY (ARRAY['enrolled'::text, 'passed'::text, 'failed'::text, 'withdrawn'::text])))`

**الفهارس:**
- `فريد btree (student_id, subject_id)`

### students

الطلاب: الفرع والدبلوم والمستوى والبيانات الشخصية وحساب البوابة

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `student_no` | text | لا |  | UK |  |
| `branch_id` | bigint | لا |  | FK | `branches.id` (NO ACTION) |
| `diploma_id` | bigint | لا |  | FK | `diplomas.id` (NO ACTION) |
| `current_level_id` | bigint | نعم |  | FK | `levels.id` (NO ACTION) |
| `full_name` | text | لا |  |  |  |
| `national_id` | text | نعم |  |  |  |
| `nationality` | text | نعم |  |  |  |
| `date_of_birth` | date | نعم |  |  |  |
| `email` | text | نعم |  |  |  |
| `phone` | text | نعم |  |  |  |
| `guardian_name` | text | نعم |  |  |  |
| `guardian_phone` | text | نعم |  |  |  |
| `org_member_id` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `status` | text | لا | `'enrolled'::text` |  |  |
| `enrolled_at` | date | لا | `CURRENT_DATE` |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |
| `updated_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `students_email_ck`: `(((email IS NULL) OR (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'::text)))`
- `students_status_ck`: `((status = ANY (ARRAY['enrolled'::text, 'graduated'::text, 'suspended'::text, 'withdrawn'::text])))`

**الفهارس:**
- `btree (branch_id, diploma_id)`
- `فريد btree (org_member_id) WHERE (org_member_id IS NOT NULL)`
- `فريد btree (national_id) WHERE (national_id IS NOT NULL)`
- `فريد btree (student_no)`

**محفّزات:** `trg_students_updated_at` (BEFORE UPDATE)

## الجدولة والحضور والدرجات

المخطط: `er/timetable.mmd` (و`er/timetable.svg` عند التوليد).

### attendance_records

حضور الطلاب في الحصص (يدوي أو بالبطاقة)

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `session_id` | bigint | لا |  | FK | `class_sessions.id` (NO ACTION) |
| `student_id` | bigint | لا |  | FK | `students.id` (NO ACTION) |
| `present` | bool | لا |  |  |  |
| `method` | text | لا | `'manual'::text` |  |  |
| `recorded_by` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `recorded_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `attendance_records_method_ck`: `((method = ANY (ARRAY['manual'::text, 'nfc'::text, 'qr'::text])))`

**الفهارس:**
- `فريد btree (session_id, student_id)`

### class_sessions

الحصص: القاعة والمدرب والوقت؛ تمنع قيود الاستبعاد حجز القاعة أو المدرب مرتين

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `branch_id` | bigint | لا |  | FK | `branches.id` (NO ACTION) |
| `room_id` | bigint | لا |  | FK | `rooms.id` (NO ACTION) |
| `instructor_id` | bigint | لا |  | FK | `instructors.id` (NO ACTION) |
| `diploma_id` | bigint | لا |  | FK | `diplomas.id` (NO ACTION) |
| `subject_id` | bigint | نعم |  | FK | `subjects.id` (NO ACTION) |
| `title` | text | لا |  |  |  |
| `session_date` | date | لا |  |  |  |
| `start_time` | time | لا |  |  |  |
| `end_time` | time | لا |  |  |  |
| `status` | text | لا | `'scheduled'::text` |  |  |
| `recurrence_id` | bigint | نعم |  | FK | `session_recurrences.id` (NO ACTION) |
| `created_at` | timestamptz | لا | `now()` |  |  |
| `updated_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `class_sessions_status_ck`: `((status = ANY (ARRAY['scheduled'::text, 'done'::text, 'cancelled'::text])))`
- `class_sessions_time_ck`: `((end_time > start_time))`

**الفهارس:**
- `btree (session_date, branch_id)`
- `btree (instructor_id, session_date)`
- `btree (room_id, session_date)`

**محفّزات:** `trg_class_sessions_updated_at` (BEFORE UPDATE)

### grades

درجات الطلاب في المواد

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `student_id` | bigint | لا |  | FK | `students.id` (NO ACTION) |
| `subject_id` | bigint | لا |  | FK | `subjects.id` (NO ACTION) |
| `assessment_type` | text | لا |  |  |  |
| `score` | numeric(6,2) | لا |  |  |  |
| `max_score` | numeric(6,2) | لا |  |  |  |
| `assessed_on` | date | لا |  |  |  |
| `recorded_by` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `created_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `grades_score_ck`: `(((max_score > (0)::numeric) AND (score >= (0)::numeric) AND (score <= max_score)))`
- `grades_type_ck`: `((assessment_type = ANY (ARRAY['quiz'::text, 'midterm'::text, 'final'::text, 'practical'::text, 'project'::text])))`

**الفهارس:**
- `btree (student_id, subject_id)`

### session_recurrences

أنماط الجدول الأسبوعي المتكرر

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `branch_id` | bigint | لا |  | FK | `branches.id` (NO ACTION) |
| `room_id` | bigint | لا |  | FK | `rooms.id` (NO ACTION) |
| `instructor_id` | bigint | لا |  | FK | `instructors.id` (NO ACTION) |
| `diploma_id` | bigint | لا |  | FK | `diplomas.id` (NO ACTION) |
| `subject_id` | bigint | نعم |  | FK | `subjects.id` (NO ACTION) |
| `weekdays` | int4[] | لا |  |  |  |
| `start_time` | time | لا |  |  |  |
| `end_time` | time | لا |  |  |  |
| `valid_from` | date | لا |  |  |  |
| `valid_to` | date | لا |  |  |  |
| `created_by` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `created_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `session_recurrences_dates_ck`: `((valid_to >= valid_from))`
- `session_recurrences_time_ck`: `((end_time > start_time))`
- `session_recurrences_weekdays_ck`: `((((cardinality(weekdays) >= 1) AND (cardinality(weekdays) <= 7)) AND (weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7])))`

### session_students

الطلاب المسجلون في كل حصة؛ يتحقق المحفّز من السعة والتعارض

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `session_id` | bigint | لا |  | PK,FK | `class_sessions.id` (CASCADE) |
| `student_id` | bigint | لا |  | PK,FK | `students.id` (NO ACTION) |

**مفتاح أساسي مركّب:** (session_id, student_id)

**الفهارس:**
- `btree (student_id)`

**محفّزات:** `trg_session_students_guard` (BEFORE INSERT)

## المبيعات والتحصيل

المخطط: `er/sales.mmd` (و`er/sales.svg` عند التوليد).

### installments

أقساط الطلاب وتواريخ استحقاقها

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `student_id` | bigint | لا |  | FK | `students.id` (NO ACTION) |
| `sales_invoice_id` | bigint | نعم |  | FK | `sales_invoices.id` (NO ACTION) |
| `seq` | int | لا |  |  |  |
| `due_date` | date | لا |  |  |  |
| `amount_halalas` | bigint | لا |  |  |  |
| `status` | text | لا | `'pending'::text` |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `installments_amount_ck`: `((amount_halalas > 0))`
- `installments_status_ck`: `((status = ANY (ARRAY['pending'::text, 'partial'::text, 'paid'::text, 'cancelled'::text])))`

**الفهارس:**
- `btree (due_date) WHERE (status = ANY (ARRAY['pending'::text, 'partial'::text]))`
- `فريد btree (student_id, seq)`

### payment_allocations

توزيع الدفعات على الأقساط

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `payment_id` | bigint | لا |  | PK,FK | `payments.id` (NO ACTION) |
| `installment_id` | bigint | لا |  | PK,FK | `installments.id` (NO ACTION) |
| `amount_halalas` | bigint | لا |  |  |  |

**مفتاح أساسي مركّب:** (payment_id, installment_id)

**قيود التحقق:**
- `payment_allocations_amount_ck`: `((amount_halalas > 0))`

**محفّزات:** `trg_payment_allocations_guard` (BEFORE INSERT)

### payments

المبالغ المحصلة من الطلاب؛ تُؤكَّد برمز OTP وتتجمد وتُصحَّح بقيد عكسي

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `receipt_no` | text | لا |  | UK |  |
| `branch_id` | bigint | لا |  | FK | `branches.id` (NO ACTION) |
| `student_id` | bigint | لا |  | FK | `students.id` (NO ACTION) |
| `amount_halalas` | bigint | لا |  |  |  |
| `paid_on` | date | لا |  |  |  |
| `method` | text | لا |  |  |  |
| `reference` | text | نعم |  |  |  |
| `status` | text | لا | `'pending_otp'::text` |  |  |
| `collected_by` | int | لا |  | FK | `org_members.id` (NO ACTION) |
| `confirmed_at` | timestamptz | نعم |  |  |  |
| `reverses_payment_id` | bigint | نعم |  | FK | `payments.id` (NO ACTION) |
| `reversal_reason` | text | نعم |  |  |  |
| `receipt_emailed_at` | timestamptz | نعم |  |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `payments_amount_ck`: `((amount_halalas > 0))`
- `payments_confirmed_ck`: `(((status <> 'confirmed'::text) OR (confirmed_at IS NOT NULL)))`
- `payments_method_ck`: `((method = ANY (ARRAY['cash'::text, 'bank_transfer'::text, 'card'::text, 'pos'::text])))`
- `payments_reversal_ck`: `(((reverses_payment_id IS NULL) OR (reversal_reason IS NOT NULL)))`
- `payments_status_ck`: `((status = ANY (ARRAY['pending_otp'::text, 'confirmed'::text, 'reversed'::text, 'rejected'::text])))`

**الفهارس:**
- `btree (branch_id, paid_on)`
- `فريد btree (reverses_payment_id) WHERE (reverses_payment_id IS NOT NULL)`
- `فريد btree (receipt_no)`
- `btree (student_id, paid_on)`

**محفّزات:** `trg_payments_immutable` (BEFORE DELETE/UPDATE)

### sales_invoice_lines

بنود فواتير المبيعات، والضريبة والصافي مولَّدان

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `invoice_id` | bigint | لا |  | FK | `sales_invoices.id` (CASCADE) |
| `line_no` | int | لا |  |  |  |
| `description` | text | لا |  |  |  |
| `diploma_id` | bigint | نعم |  | FK | `diplomas.id` (NO ACTION) |
| `subject_id` | bigint | نعم |  | FK | `subjects.id` (NO ACTION) |
| `quantity` | numeric(14,3) | لا | `1` |  |  |
| `unit_price_halalas` | bigint | لا |  |  |  |
| `discount_halalas` | bigint | لا | `0` |  |  |
| `vat_rate` | numeric(6,3) | لا | `15` |  |  |
| `net_halalas` | bigint | نعم | مولَّد: `((round((quantity * (unit_price_halalas)::numeric)))::bigint - discount_halalas)` |  |  |
| `vat_halalas` | bigint | نعم | مولَّد: `(round((((((round((quantity * (unit_price_halalas)::numeric)))::bigint - discount_halalas))::numeric * vat_rate) / (100)::numeric)))::bigint` |  |  |

**قيود التحقق:**
- `sales_invoice_lines_amounts_ck`: `(((quantity > (0)::numeric) AND (unit_price_halalas >= 0) AND (discount_halalas >= 0) AND ((vat_rate >= (0)::numeric) AND (vat_rate <= (100)::numeric))))`

**الفهارس:**
- `فريد btree (invoice_id, line_no)`

### sales_invoices

فواتير المبيعات (قياسية أو مبسطة) بحقول جاهزة للفوترة الإلكترونية

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `invoice_no` | text | لا |  | UK |  |
| `invoice_uuid` | uuid | لا | `gen_random_uuid()` | UK |  |
| `branch_id` | bigint | لا |  | FK | `branches.id` (NO ACTION) |
| `student_id` | bigint | نعم |  | FK | `students.id` (NO ACTION) |
| `customer_name` | text | لا |  |  |  |
| `customer_vat_number` | text | نعم |  |  |  |
| `invoice_type` | text | لا | `'simplified'::text` |  |  |
| `issue_date` | date | لا |  |  |  |
| `status` | text | لا | `'draft'::text` |  |  |
| `net_halalas` | bigint | لا | `0` |  |  |
| `vat_halalas` | bigint | لا | `0` |  |  |
| `gross_halalas` | bigint | نعم | مولَّد: `(net_halalas + vat_halalas)` |  |  |
| `zatca_status` | text | لا | `'not_submitted'::text` |  |  |
| `zatca_hash` | text | نعم |  |  |  |
| `created_by` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `created_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `sales_invoices_amounts_ck`: `(((invoice_type = 'credit_note'::text) OR ((net_halalas >= 0) AND (vat_halalas >= 0))))`
- `sales_invoices_standard_ck`: `(((invoice_type <> 'standard'::text) OR (customer_vat_number IS NOT NULL)))`
- `sales_invoices_status_ck`: `((status = ANY (ARRAY['draft'::text, 'issued'::text, 'cancelled'::text])))`
- `sales_invoices_type_ck`: `((invoice_type = ANY (ARRAY['standard'::text, 'simplified'::text, 'credit_note'::text])))`
- `sales_invoices_vat_ck`: `(((customer_vat_number IS NULL) OR (customer_vat_number ~ '^3[0-9]{13}3$'::text)))`
- `sales_invoices_zatca_ck`: `((zatca_status = ANY (ARRAY['not_submitted'::text, 'reported'::text, 'cleared'::text, 'rejected'::text])))`

**الفهارس:**
- `btree (branch_id, issue_date)`
- `فريد btree (invoice_no)`
- `btree (student_id)`
- `فريد btree (invoice_uuid)`

### tax_rates

نسب ضريبة القيمة المضافة وفئاتها وفترات سريانها

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `code` | text | لا |  |  |  |
| `name` | text | لا |  |  |  |
| `rate` | numeric(6,3) | لا |  |  |  |
| `category` | text | لا | `'standard'::text` |  |  |
| `valid_from` | date | لا |  |  |  |
| `valid_to` | date | نعم |  |  |  |

**قيود التحقق:**
- `tax_rates_category_ck`: `((category = ANY (ARRAY['standard'::text, 'zero_rated'::text, 'exempt'::text])))`
- `tax_rates_dates_ck`: `(((valid_to IS NULL) OR (valid_to >= valid_from)))`
- `tax_rates_rate_ck`: `(((rate >= (0)::numeric) AND (rate <= (100)::numeric)))`

**الفهارس:**
- `فريد btree (code, valid_from)`

## المصروفات والميزانيات

المخطط: `er/expenses.mmd` (و`er/expenses.svg` عند التوليد).

### branch_budgets

الميزانية الشهرية لكل فرع (إجمالية أو لفئة) ونسبة التنبيه

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `branch_id` | bigint | لا |  | FK | `branches.id` (NO ACTION) |
| `period_month` | date | لا |  |  |  |
| `category_id` | bigint | نعم |  | FK | `expense_categories.id` (NO ACTION) |
| `amount_halalas` | bigint | لا |  |  |  |
| `warn_at_percent` | int | لا | `80` |  |  |
| `approved_by` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `created_at` | timestamptz | لا | `now()` |  |  |

- فريد مركّب: (branch_id, period_month, category_id)

**قيود التحقق:**
- `branch_budgets_amount_ck`: `(((amount_halalas >= 0) AND ((warn_at_percent >= 1) AND (warn_at_percent <= 100))))`
- `branch_budgets_month_ck`: `((EXTRACT(day FROM period_month) = (1)::numeric))`

### cost_report_snapshots

لقطات تقارير التكلفة المحسوبة بسياسة معتمدة

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `period_from` | date | لا |  |  |  |
| `period_to` | date | لا |  |  |  |
| `policy_version` | int | لا |  |  |  |
| `result` | jsonb | لا |  |  |  |
| `created_by` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `created_at` | timestamptz | لا | `now()` |  |  |

**الفهارس:**
- `btree (period_from, period_to)`

### expense_categories

فئات المصروفات (مع تمييز النثريات)

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `parent_id` | bigint | نعم |  | FK | `expense_categories.id` (NO ACTION) |
| `code` | text | لا |  | UK |  |
| `name` | text | لا |  |  |  |
| `is_petty` | bool | لا | `false` |  |  |

**الفهارس:**
- `فريد btree (code)`

### expenses

المصروفات التشغيلية المؤكَّدة؛ تتجمد بعد التأكيد

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `expense_no` | text | لا |  | UK |  |
| `branch_id` | bigint | لا |  | FK | `branches.id` (NO ACTION) |
| `category_id` | bigint | لا |  | FK | `expense_categories.id` (NO ACTION) |
| `expense_date` | date | لا |  |  |  |
| `description` | text | لا |  |  |  |
| `net_halalas` | bigint | لا |  |  |  |
| `vat_halalas` | bigint | لا | `0` |  |  |
| `gross_halalas` | bigint | نعم | مولَّد: `(net_halalas + vat_halalas)` |  |  |
| `source` | text | لا | `'manual'::text` |  |  |
| `supplier_invoice_id` | bigint | نعم |  | FK | `supplier_invoices.id` (NO ACTION) |
| `status` | text | لا | `'pending_otp'::text` |  |  |
| `created_by` | int | لا |  | FK | `org_members.id` (NO ACTION) |
| `confirmed_at` | timestamptz | نعم |  |  |  |
| `reverses_expense_id` | bigint | نعم |  | FK | `expenses.id` (NO ACTION) |
| `reversal_reason` | text | نعم |  |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `expenses_amounts_ck`: `(((net_halalas >= 0) AND (vat_halalas >= 0)))`
- `expenses_confirmed_ck`: `(((status <> 'confirmed'::text) OR (confirmed_at IS NOT NULL)))`
- `expenses_source_ck`: `((source = ANY (ARRAY['manual'::text, 'supplier_invoice'::text, 'payroll'::text, 'utility'::text])))`
- `expenses_status_ck`: `((status = ANY (ARRAY['pending_otp'::text, 'confirmed'::text, 'reversed'::text, 'rejected'::text])))`

**الفهارس:**
- `btree (branch_id, expense_date)`
- `btree (category_id, expense_date)`
- `فريد btree (expense_no)`

**محفّزات:** `trg_expenses_immutable` (BEFORE UPDATE/DELETE)

### utility_invoices

فواتير الكهرباء: فاتورة واحدة لكل عداد وشهر

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `branch_id` | bigint | لا |  | FK | `branches.id` (NO ACTION) |
| `meter_id` | bigint | لا |  | FK | `electricity_meters.id` (NO ACTION) |
| `bill_month` | date | لا |  |  |  |
| `kwh` | numeric(14,2) | لا |  |  |  |
| `net_halalas` | bigint | لا |  |  |  |
| `vat_halalas` | bigint | لا | `0` |  |  |
| `bill_no` | text | نعم |  |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `utility_invoices_amounts_ck`: `(((kwh >= (0)::numeric) AND (net_halalas >= 0) AND (vat_halalas >= 0)))`
- `utility_invoices_month_ck`: `((EXTRACT(day FROM bill_month) = (1)::numeric))`

**الفهارس:**
- `فريد btree (meter_id, bill_month)`

## المخزون

المخطط: `er/inventory.mmd` (و`er/inventory.svg` عند التوليد).

### item_categories

تصنيفات الأصناف

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `parent_id` | bigint | نعم |  | FK | `item_categories.id` (NO ACTION) |
| `code` | text | لا |  | UK |  |
| `name` | text | لا |  |  |  |

**الفهارس:**
- `فريد btree (code)`

### items

بطاقات الأصناف بكود تلقائي ونوع وطريقة تقييم

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `item_code` | text | لا |  | UK |  |
| `name` | text | لا |  |  |  |
| `category_id` | bigint | لا |  | FK | `item_categories.id` (NO ACTION) |
| `unit_id` | bigint | لا |  | FK | `units.id` (NO ACTION) |
| `item_type` | text | لا | `'consumable'::text` |  |  |
| `valuation_method` | text | لا | `'weighted_average'::text` |  |  |
| `description` | text | نعم |  |  |  |
| `is_active` | bool | لا | `true` |  |  |
| `created_by` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `created_at` | timestamptz | لا | `now()` |  |  |
| `updated_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `items_type_ck`: `((item_type = ANY (ARRAY['consumable'::text, 'asset'::text, 'service'::text])))`
- `items_valuation_ck`: `((valuation_method = ANY (ARRAY['weighted_average'::text, 'fifo'::text])))`

**الفهارس:**
- `btree (category_id)`
- `فريد btree (item_code)`

**محفّزات:** `trg_items_updated_at` (BEFORE UPDATE)

### reorder_alerts

تنبيهات الوصول للحد الأدنى؛ تنبيه مفتوح واحد لكل صنف ومستودع

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `warehouse_id` | bigint | لا |  | FK | `warehouses.id` (NO ACTION) |
| `item_id` | bigint | لا |  | FK | `items.id` (NO ACTION) |
| `qty_at_trigger` | numeric(14,3) | لا |  |  |  |
| `min_qty` | numeric(14,3) | لا |  |  |  |
| `status` | text | لا | `'open'::text` |  |  |
| `opened_at` | timestamptz | لا | `now()` |  |  |
| `escalated_at` | timestamptz | نعم |  |  |  |
| `closed_at` | timestamptz | نعم |  |  |  |
| `purchase_request_id` | bigint | نعم |  | FK | `purchase_requests.id` (NO ACTION) |

**قيود التحقق:**
- `reorder_alerts_status_ck`: `((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'closed'::text, 'dismissed'::text])))`

**الفهارس:**
- `فريد btree (warehouse_id, item_id) WHERE (status = ANY (ARRAY['open'::text, 'in_progress'::text]))`

### stock_count_lines

بنود الجرد وفروقاته وأسبابها

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `count_id` | bigint | لا |  | PK,FK | `stock_counts.id` (CASCADE) |
| `item_id` | bigint | لا |  | PK,FK | `items.id` (NO ACTION) |
| `system_qty` | numeric(14,3) | لا |  |  |  |
| `counted_qty` | numeric(14,3) | لا |  |  |  |
| `reason` | text | نعم |  |  |  |

**مفتاح أساسي مركّب:** (count_id, item_id)

**قيود التحقق:**
- `stock_count_lines_ck`: `(((counted_qty >= (0)::numeric) AND ((counted_qty = system_qty) OR (reason IS NOT NULL))))`

### stock_counts

الجرد الفعلي للمستودعات

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `warehouse_id` | bigint | لا |  | FK | `warehouses.id` (NO ACTION) |
| `count_date` | date | لا |  |  |  |
| `status` | text | لا | `'open'::text` |  |  |
| `counted_by` | int | لا |  | FK | `org_members.id` (NO ACTION) |
| `closed_at` | timestamptz | نعم |  |  |  |

**قيود التحقق:**
- `stock_counts_status_ck`: `((status = ANY (ARRAY['open'::text, 'closed'::text, 'cancelled'::text])))`

### stock_levels

الحد الأدنى والأقصى وكمية إعادة الطلب لكل صنف ومستودع

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `warehouse_id` | bigint | لا |  | PK,FK | `warehouses.id` (NO ACTION) |
| `item_id` | bigint | لا |  | PK,FK | `items.id` (NO ACTION) |
| `min_qty` | numeric(14,3) | لا |  |  |  |
| `max_qty` | numeric(14,3) | نعم |  |  |  |
| `reorder_qty` | numeric(14,3) | نعم |  |  |  |
| `lead_time_days` | int | نعم |  |  |  |
| `set_by` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `updated_at` | timestamptz | لا | `now()` |  |  |

**مفتاح أساسي مركّب:** (warehouse_id, item_id)

**قيود التحقق:**
- `stock_levels_qty_ck`: `(((min_qty >= (0)::numeric) AND ((max_qty IS NULL) OR (max_qty >= min_qty)) AND ((reorder_qty IS NULL) OR (reorder_qty > (0)::numeric))))`

**محفّزات:** `trg_stock_levels_updated_at` (BEFORE UPDATE)

### stock_movements

دفتر حركات المخزون (إضافة فقط)؛ الرصيد = مجموع الحركات ولا يسمح برصيد سالب

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `movement_no` | text | لا |  | UK |  |
| `warehouse_id` | bigint | لا |  | FK | `warehouses.id` (NO ACTION) |
| `item_id` | bigint | لا |  | FK | `items.id` (NO ACTION) |
| `movement_type` | text | لا |  |  |  |
| `qty_delta` | numeric(14,3) | لا |  |  |  |
| `unit_cost_halalas` | bigint | نعم |  |  |  |
| `occurred_at` | timestamptz | لا | `now()` |  |  |
| `ref_type` | text | نعم |  |  |  |
| `ref_id` | bigint | نعم |  |  |  |
| `issued_to_room_id` | bigint | نعم |  | FK | `rooms.id` (NO ACTION) |
| `issued_to_department_id` | bigint | نعم |  | FK | `departments.id` (NO ACTION) |
| `purpose` | text | نعم |  |  |  |
| `created_by` | int | لا |  | FK | `org_members.id` (NO ACTION) |
| `otp_challenge_id` | uuid | نعم |  | FK | `otp_challenges.id` (NO ACTION) |
| `created_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `stock_movements_cost_ck`: `(((unit_cost_halalas IS NULL) OR (unit_cost_halalas >= 0)))`
- `stock_movements_delta_ck`: `((qty_delta <> (0)::numeric))`
- `stock_movements_issue_target_ck`: `(((movement_type <> 'issue'::text) OR (issued_to_room_id IS NOT NULL) OR (issued_to_department_id IS NOT NULL)))`
- `stock_movements_sign_ck`: `((((movement_type = ANY (ARRAY['opening'::text, 'receipt'::text, 'transfer_in'::text, 'return_from_room'::text])) AND (qty_delta > (0)::numeric)) OR ((movement_type = ANY (ARRAY['issue'::text, 'transfer_out'::text, 'return_to_supplier'::text])) AND (qty_delta < (0)::numeric)) OR (movement_type = 'adjustment'::text)))`
- `stock_movements_type_ck`: `((movement_type = ANY (ARRAY['opening'::text, 'receipt'::text, 'issue'::text, 'transfer_out'::text, 'transfer_in'::text, 'adjustment'::text, 'return_to_supplier'::text, 'return_from_room'::text])))`

**الفهارس:**
- `فريد btree (movement_no)`
- `btree (issued_to_room_id, occurred_at) WHERE (issued_to_room_id IS NOT NULL)`
- `btree (warehouse_id, item_id, occurred_at)`

**محفّزات:** `trg_stock_movements_alert` (AFTER INSERT)، `trg_stock_movements_append_only` (BEFORE UPDATE/DELETE)، `trg_stock_movements_guard` (BEFORE INSERT)

### stock_transfer_lines

بنود النقل

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `transfer_id` | bigint | لا |  | PK,FK | `stock_transfers.id` (CASCADE) |
| `item_id` | bigint | لا |  | PK,FK | `items.id` (NO ACTION) |
| `qty` | numeric(14,3) | لا |  |  |  |
| `received_qty` | numeric(14,3) | نعم |  |  |  |

**مفتاح أساسي مركّب:** (transfer_id, item_id)

**قيود التحقق:**
- `stock_transfer_lines_qty_ck`: `(((qty > (0)::numeric) AND ((received_qty IS NULL) OR (received_qty >= (0)::numeric))))`

### stock_transfers

مستندات النقل بين المستودعات

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `transfer_no` | text | لا |  | UK |  |
| `from_warehouse_id` | bigint | لا |  | FK | `warehouses.id` (NO ACTION) |
| `to_warehouse_id` | bigint | لا |  | FK | `warehouses.id` (NO ACTION) |
| `status` | text | لا | `'draft'::text` |  |  |
| `requested_by` | int | لا |  | FK | `org_members.id` (NO ACTION) |
| `shipped_at` | timestamptz | نعم |  |  |  |
| `received_at` | timestamptz | نعم |  |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `stock_transfers_status_ck`: `((status = ANY (ARRAY['draft'::text, 'in_transit'::text, 'received'::text, 'cancelled'::text])))`
- `stock_transfers_wh_ck`: `((from_warehouse_id <> to_warehouse_id))`

**الفهارس:**
- `فريد btree (transfer_no)`

### units

وحدات القياس

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `code` | text | لا |  | UK |  |
| `name` | text | لا |  |  |  |

**الفهارس:**
- `فريد btree (code)`

### warehouses

المستودعات (مستودع لكل فرع)

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `branch_id` | bigint | لا |  | FK | `branches.id` (NO ACTION) |
| `code` | text | لا |  | UK |  |
| `name` | text | لا |  |  |  |
| `keeper_member_id` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `status` | text | لا | `'active'::text` |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `warehouses_status_ck`: `((status = ANY (ARRAY['active'::text, 'inactive'::text])))`

**الفهارس:**
- `btree (branch_id)`
- `فريد btree (code)`

## المشتريات: الموردون وعروض الأسعار

المخطط: `er/sourcing.mmd` (و`er/sourcing.svg` عند التوليد).

### procurement_exceptions

استثناءات قاعدة الثلاثة عروض والشراء المباشر بسبب مكتوب واعتماد

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `pr_id` | bigint | لا |  | FK | `purchase_requests.id` (NO ACTION) |
| `exception_type` | text | لا |  |  |  |
| `reason` | text | لا |  |  |  |
| `requested_by` | int | لا |  | FK | `org_members.id` (NO ACTION) |
| `approved_by` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `approved_at` | timestamptz | نعم |  |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `procurement_exceptions_approver_ck`: `(((approved_by IS NULL) OR (approved_by <> requested_by)))`
- `procurement_exceptions_reason_ck`: `((length(TRIM(BOTH FROM reason)) >= 10))`
- `procurement_exceptions_type_ck`: `((exception_type = ANY (ARRAY['single_source'::text, 'late_responses'::text, 'direct_small'::text, 'emergency'::text])))`

### purchase_request_lines

أصناف وكميات طلب الشراء

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `pr_id` | bigint | لا |  | FK | `purchase_requests.id` (CASCADE) |
| `item_id` | bigint | لا |  | FK | `items.id` (NO ACTION) |
| `qty` | numeric(14,3) | لا |  |  |  |
| `notes` | text | نعم |  |  |  |

**قيود التحقق:**
- `purchase_request_lines_qty_ck`: `((qty > (0)::numeric))`

**الفهارس:**
- `فريد btree (pr_id, item_id)`

### purchase_requests

طلبات الشراء، من تنبيه المخزون أو يدويًا

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `pr_no` | text | لا |  | UK |  |
| `branch_id` | bigint | لا |  | FK | `branches.id` (NO ACTION) |
| `warehouse_id` | bigint | لا |  | FK | `warehouses.id` (NO ACTION) |
| `path` | text | لا | `'standard'::text` |  |  |
| `source` | text | لا | `'manual'::text` |  |  |
| `alert_id` | bigint | نعم |  | FK | `reorder_alerts.id` (NO ACTION) |
| `reason` | text | نعم |  |  |  |
| `status` | text | لا | `'draft'::text` |  |  |
| `requested_by` | int | لا |  | FK | `org_members.id` (NO ACTION) |
| `created_at` | timestamptz | لا | `now()` |  |  |
| `updated_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `purchase_requests_path_ck`: `((path = ANY (ARRAY['standard'::text, 'direct_small'::text])))`
- `purchase_requests_source_ck`: `((source = ANY (ARRAY['alert'::text, 'manual'::text])))`
- `purchase_requests_status_ck`: `((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'rfq'::text, 'awarded'::text, 'po_issued'::text, 'closed'::text, 'cancelled'::text])))`

**الفهارس:**
- `btree (branch_id, status)`
- `فريد btree (pr_no)`

**محفّزات:** `trg_purchase_requests_updated_at` (BEFORE UPDATE)

### quotation_evaluations

تقييم العروض فنيًا وجودةً وماليًا

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `quotation_id` | bigint | لا |  | FK | `quotations.id` (CASCADE) |
| `evaluated_by` | int | لا |  | FK | `org_members.id` (NO ACTION) |
| `technical_score` | int | لا |  |  |  |
| `quality_score` | int | لا |  |  |  |
| `commercial_score` | int | لا |  |  |  |
| `notes` | text | نعم |  |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `quotation_evaluations_scores_ck`: `((((technical_score >= 0) AND (technical_score <= 100)) AND ((quality_score >= 0) AND (quality_score <= 100)) AND ((commercial_score >= 0) AND (commercial_score <= 100))))`

**الفهارس:**
- `فريد btree (quotation_id, evaluated_by)`

### quotation_lines

أسعار بنود العرض، والصافي والضريبة مولَّدان

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `quotation_id` | bigint | لا |  | FK | `quotations.id` (CASCADE) |
| `item_id` | bigint | لا |  | FK | `items.id` (NO ACTION) |
| `quantity` | numeric(14,3) | لا |  |  |  |
| `unit_price_halalas` | bigint | لا |  |  |  |
| `vat_rate` | numeric(6,3) | لا | `15` |  |  |
| `net_halalas` | bigint | نعم | مولَّد: `(round((quantity * (unit_price_halalas)::numeric)))::bigint` |  |  |
| `vat_halalas` | bigint | نعم | مولَّد: `(round(((round((quantity * (unit_price_halalas)::numeric)) * vat_rate) / (100)::numeric)))::bigint` |  |  |

**قيود التحقق:**
- `quotation_lines_amounts_ck`: `(((quantity > (0)::numeric) AND (unit_price_halalas >= 0) AND ((vat_rate >= (0)::numeric) AND (vat_rate <= (100)::numeric))))`

**الفهارس:**
- `فريد btree (quotation_id, item_id)`

### quotations

عروض الأسعار المدخلة، عرض واحد لكل مورد

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `rfq_id` | bigint | لا |  | FK | `rfqs.id` (NO ACTION) |
| `supplier_id` | bigint | لا |  | FK | `suppliers.id` (NO ACTION) |
| `supplier_vat_number` | text | لا |  |  |  |
| `quote_ref` | text | نعم |  |  |  |
| `quote_date` | date | لا |  |  |  |
| `valid_until` | date | نعم |  |  |  |
| `delivery_days` | int | نعم |  |  |  |
| `payment_terms` | text | نعم |  |  |  |
| `quality_notes` | text | نعم |  |  |  |
| `entered_by` | int | لا |  | FK | `org_members.id` (NO ACTION) |
| `status` | text | لا | `'submitted'::text` |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `quotations_delivery_ck`: `(((delivery_days IS NULL) OR (delivery_days >= 0)))`
- `quotations_status_ck`: `((status = ANY (ARRAY['submitted'::text, 'withdrawn'::text, 'disqualified'::text])))`
- `quotations_vat_ck`: `((supplier_vat_number ~ '^3[0-9]{13}3$'::text))`

**الفهارس:**
- `فريد btree (rfq_id, supplier_id)`

**محفّزات:** `trg_quotations_guard` (BEFORE INSERT)

### rfq_awards

الترسية؛ تتطلب ثلاثة عروض، ومبررًا إن لم تكن الأقل سعرًا

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `rfq_id` | bigint | لا |  | PK,FK | `rfqs.id` (NO ACTION) |
| `quotation_id` | bigint | لا |  | FK | `quotations.id` (NO ACTION) |
| `is_lowest_price` | bool | لا |  |  |  |
| `justification` | text | نعم |  |  |  |
| `exception_id` | bigint | نعم |  | FK | `procurement_exceptions.id` (NO ACTION) |
| `recommended_by` | int | لا |  | FK | `org_members.id` (NO ACTION) |
| `approved_by` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `approved_at` | timestamptz | نعم |  |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `rfq_awards_approver_ck`: `(((approved_by IS NULL) OR (approved_by <> recommended_by)))`
- `rfq_awards_justification_ck`: `((is_lowest_price OR (length(TRIM(BOTH FROM COALESCE(justification, ''::text))) >= 10)))`

**محفّزات:** `trg_rfq_awards_guard` (BEFORE INSERT)

### rfq_suppliers

الموردون المدعوون لكل طلب عروض

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `rfq_id` | bigint | لا |  | PK,FK | `rfqs.id` (CASCADE) |
| `supplier_id` | bigint | لا |  | PK,FK | `suppliers.id` (NO ACTION) |
| `sent_at` | timestamptz | نعم |  |  |  |
| `declined_at` | timestamptz | نعم |  |  |  |

**مفتاح أساسي مركّب:** (rfq_id, supplier_id)

### rfqs

طلبات عروض الأسعار وموعدها النهائي

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `rfq_no` | text | لا |  | UK |  |
| `pr_id` | bigint | لا |  | FK | `purchase_requests.id` (NO ACTION) |
| `status` | text | لا | `'open'::text` |  |  |
| `deadline_at` | timestamptz | لا |  |  |  |
| `created_by` | int | لا |  | FK | `org_members.id` (NO ACTION) |
| `created_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `rfqs_status_ck`: `((status = ANY (ARRAY['open'::text, 'evaluating'::text, 'awarded'::text, 'cancelled'::text])))`

**الفهارس:**
- `فريد btree (rfq_no)`
- `btree (pr_id)`

### supplier_categories

تخصصات الموردين بحسب تصنيف الأصناف

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `supplier_id` | bigint | لا |  | PK,FK | `suppliers.id` (CASCADE) |
| `category_id` | bigint | لا |  | PK,FK | `item_categories.id` (NO ACTION) |

**مفتاح أساسي مركّب:** (supplier_id, category_id)

### suppliers

الموردون برقم ضريبي مُتحقَّق من شكله؛ لا يُعتمد مورد بلا رقم ضريبي

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `supplier_no` | text | لا |  | UK |  |
| `legal_name` | text | لا |  |  |  |
| `vat_number` | text | نعم |  |  |  |
| `commercial_reg_no` | text | نعم |  |  |  |
| `address` | text | نعم |  |  |  |
| `city` | text | نعم |  |  |  |
| `email` | text | نعم |  |  |  |
| `phone` | text | نعم |  |  |  |
| `iban` | text | نعم |  |  |  |
| `status` | text | لا | `'pending'::text` |  |  |
| `approved_by` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `approved_at` | timestamptz | نعم |  |  |  |
| `rating` | numeric(3,2) | نعم |  |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |
| `updated_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `suppliers_approved_ck`: `(((status <> 'approved'::text) OR ((vat_number IS NOT NULL) AND (approved_by IS NOT NULL))))`
- `suppliers_iban_ck`: `(((iban IS NULL) OR (iban ~ '^SA[0-9]{22}$'::text)))`
- `suppliers_rating_ck`: `(((rating IS NULL) OR ((rating >= (0)::numeric) AND (rating <= (5)::numeric))))`
- `suppliers_status_ck`: `((status = ANY (ARRAY['pending'::text, 'approved'::text, 'suspended'::text, 'blocked'::text])))`
- `suppliers_vat_format_ck`: `(((vat_number IS NULL) OR (vat_number ~ '^3[0-9]{13}3$'::text)))`

**الفهارس:**
- `فريد btree (supplier_no)`
- `فريد btree (vat_number) WHERE (vat_number IS NOT NULL)`

**محفّزات:** `trg_suppliers_updated_at` (BEFORE UPDATE)

## المشتريات: الأوامر والاستلام والفواتير

المخطط: `er/orders.mmd` (و`er/orders.svg` عند التوليد).

### direct_purchase_policies

شروط مسار الشراء المباشر الصغير

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `max_amount_halalas` | bigint | لا |  |  |  |
| `max_qty` | numeric(14,3) | نعم |  |  |  |
| `monthly_cap_halalas` | bigint | نعم |  |  |  |
| `anti_split_window_days` | int | لا | `30` |  |  |
| `conditions` | text | نعم |  |  |  |
| `valid_from` | date | لا |  |  |  |
| `set_by` | int | لا |  | FK | `org_members.id` (NO ACTION) |

**قيود التحقق:**
- `direct_purchase_policies_ck`: `(((max_amount_halalas > 0) AND ((anti_split_window_days >= 1) AND (anti_split_window_days <= 365))))`

### goods_receipt_lines

كميات الاستلام والمقبول والمرفوض ونتيجة الجودة

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `grn_id` | bigint | لا |  | FK | `goods_receipts.id` (CASCADE) |
| `po_line_id` | bigint | لا |  | FK | `purchase_order_lines.id` (NO ACTION) |
| `qty_received` | numeric(14,3) | لا |  |  |  |
| `qty_accepted` | numeric(14,3) | لا |  |  |  |
| `qty_rejected` | numeric(14,3) | نعم | مولَّد: `(qty_received - qty_accepted)` |  |  |
| `quality_result` | text | لا | `'accepted'::text` |  |  |
| `quality_notes` | text | نعم |  |  |  |

**قيود التحقق:**
- `goods_receipt_lines_qty_ck`: `(((qty_received > (0)::numeric) AND (qty_accepted >= (0)::numeric) AND (qty_accepted <= qty_received)))`
- `goods_receipt_lines_quality_ck`: `((quality_result = ANY (ARRAY['accepted'::text, 'accepted_with_notes'::text, 'rejected'::text])))`
- `goods_receipt_lines_rejected_ck`: `(((quality_result <> 'rejected'::text) OR (qty_accepted = (0)::numeric)))`

**الفهارس:**
- `فريد btree (grn_id, po_line_id)`

**محفّزات:** `trg_goods_receipt_lines_guard` (BEFORE UPDATE/INSERT)

### goods_receipts

محاضر استلام البضاعة

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `grn_no` | text | لا |  | UK |  |
| `po_id` | bigint | لا |  | FK | `purchase_orders.id` (NO ACTION) |
| `warehouse_id` | bigint | لا |  | FK | `warehouses.id` (NO ACTION) |
| `status` | text | لا | `'draft'::text` |  |  |
| `received_by` | int | لا |  | FK | `org_members.id` (NO ACTION) |
| `received_at` | timestamptz | لا | `now()` |  |  |
| `delivery_note_no` | text | نعم |  |  |  |
| `notes` | text | نعم |  |  |  |

**قيود التحقق:**
- `goods_receipts_status_ck`: `((status = ANY (ARRAY['draft'::text, 'confirmed'::text, 'cancelled'::text])))`

**الفهارس:**
- `فريد btree (grn_no)`
- `btree (po_id)`

### match_tolerances

نسب التسامح في المطابقة الثلاثية للسعر والكمية

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `category_id` | bigint | نعم |  | FK | `item_categories.id` (NO ACTION) |
| `price_percent` | numeric(6,3) | لا | `0` |  |  |
| `qty_percent` | numeric(6,3) | لا | `0` |  |  |
| `valid_from` | date | لا |  |  |  |
| `set_by` | int | نعم |  | FK | `org_members.id` (NO ACTION) |

- فريد مركّب: (category_id, valid_from)

**قيود التحقق:**
- `match_tolerances_ck`: `((((price_percent >= (0)::numeric) AND (price_percent <= (100)::numeric)) AND ((qty_percent >= (0)::numeric) AND (qty_percent <= (100)::numeric))))`

### purchase_limits

سقوف الشراء الأسبوعية والشهرية (من المدير العام)

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `branch_id` | bigint | نعم |  | FK | `branches.id` (NO ACTION) |
| `period` | text | لا |  |  |  |
| `max_amount_halalas` | bigint | لا |  |  |  |
| `valid_from` | date | لا |  |  |  |
| `valid_to` | date | نعم |  |  |  |
| `set_by` | int | لا |  | FK | `org_members.id` (NO ACTION) |

**قيود التحقق:**
- `purchase_limits_amount_ck`: `((max_amount_halalas > 0))`
- `purchase_limits_period_ck`: `((period = ANY (ARRAY['weekly'::text, 'monthly'::text])))`

### purchase_order_lines

بنود أمر الشراء

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `po_id` | bigint | لا |  | FK | `purchase_orders.id` (CASCADE) |
| `line_no` | int | لا |  |  |  |
| `item_id` | bigint | لا |  | FK | `items.id` (NO ACTION) |
| `description` | text | نعم |  |  |  |
| `quantity` | numeric(14,3) | لا |  |  |  |
| `unit_price_halalas` | bigint | لا |  |  |  |
| `vat_rate` | numeric(6,3) | لا | `15` |  |  |
| `net_halalas` | bigint | نعم | مولَّد: `(round((quantity * (unit_price_halalas)::numeric)))::bigint` |  |  |
| `vat_halalas` | bigint | نعم | مولَّد: `(round(((round((quantity * (unit_price_halalas)::numeric)) * vat_rate) / (100)::numeric)))::bigint` |  |  |

**قيود التحقق:**
- `purchase_order_lines_amounts_ck`: `(((quantity > (0)::numeric) AND (unit_price_halalas >= 0) AND ((vat_rate >= (0)::numeric) AND (vat_rate <= (100)::numeric))))`

**الفهارس:**
- `فريد btree (po_id, line_no)`

**محفّزات:** `trg_purchase_order_lines_freeze` (BEFORE DELETE/INSERT/UPDATE)

### purchase_orders

أوامر الشراء باسم الجهة؛ تتجمد بعد التجهيز، ولا يعتمدها من أعدّها

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `po_no` | text | لا |  |  |  |
| `version` | int | لا | `1` |  |  |
| `supersedes_po_id` | bigint | نعم |  | FK | `purchase_orders.id` (NO ACTION) |
| `pr_id` | bigint | لا |  | FK | `purchase_requests.id` (NO ACTION) |
| `rfq_id` | bigint | نعم |  | FK | `rfqs.id` (NO ACTION) |
| `exception_id` | bigint | نعم |  | FK | `procurement_exceptions.id` (NO ACTION) |
| `branch_id` | bigint | لا |  | FK | `branches.id` (NO ACTION) |
| `warehouse_id` | bigint | لا |  | FK | `warehouses.id` (NO ACTION) |
| `supplier_id` | bigint | لا |  | FK | `suppliers.id` (NO ACTION) |
| `entity_name` | text | لا |  |  |  |
| `entity_vat_number` | text | لا |  |  |  |
| `supplier_vat_number` | text | لا |  |  |  |
| `issue_date` | date | لا |  |  |  |
| `delivery_date` | date | نعم |  |  |  |
| `terms` | text | نعم |  |  |  |
| `status` | text | لا | `'draft'::text` |  |  |
| `net_halalas` | bigint | لا | `0` |  |  |
| `vat_halalas` | bigint | لا | `0` |  |  |
| `gross_halalas` | bigint | نعم | مولَّد: `(net_halalas + vat_halalas)` |  |  |
| `prepared_by` | int | لا |  | FK | `org_members.id` (NO ACTION) |
| `prepared_at` | timestamptz | نعم |  |  |  |
| `approved_by` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `approved_at` | timestamptz | نعم |  |  |  |
| `approved_via_delegation_id` | bigint | نعم |  | FK | `approval_delegations.id` (NO ACTION) |
| `sent_at` | timestamptz | نعم |  |  |  |
| `acknowledged_at` | timestamptz | نعم |  |  |  |
| `document_hash` | text | نعم |  |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |
| `updated_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `purchase_orders_amounts_ck`: `(((net_halalas >= 0) AND (vat_halalas >= 0)))`
- `purchase_orders_approval_ck`: `(((status <> ALL (ARRAY['approved'::text, 'sent'::text, 'acknowledged'::text, 'partially_received'::text, 'received'::text, 'closed'::text])) OR ((approved_by IS NOT NULL) AND (approved_at IS NOT NULL))))`
- `purchase_orders_entity_vat_ck`: `((entity_vat_number ~ '^3[0-9]{13}3$'::text))`
- `purchase_orders_segregation_ck`: `(((approved_by IS NULL) OR (approved_by <> prepared_by)))`
- `purchase_orders_source_ck`: `(((rfq_id IS NOT NULL) OR (exception_id IS NOT NULL)))`
- `purchase_orders_status_ck`: `((status = ANY (ARRAY['draft'::text, 'prepared'::text, 'approved'::text, 'sent'::text, 'acknowledged'::text, 'partially_received'::text, 'received'::text, 'closed'::text, 'cancelled'::text])))`
- `purchase_orders_supplier_vat_ck`: `((supplier_vat_number ~ '^3[0-9]{13}3$'::text))`
- `purchase_orders_version_ck`: `(((version >= 1) AND ((version = 1) = (supersedes_po_id IS NULL))))`

**الفهارس:**
- `btree (branch_id, status)`
- `فريد btree (po_no, version)`
- `btree (supplier_id)`

**محفّزات:** `trg_purchase_orders_freeze` (BEFORE UPDATE)، `trg_purchase_orders_guard` (BEFORE INSERT)، `trg_purchase_orders_updated_at` (BEFORE UPDATE)

### supplier_invoice_lines

بنود فاتورة المورد وتصنيفها

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `invoice_id` | bigint | لا |  | FK | `supplier_invoices.id` (CASCADE) |
| `po_line_id` | bigint | نعم |  | FK | `purchase_order_lines.id` (NO ACTION) |
| `item_id` | bigint | نعم |  | FK | `items.id` (NO ACTION) |
| `description` | text | لا |  |  |  |
| `quantity` | numeric(14,3) | لا |  |  |  |
| `unit_price_halalas` | bigint | لا |  |  |  |
| `vat_rate` | numeric(6,3) | لا | `15` |  |  |
| `net_halalas` | bigint | نعم | مولَّد: `(round((quantity * (unit_price_halalas)::numeric)))::bigint` |  |  |
| `vat_halalas` | bigint | نعم | مولَّد: `(round(((round((quantity * (unit_price_halalas)::numeric)) * vat_rate) / (100)::numeric)))::bigint` |  |  |
| `classification` | text | لا | `'expense'::text` |  |  |

**قيود التحقق:**
- `supplier_invoice_lines_amounts_ck`: `(((quantity > (0)::numeric) AND (unit_price_halalas >= 0) AND ((vat_rate >= (0)::numeric) AND (vat_rate <= (100)::numeric))))`
- `supplier_invoice_lines_class_ck`: `((classification = ANY (ARRAY['expense'::text, 'stock'::text, 'asset'::text])))`

### supplier_invoices

فواتير الموردين؛ تمنع القاعدة تكرار رقم الفاتورة لنفس المورد

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `supplier_id` | bigint | لا |  | FK | `suppliers.id` (NO ACTION) |
| `supplier_invoice_no` | text | لا |  |  |  |
| `supplier_vat_number` | text | لا |  |  |  |
| `po_id` | bigint | نعم |  | FK | `purchase_orders.id` (NO ACTION) |
| `branch_id` | bigint | لا |  | FK | `branches.id` (NO ACTION) |
| `invoice_date` | date | لا |  |  |  |
| `net_halalas` | bigint | لا |  |  |  |
| `vat_halalas` | bigint | لا |  |  |  |
| `gross_halalas` | bigint | نعم | مولَّد: `(net_halalas + vat_halalas)` |  |  |
| `status` | text | لا | `'received'::text` |  |  |
| `match_result` | jsonb | نعم |  |  |  |
| `matched_at` | timestamptz | نعم |  |  |  |
| `approved_by` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `created_by` | int | لا |  | FK | `org_members.id` (NO ACTION) |
| `created_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `supplier_invoices_amounts_ck`: `(((net_halalas >= 0) AND (vat_halalas >= 0)))`
- `supplier_invoices_approved_ck`: `(((status <> ALL (ARRAY['approved'::text, 'paid'::text])) OR (approved_by IS NOT NULL)))`
- `supplier_invoices_status_ck`: `((status = ANY (ARRAY['received'::text, 'matched'::text, 'mismatch'::text, 'approved'::text, 'paid'::text, 'disputed'::text])))`
- `supplier_invoices_vat_ck`: `((supplier_vat_number ~ '^3[0-9]{13}3$'::text))`

**الفهارس:**
- `فريد btree (supplier_id, supplier_invoice_no)`
- `btree (po_id)`

### supplier_payments

مدفوعات الموردين

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `supplier_invoice_id` | bigint | لا |  | FK | `supplier_invoices.id` (NO ACTION) |
| `amount_halalas` | bigint | لا |  |  |  |
| `paid_on` | date | لا |  |  |  |
| `method` | text | لا |  |  |  |
| `reference` | text | نعم |  |  |  |
| `status` | text | لا | `'pending_otp'::text` |  |  |
| `paid_by` | int | لا |  | FK | `org_members.id` (NO ACTION) |
| `confirmed_at` | timestamptz | نعم |  |  |  |

**قيود التحقق:**
- `supplier_payments_amount_ck`: `((amount_halalas > 0))`
- `supplier_payments_method_ck`: `((method = ANY (ARRAY['bank_transfer'::text, 'cheque'::text, 'cash'::text])))`
- `supplier_payments_status_ck`: `((status = ANY (ARRAY['pending_otp'::text, 'confirmed'::text, 'reversed'::text])))`

## الأمان والهوية والحضور

المخطط: `er/security.mmd` (و`er/security.svg` عند التوليد).

### audit_events

سجل المراجعة المتسلسل بالبصمات؛ إضافة فقط

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `occurred_at` | timestamptz | لا | `now()` |  |  |
| `actor_member_id` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `actor_role` | text | نعم |  |  |  |
| `branch_id` | bigint | نعم |  | FK | `branches.id` (NO ACTION) |
| `action` | text | لا |  |  |  |
| `subject_type` | text | لا |  |  |  |
| `subject_id` | bigint | نعم |  |  |  |
| `subject_no` | text | نعم |  |  |  |
| `before_state` | jsonb | نعم |  |  |  |
| `after_state` | jsonb | نعم |  |  |  |
| `reason` | text | نعم |  |  |  |
| `result` | text | لا | `'success'::text` |  |  |
| `otp_challenge_id` | uuid | نعم |  | FK | `otp_challenges.id` (NO ACTION) |
| `otp_sent_at` | timestamptz | نعم |  |  |  |
| `otp_verified_at` | timestamptz | نعم |  |  |  |
| `ip_sent` | inet | نعم |  |  |  |
| `ip_verified` | inet | نعم |  |  |  |
| `user_agent` | text | نعم |  |  |  |
| `content_hash` | text | نعم |  |  |  |
| `prev_hash` | text | نعم |  |  |  |
| `row_hash` | text | لا | `''::text` |  |  |

**قيود التحقق:**
- `audit_events_result_ck`: `((result = ANY (ARRAY['success'::text, 'failure'::text, 'denied'::text, 'expired'::text])))`

**الفهارس:**
- `btree (actor_member_id, occurred_at)`
- `btree (subject_type, subject_id, occurred_at)`
- `btree (occurred_at)`

**محفّزات:** `trg_audit_events_append_only` (BEFORE UPDATE/DELETE)، `trg_audit_events_chain` (BEFORE INSERT)

### identity_cards

البطاقات الرقمية والفيزيائية برمز معتّم ولا يُخزَّن إلا بصمته

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `token_hash` | text | لا |  | UK |  |
| `holder_type` | text | لا |  |  |  |
| `holder_id` | bigint | لا |  |  |  |
| `card_type` | text | لا | `'nfc'::text` |  |  |
| `status` | text | لا | `'active'::text` |  |  |
| `key_version` | int | لا | `1` |  |  |
| `issued_by` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `issued_at` | timestamptz | لا | `now()` |  |  |
| `revoked_at` | timestamptz | نعم |  |  |  |
| `revoked_reason` | text | نعم |  |  |  |

**قيود التحقق:**
- `identity_cards_holder_ck`: `((holder_type = ANY (ARRAY['student'::text, 'employee'::text, 'instructor'::text])))`
- `identity_cards_revoked_ck`: `(((status = 'active'::text) OR (revoked_at IS NOT NULL)))`
- `identity_cards_status_ck`: `((status = ANY (ARRAY['active'::text, 'suspended'::text, 'revoked'::text, 'lost'::text])))`
- `identity_cards_type_ck`: `((card_type = ANY (ARRAY['nfc'::text, 'qr'::text, 'virtual'::text])))`

**الفهارس:**
- `فريد btree (holder_type, holder_id) WHERE (status = 'active'::text)`
- `فريد btree (token_hash)`

### local_accounts

حسابات الدخول المحلية: بريد وبصمة كلمة المرور (scrypt) بلا مزود هوية خارجي

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `email` | text | لا |  |  |  |
| `password_hash` | text | لا |  |  |  |
| `must_change` | bool | لا | `false` |  |  |
| `failed_attempts` | int | لا | `0` |  |  |
| `locked_until` | timestamptz | نعم |  |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |
| `last_login_at` | timestamptz | نعم |  |  |  |

**قيود التحقق:**
- `local_accounts_email_ck`: `((email ~~ '%_@_%'::text))`

**الفهارس:**
- `فريد btree (lower(email))`

### local_sessions

جلسات المتصفح؛ تُخزَّن بصمة الرمز فقط ولا يُخزَّن الرمز نفسه

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `token_hash` | text | لا |  | PK |  |
| `account_id` | bigint | لا |  | FK | `local_accounts.id` (CASCADE) |
| `created_at` | timestamptz | لا | `now()` |  |  |
| `expires_at` | timestamptz | لا |  |  |  |
| `ip` | inet | نعم |  |  |  |
| `user_agent` | text | نعم |  |  |  |

**الفهارس:**
- `btree (account_id)`
- `btree (expires_at)`

### login_codes

رموز الدخول المرسلة بالبريد: بصمة الرمز فقط، صالحة مرة واحدة ولمدة قصيرة

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | uuid | لا | `gen_random_uuid()` | PK |  |
| `email` | text | لا |  |  |  |
| `code_hmac` | text | لا |  |  |  |
| `status` | text | لا | `'pending'::text` |  |  |
| `attempts` | int | لا | `0` |  |  |
| `requested_at` | timestamptz | لا | `now()` |  |  |
| `expires_at` | timestamptz | لا |  |  |  |
| `used_at` | timestamptz | نعم |  |  |  |
| `requested_ip` | inet | نعم |  |  |  |
| `used_ip` | inet | نعم |  |  |  |

**قيود التحقق:**
- `login_codes_status_ck`: `((status = ANY (ARRAY['pending'::text, 'used'::text, 'expired'::text, 'failed'::text])))`
- `login_codes_used_ck`: `(((status = 'used'::text) = (used_at IS NOT NULL)))`

**الفهارس:**
- `btree (lower(email), requested_at)`

### otp_challenges

رموز التأكيد: بصمة الرمز مرتبطة بالمستخدم والإجراء والمستند، مع زمن الإرسال والتصديق وعنوان IP

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | uuid | لا | `gen_random_uuid()` | PK |  |
| `member_id` | int | لا |  | FK | `org_members.id` (NO ACTION) |
| `action` | text | لا |  |  |  |
| `subject_type` | text | لا |  |  |  |
| `subject_id` | bigint | نعم |  |  |  |
| `subject_hash` | text | لا |  |  |  |
| `code_hmac` | text | لا |  |  |  |
| `channel` | text | لا | `'email'::text` |  |  |
| `destination_masked` | text | لا |  |  |  |
| `status` | text | لا | `'pending'::text` |  |  |
| `attempts` | int | لا | `0` |  |  |
| `max_attempts` | int | لا | `5` |  |  |
| `sent_at` | timestamptz | لا | `now()` |  |  |
| `expires_at` | timestamptz | لا |  |  |  |
| `verified_at` | timestamptz | نعم |  |  |  |
| `consumed_at` | timestamptz | نعم |  |  |  |
| `sent_ip` | inet | نعم |  |  |  |
| `verified_ip` | inet | نعم |  |  |  |
| `sent_user_agent` | text | نعم |  |  |  |
| `verified_user_agent` | text | نعم |  |  |  |

**قيود التحقق:**
- `otp_challenges_attempts_ck`: `(((attempts >= 0) AND (attempts <= max_attempts)))`
- `otp_challenges_channel_ck`: `((channel = ANY (ARRAY['email'::text, 'sms'::text, 'app'::text, 'totp'::text])))`
- `otp_challenges_consumed_ck`: `(((consumed_at IS NULL) OR (status = 'verified'::text)))`
- `otp_challenges_expiry_ck`: `((expires_at > sent_at))`
- `otp_challenges_status_ck`: `((status = ANY (ARRAY['pending'::text, 'verified'::text, 'expired'::text, 'failed'::text, 'cancelled'::text])))`
- `otp_challenges_verified_ck`: `(((status = 'verified'::text) = (verified_at IS NOT NULL)))`

**الفهارس:**
- `btree (member_id, sent_at)`
- `btree (subject_type, subject_id)`

### presence_events

حركات الدخول والخروج وحضور القاعات والحصص

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `card_id` | bigint | نعم |  | FK | `identity_cards.id` (NO ACTION) |
| `holder_type` | text | لا |  |  |  |
| `holder_id` | bigint | لا |  |  |  |
| `branch_id` | bigint | لا |  | FK | `branches.id` (NO ACTION) |
| `event_type` | text | لا |  |  |  |
| `room_id` | bigint | نعم |  | FK | `rooms.id` (NO ACTION) |
| `session_id` | bigint | نعم |  | FK | `class_sessions.id` (NO ACTION) |
| `method` | text | لا |  |  |  |
| `device_member_id` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `verified` | bool | لا | `false` |  |  |
| `ip` | inet | نعم |  |  |  |
| `occurred_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `presence_events_holder_ck`: `((holder_type = ANY (ARRAY['student'::text, 'employee'::text, 'instructor'::text])))`
- `presence_events_method_ck`: `((method = ANY (ARRAY['nfc'::text, 'qr'::text, 'manual'::text, 'geofence'::text])))`
- `presence_events_type_ck`: `((event_type = ANY (ARRAY['check_in'::text, 'check_out'::text])))`

**الفهارس:**
- `btree (holder_type, holder_id, occurred_at)`
- `btree (session_id) WHERE (session_id IS NOT NULL)`

## الطلبات والمهام الداخلية

المخطط: `er/requests.mmd` (و`er/requests.svg` عند التوليد).

### internal_request_events

سجل أحداث الطلب (إضافة فقط): من فعل ماذا ومتى

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `request_id` | bigint | لا |  | FK | `internal_requests.id` (CASCADE) |
| `event_type` | text | لا |  |  |  |
| `actor_member_id` | int | نعم |  | FK | `org_members.id` (NO ACTION) |
| `note` | text | نعم |  |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |

**قيود التحقق:**
- `internal_request_events_type_ck`: `((event_type = ANY (ARRAY['created'::text, 'received'::text, 'responded'::text, 'closed'::text, 'cancelled'::text, 'reminder'::text])))`

**الفهارس:**
- `btree (request_id, created_at)`

**محفّزات:** `trg_internal_request_events_append_only` (BEFORE UPDATE/DELETE)

### internal_requests

طلبات ومهام الإدارة من المدير إلى الموظف، بأربع مراحل زمنية يسجلها النظام: الإرسال، الاستقبال، الرد، الإغلاق

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | bigint | لا | هوية تلقائية | PK |  |
| `request_no` | text | لا |  | UK |  |
| `title` | text | لا |  |  |  |
| `description` | text | نعم |  |  |  |
| `request_type` | text | لا | `'other'::text` |  |  |
| `priority` | text | لا | `'normal'::text` |  |  |
| `branch_id` | bigint | لا |  | FK | `branches.id` (NO ACTION) |
| `assignee_id` | bigint | لا |  | FK | `employees.id` (NO ACTION) |
| `created_by` | int | لا |  | FK | `org_members.id` (NO ACTION) |
| `due_at` | timestamptz | نعم |  |  |  |
| `status` | text | لا | `'sent'::text` |  |  |
| `sent_at` | timestamptz | لا | `now()` |  |  |
| `received_at` | timestamptz | نعم |  |  |  |
| `responded_at` | timestamptz | نعم |  |  |  |
| `closed_at` | timestamptz | نعم |  |  |  |
| `cancelled_at` | timestamptz | نعم |  |  |  |
| `response_text` | text | نعم |  |  |  |
| `response_links` | jsonb | لا | `'[]'::jsonb` |  |  |
| `close_note` | text | نعم |  |  |  |
| `closed_by` | int | نعم |  | FK | `org_members.id` (NO ACTION) |

**قيود التحقق:**
- `internal_requests_order_ck`: `((((received_at IS NULL) OR (received_at >= sent_at)) AND ((responded_at IS NULL) OR (received_at IS NULL) OR (responded_at >= received_at)) AND ((closed_at IS NULL) OR (responded_at IS NULL) OR (closed_at >= responded_at))))`
- `internal_requests_priority_ck`: `((priority = ANY (ARRAY['normal'::text, 'high'::text, 'urgent'::text])))`
- `internal_requests_stage_ck`: `((((status <> ALL (ARRAY['received'::text, 'responded'::text, 'closed'::text])) OR (received_at IS NOT NULL)) AND ((status <> ALL (ARRAY['responded'::text, 'closed'::text])) OR (responded_at IS NOT NULL)) AND ((status <> 'closed'::text) OR ((closed_at IS NOT NULL) AND (closed_by IS NOT NULL))) AND ((status <> 'cancelled'::text) OR (cancelled_at IS NOT NULL))))`
- `internal_requests_status_ck`: `((status = ANY (ARRAY['sent'::text, 'received'::text, 'responded'::text, 'closed'::text, 'cancelled'::text])))`
- `internal_requests_type_ck`: `((request_type = ANY (ARRAY['registration'::text, 'upload'::text, 'report'::text, 'other'::text])))`

**الفهارس:**
- `btree (assignee_id, status)`
- `btree (branch_id, status)`
- `btree (created_by)`
- `فريد btree (request_no)`

## الجداول القديمة (JSONB) التي يستخدمها التطبيق حاليًا

المخطط: `er/legacy.mmd` (و`er/legacy.svg` عند التوليد).

### cost_policies

سياسات التكلفة المعتمدة والمسودات

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `owner_id` | text | لا |  | PK |  |
| `draft` | jsonb | نعم |  |  |  |
| `draft_version` | int | لا | `0` |  |  |
| `approved` | jsonb | نعم |  |  |  |
| `approved_version` | int | نعم |  |  |  |
| `approved_by` | text | نعم |  |  |  |
| `approved_at` | timestamptz | نعم |  |  |  |
| `updated_by` | text | نعم |  |  |  |
| `updated_at` | timestamptz | لا | `now()` |  |  |

**محفّزات:** `trg_cost_policies_updated_at` (BEFORE UPDATE)

### education_audit

سجل تدقيق مبسط قديم

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | int | لا | `nextval('education_audit_id_seq'::regclass)` | PK |  |
| `owner_id` | text | لا |  |  |  |
| `actor_id` | text | نعم |  |  |  |
| `action` | text | لا |  |  |  |
| `record_id` | int | لا |  |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |

### education_records

السجلات القديمة لكل الكيانات (فروع، قاعات، طلاب، حصص...) بعمود JSONB

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | int | لا | `nextval('education_records_id_seq'::regclass)` | PK |  |
| `owner_id` | text | لا |  |  |  |
| `kind` | text | لا |  |  |  |
| `name` | text | لا |  |  |  |
| `branch_id` | int | نعم |  |  |  |
| `status` | text | لا |  |  |  |
| `details` | jsonb | لا |  |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |

**الفهارس:**
- `btree (owner_id, kind)`

### org_members

حسابات أعضاء المؤسسة وأدوارهم ونطاقهم (مرجع كل الجداول للمستخدمين)

| العمود | النوع | فارغ؟ | افتراضي / مولَّد | مفاتيح | يشير إلى |
|---|---|---|---|---|---|
| `id` | int | لا | `nextval('org_members_id_seq'::regclass)` | PK |  |
| `clerk_user_id` | text | نعم |  |  |  |
| `email` | text | لا |  |  |  |
| `role` | text | لا |  |  |  |
| `branch_id` | int | نعم |  |  |  |
| `linked_record_id` | int | نعم |  |  |  |
| `status` | text | لا |  |  |  |
| `invited_by` | text | نعم |  |  |  |
| `created_at` | timestamptz | لا | `now()` |  |  |
| `activated_at` | timestamptz | نعم |  |  |  |
| `revoked_at` | timestamptz | نعم |  |  |  |

**الفهارس:**
- `فريد btree (clerk_user_id) WHERE (status = 'active'::text)`
- `فريد btree (lower(email)) WHERE (status <> 'revoked'::text)`

## عروض التقارير

- `v_audit_workflow`
- `v_branch_budget_status`
- `v_consumption_monthly`
- `v_internal_requests`
- `v_purchase_period_usage`
- `v_reorder_status`
- `v_stock_balances`
- `v_student_ledger`
- `v_vat_purchases`
- `v_vat_sales`
