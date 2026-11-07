-- Arabic purpose of each table, stored in the database itself (visible in psql dt+, DBeaver, pgAdmin).
-- Source of truth: lib/db/scripts/table-comments.mjs (the ER generator fails if a table lacks an entry).
COMMENT ON TABLE branches IS 'الفروع (المركز الرئيسي والفروع)، ولكل فرع رقم ضريبي وحالة';
--> statement-breakpoint
COMMENT ON TABLE org_settings IS 'إعدادات المؤسسة (نسبة الضريبة، سياسة OTP، عدد العروض المطلوبة...)';
--> statement-breakpoint
COMMENT ON TABLE documents IS 'سجل المرفقات (عروض أسعار، فواتير، عقود) مع بصمة الملف ومفتاح التخزين';
--> statement-breakpoint
COMMENT ON TABLE document_sequences IS 'عدادات الترقيم المتسلسل للمستندات (PO-2026-000123) دون فجوات';
--> statement-breakpoint
COMMENT ON TABLE notifications IS 'صندوق الإشعارات داخل النظام (تنبيهات الحد الأدنى، الميزانية، الاعتماد)';
--> statement-breakpoint
COMMENT ON TABLE departments IS 'الأقسام الإدارية، عامة أو تابعة لفرع، بتدرج هرمي';
--> statement-breakpoint
COMMENT ON TABLE job_titles IS 'المسميات الوظيفية';
--> statement-breakpoint
COMMENT ON TABLE employees IS 'سجل الموظفين: الفرع والقسم والراتب والبيانات الشخصية';
--> statement-breakpoint
COMMENT ON TABLE leave_types IS 'أنواع الإجازات (سنوية، مرضية، اضطرارية...)';
--> statement-breakpoint
COMMENT ON TABLE leave_requests IS 'طلبات الإجازة؛ يمنع النظام تداخل إجازتين لنفس الموظف';
--> statement-breakpoint
COMMENT ON TABLE approval_delegations IS 'تفويض الصلاحيات (تقترحه الموارد البشرية ويعتمده المدير العام) بمدة محددة';
--> statement-breakpoint
COMMENT ON TABLE shifts IS 'ورديات الدوام وفترة السماح';
--> statement-breakpoint
COMMENT ON TABLE employee_shifts IS 'إسناد الورديات للموظفين بفترات صلاحية';
--> statement-breakpoint
COMMENT ON TABLE payroll_runs IS 'دورات الرواتب الشهرية لكل فرع (مسودة، معتمدة، مصروفة)';
--> statement-breakpoint
COMMENT ON TABLE payroll_lines IS 'بنود الرواتب لكل موظف؛ تُقفل بعد اعتماد الدورة';
--> statement-breakpoint
COMMENT ON TABLE electricity_meters IS 'عدادات الكهرباء الرئيسية والفرعية لكل فرع';
--> statement-breakpoint
COMMENT ON TABLE rooms IS 'القاعات والمعامل: النوع والمساحة والسعة وقدرة الأجهزة والعداد';
--> statement-breakpoint
COMMENT ON TABLE asset_categories IS 'تصنيفات الأصول بتدرج هرمي وعمر افتراضي';
--> statement-breakpoint
COMMENT ON TABLE assets IS 'الأصول والتجهيزات داخل القاعات: القيمة والشراء والإهلاك والحالة';
--> statement-breakpoint
COMMENT ON TABLE asset_maintenance IS 'جدولة الصيانة وسجلها وتكلفتها';
--> statement-breakpoint
COMMENT ON TABLE diplomas IS 'الدبلومات: المدة والساعات وشروط القبول والسعر (شامل/غير شامل الضريبة) مع صافٍ وإجمالي مولَّدين';
--> statement-breakpoint
COMMENT ON TABLE levels IS 'مستويات كل دبلوم';
--> statement-breakpoint
COMMENT ON TABLE subjects IS 'المواد: المستوى والسعر والساعات';
--> statement-breakpoint
COMMENT ON TABLE subject_prerequisites IS 'المتطلبات السابقة للمواد (مستوى أسبق في الدبلوم نفسه)';
--> statement-breakpoint
COMMENT ON TABLE students IS 'الطلاب: الفرع والدبلوم والمستوى والبيانات الشخصية وحساب البوابة';
--> statement-breakpoint
COMMENT ON TABLE student_subjects IS 'تسجيل الطالب في المواد وحالته فيها';
--> statement-breakpoint
COMMENT ON TABLE instructors IS 'المدربون: المؤهل وأجر الساعة والساعات الأسبوعية';
--> statement-breakpoint
COMMENT ON TABLE instructor_subjects IS 'المواد التي يقدمها كل مدرب';
--> statement-breakpoint
COMMENT ON TABLE instructor_evaluations IS 'تقييم أداء المدربين (التدريس، الالتزام، آراء الطلاب)';
--> statement-breakpoint
COMMENT ON TABLE session_recurrences IS 'أنماط الجدول الأسبوعي المتكرر';
--> statement-breakpoint
COMMENT ON TABLE class_sessions IS 'الحصص: القاعة والمدرب والوقت؛ تمنع قيود الاستبعاد حجز القاعة أو المدرب مرتين';
--> statement-breakpoint
COMMENT ON TABLE session_students IS 'الطلاب المسجلون في كل حصة؛ يتحقق المحفّز من السعة والتعارض';
--> statement-breakpoint
COMMENT ON TABLE attendance_records IS 'حضور الطلاب في الحصص (يدوي أو بالبطاقة)';
--> statement-breakpoint
COMMENT ON TABLE grades IS 'درجات الطلاب في المواد';
--> statement-breakpoint
COMMENT ON TABLE tax_rates IS 'نسب ضريبة القيمة المضافة وفئاتها وفترات سريانها';
--> statement-breakpoint
COMMENT ON TABLE sales_invoices IS 'فواتير المبيعات (قياسية أو مبسطة) بحقول جاهزة للفوترة الإلكترونية';
--> statement-breakpoint
COMMENT ON TABLE sales_invoice_lines IS 'بنود فواتير المبيعات، والضريبة والصافي مولَّدان';
--> statement-breakpoint
COMMENT ON TABLE installments IS 'أقساط الطلاب وتواريخ استحقاقها';
--> statement-breakpoint
COMMENT ON TABLE payments IS 'المبالغ المحصلة من الطلاب؛ تُؤكَّد برمز OTP وتتجمد وتُصحَّح بقيد عكسي';
--> statement-breakpoint
COMMENT ON TABLE payment_allocations IS 'توزيع الدفعات على الأقساط';
--> statement-breakpoint
COMMENT ON TABLE expense_categories IS 'فئات المصروفات (مع تمييز النثريات)';
--> statement-breakpoint
COMMENT ON TABLE expenses IS 'المصروفات التشغيلية المؤكَّدة؛ تتجمد بعد التأكيد';
--> statement-breakpoint
COMMENT ON TABLE utility_invoices IS 'فواتير الكهرباء: فاتورة واحدة لكل عداد وشهر';
--> statement-breakpoint
COMMENT ON TABLE branch_budgets IS 'الميزانية الشهرية لكل فرع (إجمالية أو لفئة) ونسبة التنبيه';
--> statement-breakpoint
COMMENT ON TABLE cost_report_snapshots IS 'لقطات تقارير التكلفة المحسوبة بسياسة معتمدة';
--> statement-breakpoint
COMMENT ON TABLE item_categories IS 'تصنيفات الأصناف';
--> statement-breakpoint
COMMENT ON TABLE units IS 'وحدات القياس';
--> statement-breakpoint
COMMENT ON TABLE items IS 'بطاقات الأصناف بكود تلقائي ونوع وطريقة تقييم';
--> statement-breakpoint
COMMENT ON TABLE warehouses IS 'المستودعات (مستودع لكل فرع)';
--> statement-breakpoint
COMMENT ON TABLE stock_levels IS 'الحد الأدنى والأقصى وكمية إعادة الطلب لكل صنف ومستودع';
--> statement-breakpoint
COMMENT ON TABLE stock_movements IS 'دفتر حركات المخزون (إضافة فقط)؛ الرصيد = مجموع الحركات ولا يسمح برصيد سالب';
--> statement-breakpoint
COMMENT ON TABLE stock_transfers IS 'مستندات النقل بين المستودعات';
--> statement-breakpoint
COMMENT ON TABLE stock_transfer_lines IS 'بنود النقل';
--> statement-breakpoint
COMMENT ON TABLE stock_counts IS 'الجرد الفعلي للمستودعات';
--> statement-breakpoint
COMMENT ON TABLE stock_count_lines IS 'بنود الجرد وفروقاته وأسبابها';
--> statement-breakpoint
COMMENT ON TABLE reorder_alerts IS 'تنبيهات الوصول للحد الأدنى؛ تنبيه مفتوح واحد لكل صنف ومستودع';
--> statement-breakpoint
COMMENT ON TABLE suppliers IS 'الموردون برقم ضريبي مُتحقَّق من شكله؛ لا يُعتمد مورد بلا رقم ضريبي';
--> statement-breakpoint
COMMENT ON TABLE supplier_categories IS 'تخصصات الموردين بحسب تصنيف الأصناف';
--> statement-breakpoint
COMMENT ON TABLE purchase_requests IS 'طلبات الشراء، من تنبيه المخزون أو يدويًا';
--> statement-breakpoint
COMMENT ON TABLE purchase_request_lines IS 'أصناف وكميات طلب الشراء';
--> statement-breakpoint
COMMENT ON TABLE rfqs IS 'طلبات عروض الأسعار وموعدها النهائي';
--> statement-breakpoint
COMMENT ON TABLE rfq_suppliers IS 'الموردون المدعوون لكل طلب عروض';
--> statement-breakpoint
COMMENT ON TABLE quotations IS 'عروض الأسعار المدخلة، عرض واحد لكل مورد';
--> statement-breakpoint
COMMENT ON TABLE quotation_lines IS 'أسعار بنود العرض، والصافي والضريبة مولَّدان';
--> statement-breakpoint
COMMENT ON TABLE quotation_evaluations IS 'تقييم العروض فنيًا وجودةً وماليًا';
--> statement-breakpoint
COMMENT ON TABLE procurement_exceptions IS 'استثناءات قاعدة الثلاثة عروض والشراء المباشر بسبب مكتوب واعتماد';
--> statement-breakpoint
COMMENT ON TABLE rfq_awards IS 'الترسية؛ تتطلب ثلاثة عروض، ومبررًا إن لم تكن الأقل سعرًا';
--> statement-breakpoint
COMMENT ON TABLE purchase_orders IS 'أوامر الشراء باسم الجهة؛ تتجمد بعد التجهيز، ولا يعتمدها من أعدّها';
--> statement-breakpoint
COMMENT ON TABLE purchase_order_lines IS 'بنود أمر الشراء';
--> statement-breakpoint
COMMENT ON TABLE goods_receipts IS 'محاضر استلام البضاعة';
--> statement-breakpoint
COMMENT ON TABLE goods_receipt_lines IS 'كميات الاستلام والمقبول والمرفوض ونتيجة الجودة';
--> statement-breakpoint
COMMENT ON TABLE supplier_invoices IS 'فواتير الموردين؛ تمنع القاعدة تكرار رقم الفاتورة لنفس المورد';
--> statement-breakpoint
COMMENT ON TABLE supplier_invoice_lines IS 'بنود فاتورة المورد وتصنيفها';
--> statement-breakpoint
COMMENT ON TABLE match_tolerances IS 'نسب التسامح في المطابقة الثلاثية للسعر والكمية';
--> statement-breakpoint
COMMENT ON TABLE supplier_payments IS 'مدفوعات الموردين';
--> statement-breakpoint
COMMENT ON TABLE purchase_limits IS 'سقوف الشراء الأسبوعية والشهرية (من المدير العام)';
--> statement-breakpoint
COMMENT ON TABLE direct_purchase_policies IS 'شروط مسار الشراء المباشر الصغير';
--> statement-breakpoint
COMMENT ON TABLE otp_challenges IS 'رموز التأكيد: بصمة الرمز مرتبطة بالمستخدم والإجراء والمستند، مع زمن الإرسال والتصديق وعنوان IP';
--> statement-breakpoint
COMMENT ON TABLE audit_events IS 'سجل المراجعة المتسلسل بالبصمات؛ إضافة فقط';
--> statement-breakpoint
COMMENT ON TABLE identity_cards IS 'البطاقات الرقمية والفيزيائية برمز معتّم ولا يُخزَّن إلا بصمته';
--> statement-breakpoint
COMMENT ON TABLE presence_events IS 'حركات الدخول والخروج وحضور القاعات والحصص';
--> statement-breakpoint
COMMENT ON TABLE education_records IS 'السجلات القديمة لكل الكيانات (فروع، قاعات، طلاب، حصص...) بعمود JSONB';
--> statement-breakpoint
COMMENT ON TABLE education_audit IS 'سجل تدقيق مبسط قديم';
--> statement-breakpoint
COMMENT ON TABLE org_members IS 'حسابات أعضاء المؤسسة وأدوارهم ونطاقهم (مرجع كل الجداول للمستخدمين)';
--> statement-breakpoint
COMMENT ON TABLE cost_policies IS 'سياسات التكلفة المعتمدة والمسودات';
