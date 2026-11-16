import ExcelJS from 'exceljs';
import { ENTRY_KINDS, ROLES, TASK_STATUSES, validHours, validIsoDate, normalizeTaskId, safeSlug } from './domain.js';
import { type Entry, type Task, type TaskEffortRow } from './db.js';

type TaskImport=Omit<Task,'updated_at'>;
type EntryImport=Pick<Entry,'date'|'task_id'|'kind'|'role'|'hours'|'note'>&{user_id:string};
export interface ImportPreview { mode:'tasks'|'effort'; rows:number; tasks:TaskImport[]; entries:EntryImport[]; errors:string[];warnings:string[] }
const TASK_HEADERS=['Status','Serial No.','IP No.','Task Name','Task ID','Start Date','Completion Date','Estimated EX Effort','Estimated QC Effort','Email Subject'];
const EFFORT_HEADERS=['Date','Engineer','Task ID','Kind','Role','Hours','Note'];
function norm(s:string):string{return s.toLowerCase().replace(/[^a-z0-9]/g,'');}
function cellText(c:ExcelJS.Cell):string {
  const v=c.value;
  if(v===null||v===undefined)return '';
  if(typeof v==='object' && 'text' in v)return String(v.text).trim();
  if(typeof v==='object' && 'result' in v)return String(v.result??'').trim();
  if(v instanceof Date)return v.toISOString().slice(0,10);
  return String(v).trim();
}
function cellNumber(c:ExcelJS.Cell):number {const v=c.value;if(typeof v==='number')return v;const text=cellText(c).replace(/\s/g,'');return Number(text.includes(',')&&!text.includes('.')?text.replace(',','.'):text);}
function excelDate(cell:ExcelJS.Cell):string {
  const v=cell.value;if(v instanceof Date)return v.toISOString().slice(0,10);
  if(typeof v==='number'){const d=new Date(Math.round((v-25569)*86400000));return d.toISOString().slice(0,10);}
  const s=cellText(cell);if(validIsoDate(s))return s;
  // Full-year European Excel dates only; refuse ambiguous DD.MM without year.
  const m=s.match(/^(\d{1,2})[.\/]([0-9]{1,2})[.\/](\d{4})$/);
  if(m){const iso=`${m[3]}-${m[2]!.padStart(2,'0')}-${m[1]!.padStart(2,'0')}`;return validIsoDate(iso)?iso:s;}
  return s;
}
function mapping(ws:ExcelJS.Worksheet, aliases:Record<string,string[]>):{index:Record<string,number>,row:number} {
  for(let row=1;row<=Math.min(ws.rowCount,15);row++) {
    const lookup=new Map<string,number>();ws.getRow(row).eachCell({includeEmpty:false},(c,col)=>lookup.set(norm(cellText(c)),col));
    const index:Record<string,number>={};
    for(const [key,options] of Object.entries(aliases)){const match=options.map(norm).find(o=>lookup.has(o));if(match)index[key]=lookup.get(match)!;}
    if(index.id || (index.date && index.hours))return {index,row};
  }
  return {index:{},row:0};
}
export async function parseWorkbook(buffer:Buffer,mode:'tasks'|'effort',actorId:string,isAdmin:boolean):Promise<ImportPreview>{
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(buffer as any);
  const result:ImportPreview={mode,rows:0,tasks:[],entries:[],errors:[],warnings:[]};
  const ws=wb.getWorksheet(mode==='tasks'?'Tasks':'Effort') ?? wb.worksheets[0];
  if(!ws){result.errors.push('Workbook has no worksheets');return result;}
  const aliases=mode==='tasks'?{
    id:['Task ID','TaskID'],serial_no:['Serial No.','Serial No','Serial Number'],ip_no:['IP No.','IP No','IP Number'],name:['Task Name','Task'],status:['Status'],
    estimated_ex:['Estimated EX Effort','Estimated EX'],estimated_qc:['Estimated QC Effort','Estimated QC'],email_subject:['Email Subject'],start_date:['Start Date'],completion_date:['Completion Date']
  }:{date:['Date'],user_id:['Engineer','User','User ID'],task_id:['Task ID'],kind:['Kind','Category'],role:['Role'],hours:['Hours','Effort'],note:['Note','Description']};
  const found=mapping(ws,aliases),cols=found.index;
  if(!found.row || (mode==='tasks'?!cols.id:!(cols.date&&cols.hours))){result.errors.push(`Sheet "${ws.name}" must contain ${mode==='tasks'?'Task ID':'Date and Hours'} headers`);return result;}
  const get=(r:ExcelJS.Row,key:string)=>{const c=cols[key];return c?cellText(r.getCell(c)):'';};
  for(let i=found.row+1;i<=Math.min(ws.rowCount,found.row+10000);i++){
    const row=ws.getRow(i);if(row.actualCellCount===0)continue;
    if(mode==='tasks') {
      const id=normalizeTaskId(get(row,'id'));if(!id)continue;
      result.rows++;
      const estimated_ex=cols.estimated_ex?cellNumber(row.getCell(cols.estimated_ex)):0;
      const estimated_qc=cols.estimated_qc?cellNumber(row.getCell(cols.estimated_qc)):0;
      const status=get(row,'status')||'Not started';
      if(id.length>200 || !Number.isFinite(estimated_ex)||estimated_ex<0||!Number.isFinite(estimated_qc)||estimated_qc<0||!TASK_STATUSES.includes(status as any)){result.errors.push(`Row ${i}: invalid task ID, status or estimated effort`);continue;}
      const start_date=cols.start_date?excelDate(row.getCell(cols.start_date)):'';
      const completion_date=cols.completion_date?excelDate(row.getCell(cols.completion_date)):'';
      if((start_date&&!validIsoDate(start_date))||(completion_date&&!validIsoDate(completion_date))){result.errors.push(`Row ${i}: dates must be YYYY-MM-DD`);continue;}
      result.tasks.push({id,serial_no:get(row,'serial_no'),ip_no:get(row,'ip_no'),name:get(row,'name'),status,estimated_ex,estimated_qc,email_subject:get(row,'email_subject'),start_date,completion_date});
    } else {
      const date=excelDate(row.getCell(cols.date));const hours=cellNumber(row.getCell(cols.hours));
      if(!date&&!Number.isFinite(hours))continue;
      result.rows++;
      const kind=get(row,'kind')||'Task',role=get(row,'role')||'EX',task_id=get(row,'task_id');
      let user_id=get(row,'user_id')||actorId;
      try {user_id=safeSlug(user_id);}catch{result.errors.push(`Row ${i}: invalid engineer`);continue;}
      if(!isAdmin && user_id!==actorId){result.errors.push(`Row ${i}: cannot import another engineer's data`);continue;}
      if(!validIsoDate(date)||!validHours(hours)||!ENTRY_KINDS.includes(kind as any)||!ROLES.includes(role as any)){
        result.errors.push(`Row ${i}: invalid date, kind, role or hours (quarter-hour increments, 0.25–24)`);continue;
      }
      if(kind==='Task' && (!task_id || role==='NA')){result.errors.push(`Row ${i}: task work requires Task ID and EX/QC role`);continue;}
      if(kind!=='Task' && task_id){result.errors.push(`Row ${i}: non-task entries must have blank Task ID`);continue;}
      if(kind!=='Task' && role!=='NA'){result.errors.push(`Row ${i}: non-task entries must use NA role`);continue;}
      result.entries.push({date,user_id,task_id,kind,role,hours,note:get(row,'note')});
    }
  }
  if(ws.rowCount>found.row+10000)result.errors.push('Workbook exceeds 10,000 data rows');
  if(result.rows===0)result.warnings.push('No data rows found');
  return result;
}
function title(ws:ExcelJS.Worksheet,headers:string[]):void {
  ws.addRow(headers);ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
  ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF25313B'}};
  ws.getRow(1).height=28;
  ws.views=[{state:'frozen',ySplit:1}];
  ws.autoFilter={from:{row:1,column:1},to:{row:1,column:headers.length}};
  headers.forEach((_,i)=>{ws.getColumn(i+1).width=i===4?30:i===9?54:i===6?18:20;});
}
export function templateWorkbook():ExcelJS.Workbook{
  const wb=new ExcelJS.Workbook();wb.creator='Aventics Suite · Timesheet';
  const tasks=wb.addWorksheet('Tasks'),effort=wb.addWorksheet('Effort'),guide=wb.addWorksheet('Instructions');
  title(tasks,TASK_HEADERS);title(effort,EFFORT_HEADERS);
  tasks.addRow(['In progress','4032','ip1767','tm5_r12','4032-ip1767_tm5_r12','2026-11-01','','18.5','8','CAD project for TaskMaster']);
  effort.addRow(['2026-11-16','duynk','4032-ip1767_tm5_r12','Task','EX',4,'Example — delete before real import']);
  effort.addRow(['2026-11-16','duynk','','Meeting/Training','NA',1,'Example — delete before real import']);
  tasks.getColumn(1).eachCell({includeEmpty:false},(cell,i)=>{if(i>1)cell.dataValidation={type:'list',allowBlank:false,formulae:[`"${TASK_STATUSES.join(',')}"`]};});
  effort.getColumn(4).eachCell({includeEmpty:false},(cell,i)=>{if(i>1)cell.dataValidation={type:'list',allowBlank:false,formulae:[`"${ENTRY_KINDS.join(',')}"`]};});
  effort.getColumn(5).eachCell({includeEmpty:false},(cell,i)=>{if(i>1)cell.dataValidation={type:'list',allowBlank:false,formulae:['"EX,QC,NA"']};});
  guide.addRows([['AVENTICS TIMESHEET · EXCEL TEMPLATE'],['Import modes','Tasks and Effort are imported separately. Tasks first, then Effort.'],['Task ID','Unique identifier shared by task register and daily effort.'],['Engineer','Login ID (lowercase slug), e.g. duynk.'],['Date','Use YYYY-MM-DD (year mandatory).'],['Hours','Positive multiples of 0.25; no greater than 24 per row.'],['Kind','Task, Meeting/Training, Public Holiday, Full-day Leave, Half-day Leave - 1st, Half-day Leave - 2nd, Other.'],['Role','EX / QC for Task; NA for absence and other categories.'],['Imports','Preview validates workbook; Confirm writes/upserts. Re-importing same key replaces hours.'],['Legacy tracker','Task list can be imported with matching headers. Calendar grids must be flattened to one row per daily effort.'],['Security','Do not share confidential workbooks outside your internal network.']]);
  guide.getColumn(1).width=32;guide.getColumn(2).width=108;
  guide.getRow(1).font={bold:true,size:15,color:{argb:'FF007BC0'}};
  return wb;
}
export function safeExcelText(value:string):string {return /^[=+@\-]/.test(value)?`'${value}`:value;}
export function makeExport(mode:'tasks'|'effort', tasks:Task[],entries:Array<Entry&{user_id:string}>,breakdown:TaskEffortRow[]=[]):ExcelJS.Workbook{
  const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet(mode==='tasks'?'Tasks':'Effort');
  if(mode==='tasks') {
    const people=[...new Set(breakdown.map(b=>b.user_id))].sort();
    const headers=[...TASK_HEADERS,'Total Estimated Effort','Actual EX Effort','Actual QC Effort','Total Actual Effort',...people.flatMap(p=>[`Actual EX Effort - ${p}`,`Actual QC Effort - ${p}`])];
    title(ws,headers);
    const totals=new Map<string,{ex:number;qc:number}>();
    const individual=new Map<string,number>();
    for(const b of breakdown) {
      const t=totals.get(b.task_id)||{ex:0,qc:0};
      if(b.role==='EX')t.ex+=b.hours;else t.qc+=b.hours;
      totals.set(b.task_id,t);
      individual.set(`${b.task_id}\u001f${b.user_id}\u001f${b.role}`,b.hours);
    }
    for(const t of tasks){
      const actual=totals.get(t.id)||{ex:0,qc:0};
      ws.addRow([t.status,safeExcelText(t.serial_no),safeExcelText(t.ip_no),safeExcelText(t.name),safeExcelText(t.id),t.start_date,t.completion_date,t.estimated_ex,t.estimated_qc,safeExcelText(t.email_subject),t.estimated_ex+t.estimated_qc,actual.ex,actual.qc,actual.ex+actual.qc,...people.flatMap(p=>[individual.get(`${t.id}\u001f${p}\u001fEX`)||0,individual.get(`${t.id}\u001f${p}\u001fQC`)||0])]);
    }
    ws.getColumn(4).width=28;ws.getColumn(5).width=33;ws.getColumn(10).width=55;
  }
  else {
    title(ws,EFFORT_HEADERS);
    for(const e of entries)ws.addRow([e.date,e.user_id,safeExcelText(e.task_id),e.kind,e.role,e.hours,safeExcelText(e.note)]);
  }
  return wb;
}
