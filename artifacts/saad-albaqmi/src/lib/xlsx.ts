/**
 * Minimal, dependency-free .xlsx writer and reader that runs in the browser.
 * Writer: one stored (uncompressed) ZIP of OOXML parts; right-to-left sheets, frozen header row, styled header, dropdown lists.
 * Reader: ZIP central directory + DecompressionStream("deflate-raw"); handles shared strings, inline strings, numbers and booleans.
 */
export type Cell = string | number | null | undefined;
export type SheetSpec = {
  name: string;
  rows: Cell[][];                       // rows[0] is the header
  widths?: number[];                    // characters
  idColumns?: number[];                 // 0-based columns shown with a grey fill (identifiers: do not edit)
  lists?: { column: number; values: string[] }[];   // dropdown lists for data rows
  hidden?: boolean;
  textColumns?: number[];               // force text (dates, national ids, IBAN) so Excel never reformats them
  title?: string;                       // plain-text sheet with a single wide column (instructions)
};

const enc = new TextEncoder();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const colName = (i: number) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) { crcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  const d = new Date(); const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1); const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name); const crc = crc32(f.data);
    const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true); lh.setUint32(18, f.data.length, true); lh.setUint32(22, f.data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, f.data);
    const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true); ch.setUint32(20, f.data.length, true); ch.setUint32(24, f.data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((a, p) => a + p.length, 0);
  const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)]; const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="12"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF233644"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFEDE8"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD6D3CC"/></left><right style="thin"><color rgb="FFD6D3CC"/></right><top style="thin"><color rgb="FFD6D3CC"/></top><bottom style="thin"><color rgb="FFD6D3CC"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function sheetXml(s: SheetSpec, listRefs: Map<string, string>): string {
  const id = new Set(s.idColumns ?? []); const text = new Set(s.textColumns ?? []);
  const rows = s.rows.map((row, r) => {
    const cells = row.map((v, c) => {
      const ref = `${colName(c)}${r + 1}`;
      const style = r === 0 ? 1 : id.has(c) ? 2 : text.has(c) ? 3 : 4;
      if (v == null || v === "") return `<c r="${ref}" s="${style}"/>`;
      if (typeof v === "number" && Number.isFinite(v) && !text.has(c)) return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
      return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}"${r === 0 ? ' ht="32" customHeight="1"' : ""}>${cells}</row>`;
  }).join("");
  const cols = (s.widths ?? []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const dv = (s.lists ?? []).map((l) => `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="قيمة غير مسموحة" error="اختر قيمة من القائمة" sqref="${colName(l.column)}2:${colName(l.column)}2000"><formula1>${esc(listRefs.get(`${s.name}|${l.column}`)!)}</formula1></dataValidation>`).join("");
  const view = s.title ? "" : '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0">${view}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/>${cols ? `<cols>${cols}</cols>` : ""}<sheetData>${rows}</sheetData>${dv ? `<dataValidations count="${(s.lists ?? []).length}">${dv}</dataValidations>` : ""}</worksheet>`;
}

export function buildXlsx(sheets: SheetSpec[]): Blob {
  // dropdown values live in a hidden sheet so long lists (all branches, all job titles) are not limited to 255 characters
  const listCols: string[][] = []; const listRefs = new Map<string, string>();
  for (const s of sheets) for (const l of s.lists ?? []) { const idx = listCols.push(l.values) - 1; listRefs.set(`${s.name}|${l.column}`, `'قوائم'!$${colName(idx)}$2:$${colName(idx)}$${Math.max(2, l.values.length + 1)}`); }
  const all = [...sheets];
  if (listCols.length) { const h = Math.max(...listCols.map((c) => c.length)); all.push({ name: "قوائم", hidden: true, rows: Array.from({ length: h + 1 }, (_, r) => listCols.map((c) => (r === 0 ? "قيم مسموحة" : c[r - 1] ?? ""))) }); }
  const files: { name: string; data: Uint8Array }[] = [
    { name: "[Content_Types].xml", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${all.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`) },
    { name: "_rels/.rels", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${all.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ""} r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${all.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${all.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: "xl/styles.xml", data: enc.encode(STYLES) },
    ...all.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s, listRefs)) })),
  ];
  return new Blob([zip(files) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const u8 = new Uint8Array(buf); const dv = new DataView(buf); const out = new Map<string, Uint8Array>();
  let eocd = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65_557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("الملف ليس بصيغة Excel (xlsx) صحيحة");
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true); const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("ملف Excel تالف");
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen)); p += 46 + nlen + elen + clen;
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true); const raw = u8.subarray(start, start + csize);
    if (!name.endsWith("/")) out.set(name, method === 0 ? raw : method === 8 ? await inflateRaw(raw) : (() => { throw new Error("طريقة ضغط غير مدعومة"); })());
  }
  return out;
}

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const parseXml = (u8: Uint8Array) => new DOMParser().parseFromString(new TextDecoder().decode(u8), "application/xml");
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/[^A-Z]/gi, "").toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/** Returns every visible sheet as a grid of strings (numbers are kept as their text form; empty cells are ""). */
export async function readXlsx(buf: ArrayBuffer): Promise<Map<string, string[][]>> {
  const files = await unzip(buf);
  const wb = files.get("xl/workbook.xml"); const rels = files.get("xl/_rels/workbook.xml.rels");
  if (!wb || !rels) throw new Error("الملف ليس مصنف Excel صحيحًا");
  const targets = new Map<string, string>(); for (const r of Array.from(parseXml(rels).getElementsByTagName("Relationship"))) targets.set(r.getAttribute("Id")!, r.getAttribute("Target")!);
  const shared: string[] = []; const ss = files.get("xl/sharedStrings.xml");
  if (ss) for (const si of Array.from(parseXml(ss).getElementsByTagNameNS(NS, "si"))) shared.push(Array.from(si.getElementsByTagNameNS(NS, "t")).map((t) => t.textContent ?? "").join(""));
  const out = new Map<string, string[][]>();
  for (const s of Array.from(parseXml(wb).getElementsByTagNameNS(NS, "sheet"))) {
    if (s.getAttribute("state") === "hidden" || s.getAttribute("state") === "veryHidden") continue;
    const target = targets.get(s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? s.getAttribute("r:id") ?? "");
    const data = target ? files.get(target.startsWith("/") ? target.slice(1) : `xl/${target}`) : undefined; if (!data) continue;
    const grid: string[][] = [];
    for (const row of Array.from(parseXml(data).getElementsByTagNameNS(NS, "row"))) {
      const r = Number(row.getAttribute("r")) - 1; const line: string[] = (grid[r] = grid[r] ?? []);
      for (const c of Array.from(row.getElementsByTagNameNS(NS, "c"))) {
        const t = c.getAttribute("t"); const v = c.getElementsByTagNameNS(NS, "v")[0]?.textContent ?? "";
        let value = "";
        if (t === "s") value = shared[Number(v)] ?? ""; else if (t === "inlineStr") value = Array.from(c.getElementsByTagNameNS(NS, "t")).map((x) => x.textContent ?? "").join("");
        else if (t === "b") value = v === "1" ? "TRUE" : "FALSE"; else value = v;
        line[colIndex(c.getAttribute("r") ?? "A1")] = value;
      }
    }
    out.set(s.getAttribute("name")!, Array.from(grid, (l) => Array.from(l ?? [], (x) => x ?? "")));
  }
  return out;
}

/** Excel serial date (days since 1899-12-30) -> ISO yyyy-mm-dd. */
export const serialToIso = (n: number) => new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
