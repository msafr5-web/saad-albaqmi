# Excel sheets: bulk add and edit

Available on three pages, in a bar under the page title:

| Page | Sheets | Who can import |
|---|---|---|
| `/branches` الفروع | الفروع | roles allowed to write branches (General Manager) |
| `/rooms` القاعات والمعامل | القاعات والمعامل | roles allowed to write rooms (General Manager, branch manager, coordinator within their branch) |
| `/hr` الموارد البشرية | الموظفون، الأقسام | General Manager and HR officer |

Buttons: **تنزيل البيانات الحالية** (the sheet filled with today's records, ready to edit), **قالب فارغ** (headers, dropdowns and instructions only),
**استيراد من Excel** (upload, review every row, then confirm).

## How a sheet behaves
- First column (grey) is the identifier: **filled = update that record, blank = create a new one**. A blank cell on an update keeps the current value.
- Each workbook has a data sheet, a "تعليمات" sheet (rules and a description of every column) and a hidden "قوائم" sheet that feeds the dropdowns
  (status, type, branch, department, job title). Required columns carry `*` in the header.
- Dates are `2026-01-31` (Excel serial dates and `31/01/2026` are also understood). Arabic-Indic digits and thousands separators are accepted.
- Columns may be reordered; the headers (first row) are matched by text. Wrong or missing headers are reported before anything else.

## The preview is the safety net
Nothing is saved on upload. Every row is classified as **إضافة / تعديل / بلا تغيير / خطأ** with the reason (unknown identifier, duplicate name or
national id inside the file or in the system, unknown branch/department/job title, bad number/date/e-mail/IBAN, moving a room to another branch...).
Only **تنفيذ** applies the valid rows; rows with errors are skipped and can be fixed and re-uploaded.

## Same rules as the screens
Rows are applied one by one through the same API calls the forms use (`POST/PATCH /api/records`, `POST/PUT /api/hr/employees`, `POST/PUT /api/hr/departments`), so
permissions, business validation, branch scope, salary visibility and the audit trail are identical. A row the server rejects is reported in the dialog while the others go through.
(Limits: 1000 rows and 2 MB per file; the file is read in the browser, no spreadsheet library or upload endpoint is involved.)

## Columns
- **الفروع:** المعرّف، اسم الفرع*، الحالة (نشط/مخطط/مغلق)، المدينة*، الميزانية المخصصة (ريال)*.
- **القاعات والمعامل:** المعرّف، الفرع*، اسم القاعة*، الحالة (نشط/صيانة/مغلق)، النوع* (قاعة دراسية/معمل/ورشة/مكتب إداري)، المساحة (م²)*، السعة (مقعد)*، قدرة الأجهزة (ك.واط). A room cannot move to another branch.
- **الأقسام:** المعرّف، اسم القسم*، رمز القسم، الفرع (blank = general department).
- **الموظفون:** رقم الموظف (EMP-0001)، الاسم الكامل*، الفرع*، القسم، المسمى الوظيفي (existing titles only)، تاريخ التعيين*، الهوية/الإقامة، الجنسية، البريد الإلكتروني، الجوال، الآيبان، نوع التوظيف، الحالة، تاريخ انتهاء الخدمة (required when terminated)، الراتب الأساسي، بدل السكن، بدل النقل (SAR).

## Not included
Deleting records (remove them on the page), creating new job titles, and importing students, instructors or financial records.
