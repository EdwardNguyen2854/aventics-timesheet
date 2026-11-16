import ExcelJS from 'exceljs';
import { ENTRY_KINDS, ROLES, TASK_STATUSES, validHours, validIsoDate, normalizeTaskId, safeSlug, monthBounds, dateRange } from './domain.js';
import {type Entry, type Task, type TaskEffortRow} from './db.js';

type TaskImport=Omit<Task,'updated_at'>;
type EntryImport=Pick<Entry,'date'|'task_id'|'kind'|'role'|'hours'|'note'>&{user_id:string};
export interface ImportPreview {mode:'tasks'|'effort'|'workbook';rows:number;tasks:TaskImport[];entries:EntryImport[];errors:string[];warnings:string[];present_task_fields?:string[]}
/** Exact 32-column Task Tracking layout. The two total columns and role actuals are computed in the app. */
export const TRACKING_COLUMNS:ReadonlyArray<{header:string;key:keyof TaskImport|'total_estimated'|'total_actual';kind:'text'|'number'|'date'|'calculated'}>=[
 {header:'Serial no.',key:'serial_no',kind:'text'},{header:'Project ID',key:'ip_no',kind:'text'},
 {header:'Series',key:'series',kind:'text'},{header:'Revision',key:'revision',kind:'text'},
 {header:'Task ID',key:'id',kind:'text'},{header:'Task Name',key:'name',kind:'text'},
 {header:'Mail Subject',key:'email_subject',kind:'text'},{header:'Engineer',key:'engineer',kind:'text'},
 {header:'QC Engineer',key:'qc_engineer',kind:'text'},
 {header:'Estimation Effort',key:'estimated_ex',kind:'number'},{header:'Actual effort',key:'actual_ex_baseline',kind:'number'},
 {header:'Estimation time for QC',key:'estimated_qc',kind:'number'},{header:'QC effort',key:'actual_qc_baseline',kind:'number'},
 {header:'Rework effort',key:'rework_effort',kind:'text'},{header:'Status',key:'status',kind:'text'},
 {header:'Planned Start Date',key:'planned_start_date',kind:'date'},{header:'Actual Start Date',key:'start_date',kind:'date'},
 {header:'Planned completion Date',key:'planned_completion_date',kind:'date'},
 {header:'Actual completion Date',key:'completion_date',kind:'date'},
 {header:'Activity code',key:'activity_code',kind:'text'},
 {header:'Required Internal (Sent for Peer QC)',key:'required_internal',kind:'text'},
 {header:'Task Completion date with Self QC',key:'self_qc_completion_date',kind:'date'},
 {header:'No of Internal Error',key:'internal_errors',kind:'number'},
 {header:'Flexibility',key:'flexibility',kind:'text'},
 {header:'Customer Approval date',key:'customer_approval_date',kind:'date'},
 {header:'Type of task',key:'task_type',kind:'text'},
 {header:'Code no. ADD',key:'code_add',kind:'text'},{header:'Code no. UPDATE',key:'code_update',kind:'text'},
 {header:'Total Estimation Effort',key:'total_estimated',kind:'calculated'},
 {header:'Total Actual effort',key:'total_actual',kind:'calculated'},
 {header:'MU-Execution',key:'mu_execution',kind:'number'},
 {header:'MU-QC',key:'mu_qc',kind:'number'},
];
const LEGACY_ALIASES:Record<string,string[]>={
 id:['Task ID'],serial_no:['Serial No.','Serial Number'],ip_no:['IP No.','Project ID'],name:['Task Name'],
 status:['Status'],estimated_ex:['Estimated EX Effort','Estimation Effort'],estimated_qc:['Estimated QC Effort','Estimation time for QC'],
 email_subject:['Email Subject','Mail Subject'],start_date:['Start Date','Actual Start Date'],completion_date:['Completion Date','Actual completion Date']
};
const DEFAULT_TASK:TaskImport={
 id:'',serial_no:'',ip_no:'',series:'',revision:'',name:'',email_subject:'',engineer:'',qc_engineer:'',
 estimated_ex:0,actual_ex_baseline:0,estimated_qc:0,actual_qc_baseline:0,rework_effort:'',status:'Not started',
 planned_start_date:'',start_date:'',planned_completion_date:'',completion_date:'',activity_code:'',required_internal:'',
 self_qc_completion_date:'',internal_errors:0,flexibility:'',customer_approval_date:'',task_type:'',code_add:'',code_update:'',
 mu_execution:0,mu_qc:0
};
function norm(s:string):string{return s.toLowerCase().replace(/[^a-z0-9]/g,'');}
function cellText(c:ExcelJS.Cell):string {
 const v=c.value;
 if(v===null||v===undefined)return '';
 if(v instanceof Date)return v.toISOString().slice(0,10);
 if(typeof v==='object'){
   if('result' in v)return String(v.result??'').trim();
   if('text' in v)return String(v.text).trim();
   if('richText' in v)return v.richText.map(x=>x.text).join('').trim();
 }
 return String(v).trim();
}
function cellNumber(c:ExcelJS.Cell):number {
 if(typeof c.value==='number')return c.value;
 const text=cellText(c).replace(/\s/g,'');
 return text?Number(text.includes(',')&&!text.includes('.')?text.replace(',','.'):text):0;
}
function excelDate(c:ExcelJS.Cell):string {
 const v=c.value;
 if(v===null||v===undefined||v==='')return '';
 if(v instanceof Date)return v.toISOString().slice(0,10);
 if(typeof v==='number'){
   if(!Number.isFinite(v)||v<1||v>2_958_465)return '__invalid_date__';
   return new Date(Math.round((v-25569)*86400000)).toISOString().slice(0,10);
 }
 const s=cellText(c);
 if(!s)return '';
 if(validIsoDate(String(s)))return s;
 if(/^\d{5}$/.test(s))return excelDate({value:Number(s)} as ExcelJS.Cell);
 const m=s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
 if(m){const iso=`${m[3]}-${m[2]!.padStart(2,'0')}-${m[1]!.padStart(2,'0')}`;return validIsoDate(iso)?iso:'__invalid_date__';}
 return '__invalid_date__';
}
function getHeader(ws:ExcelJS.Worksheet,required:string[]):{index:Map<string,number>;row:number}{
 for(let r=1;r<=Math.min(ws.rowCount,15);r++){
   const lookup=new Map<string,number>();ws.getRow(r).eachCell({includeEmpty:false},(c,col)=>lookup.set(norm(cellText(c)),col));
   if(required.every(h=>lookup.has(norm(h))))return {index:lookup,row:r};
 }
 return {index:new Map(),row:0};
}
function cell(wsRow:ExcelJS.Row,indices:Map<string,number>,header:string):ExcelJS.Cell|undefined {
 const index=indices.get(norm(header));return index?wsRow.getCell(index):undefined;
}
function parseTasks(ws:ExcelJS.Worksheet,result:ImportPreview):void{
 const found=getHeader(ws,['Task ID']);
 if(!found.row){result.errors.push('Task Tracking sheet requires a Task ID column');return;}
 const aliases:Record<string,string[]>={...LEGACY_ALIASES};
 for(const col of TRACKING_COLUMNS)if(col.kind!=='calculated')aliases[col.key]=[col.header,...(LEGACY_ALIASES[col.key]||[])];
 const idx=new Map<string,number>();
 for(const [key,names] of Object.entries(aliases))for(const n of names){const num=found.index.get(norm(n));if(num){idx.set(key,num);break;}}
 result.present_task_fields=[...idx.keys()];
 const unique=new Set<string>();
 for(let row=found.row+1;row<=Math.min(ws.rowCount,found.row+10_000);row++){
   const r=ws.getRow(row),id=normalizeTaskId(idx.has('id')?cellText(r.getCell(idx.get('id')!)):'');
   if(!id)continue;result.rows++;
   if(unique.has(id)){result.errors.push(`Row ${row}: duplicate Task ID ${id}`);continue;}unique.add(id);
   const t:TaskImport={...DEFAULT_TASK,id};let invalid=false;
   for(const col of TRACKING_COLUMNS){if(col.kind==='calculated'||col.key==='id')continue;
     const n=idx.get(col.key);if(!n)continue;
     const c=r.getCell(n);
     if(col.kind==='number'){
       const v=cellNumber(c);
       if(!Number.isFinite(v)||v<0){result.errors.push(`Row ${row}: invalid number for ${col.header}`);invalid=true;}
       else (t as unknown as Record<string,string|number>)[col.key]=v;
     }else if(col.kind==='date'){
       const v=excelDate(c);if(v&&!validIsoDate(v)){result.errors.push(`Row ${row}: invalid date for ${col.header}`);invalid=true;}
       else (t as unknown as Record<string,string|number>)[col.key]=v;
     }else (t as unknown as Record<string,string|number>)[col.key]=cellText(c);
   }
   // Older 'Tasks' file uses Start Date / Completion Date and status names from v0.1.
   t.status=t.status||'Not started';
   if(!TASK_STATUSES.includes(t.status as any)){result.errors.push(`Row ${row}: unsupported Status ${t.status}`);invalid=true;}
   if(id.length>200){result.errors.push(`Row ${row}: Task ID exceeds 200 characters`);invalid=true;}
   if(!invalid)result.tasks.push(t);
 }
}
function parseWideEffort(ws:ExcelJS.Worksheet,result:ImportPreview,actorId:string,isAdmin:boolean):boolean{
 const found=getHeader(ws,['Engineer','Status','Task ID','Role']);
 if(!found.row)return false;
 const days:Array<{index:number;date:string}>=[];
 ws.getRow(found.row).eachCell({includeEmpty:false},(c,col)=>{
   if(col<=4)return;const date=excelDate(c);
   if(date&&validIsoDate(date))days.push({index:col,date});
   else if(cellText(c))result.errors.push(`Column ${col}: date header must be DD.MM.YYYY or YYYY-MM-DD`);
 });
 if(!days.length){result.errors.push('Timesheet needs dated columns after Engineer / Status / Task ID / Role');return true;}
 const unique=new Set<string>();
 for(let i=found.row+1;i<=Math.min(ws.rowCount,found.row+10_000);i++){
   const row=ws.getRow(i);const display=cellText(cell(row,found.index,'Engineer')!);
   const task_id=cellText(cell(row,found.index,'Task ID')!),status=cellText(cell(row,found.index,'Status')!),roleRaw=cellText(cell(row,found.index,'Role')!).toUpperCase();
   if(!display&&!task_id&&!roleRaw)continue;
   let user_id='';try{user_id=safeSlug(display||actorId);}catch{result.errors.push(`Row ${i}: invalid Engineer`);continue;}
   if(!isAdmin&&user_id!==actorId){result.errors.push(`Row ${i}: cannot import another engineer`);continue;}
   const kind=task_id?'Task':status;
   const role=task_id?roleRaw:'NA';
   if(!ENTRY_KINDS.includes(kind as any)||!ROLES.includes(role as any)|| (task_id&&role==='NA')){
     result.errors.push(`Row ${i}: expected task with EX/QC or absence category in Status with blank Task ID`);continue;
   }
   for(const day of days){const v=row.getCell(day.index);const raw=cellText(v);if(!raw||raw==='0')continue;
     const hours=cellNumber(v);result.rows++;
     if(!validHours(hours)){result.errors.push(`Row ${i}, ${day.date}: hours must be positive quarter-hours up to 24`);continue;}
     const key=JSON.stringify([user_id,day.date,task_id,kind,role]);
     if(unique.has(key)){result.errors.push(`Row ${i}, ${day.date}: duplicated engineer/task/role/date cell`);continue;}unique.add(key);
     result.entries.push({date:day.date,user_id,task_id,kind,role,hours,note:''});
   }
 }
 if(ws.rowCount>found.row+10_000)result.errors.push('Workbook exceeds 10,000 rows');
 return true;
}
function parseDetailedEffort(ws:ExcelJS.Worksheet,result:ImportPreview,actorId:string,isAdmin:boolean):void{
 const found=getHeader(ws,['Date','Hours']);
 if(!found.row){result.errors.push('Effort sheet must have Date and Hours columns');return;}
 const unique=new Set<string>();
 for(let i=found.row+1;i<=Math.min(ws.rowCount,found.row+10_000);i++){
   const row=ws.getRow(i),get=(name:string)=>{const c=cell(row,found.index,name);return c?cellText(c):'';};
   const dateC=cell(row,found.index,'Date')!,date=excelDate(dateC),hours=cellNumber(cell(row,found.index,'Hours')!);
   if(!date&&!get('Task ID')&&!get('Engineer'))continue;result.rows++;
   const task_id=get('Task ID'),kind=get('Kind')||'Task',role=get('Role')||(task_id?'EX':'NA'),note=get('Note');
   let user_id='';try{user_id=safeSlug(get('Engineer')||actorId);}catch{result.errors.push(`Row ${i}: invalid Engineer`);continue;}
   if(!isAdmin&&user_id!==actorId){result.errors.push(`Row ${i}: cannot import another engineer`);continue;}
   if(!validIsoDate(date)||!validHours(hours)||!ENTRY_KINDS.includes(kind as any)||!ROLES.includes(role as any)||
     (kind==='Task'&&(!task_id||role==='NA'))||(kind!=='Task'&&(task_id||role!=='NA'))){
     result.errors.push(`Row ${i}: invalid Date, Task ID, Kind, Role or Hours`);continue;
   }
   const key=JSON.stringify([user_id,date,task_id,kind,role,note]);
   if(unique.has(key)){result.errors.push(`Row ${i}: duplicate effort record`);continue;}unique.add(key);
   result.entries.push({date,user_id,task_id,kind,role,hours,note});
 }
}
export async function parseWorkbook(buffer:Buffer,mode:'tasks'|'effort'|'workbook',actorId:string,isAdmin:boolean):Promise<ImportPreview>{
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(buffer as any);
 const result:ImportPreview={mode,rows:0,tasks:[],entries:[],errors:[],warnings:[]};

 const taskSheet=wb.getWorksheet('Task Tracking')||wb.getWorksheet('Tasks');
 const timeSheet=wb.getWorksheet('Timesheet')||wb.getWorksheet('Effort');
 if(mode==='workbook'){
   if(!taskSheet||!timeSheet){result.errors.push('Full import requires Task Tracking and Timesheet sheets');return result;}
   parseTasks(taskSheet,result);
   if(!parseWideEffort(timeSheet,result,actorId,isAdmin))parseDetailedEffort(timeSheet,result,actorId,isAdmin);
   if(taskSheet.rowCount>10_015||timeSheet.rowCount>10_015)result.errors.push('Workbook exceeds 10,000 data rows');
 }else{
   const ws=mode==='tasks'?(taskSheet||wb.worksheets[0]):(timeSheet||wb.worksheets[0]);
   if(!ws){result.errors.push('Workbook has no worksheets');return result;}
   if(mode==='tasks')parseTasks(ws,result);
   else if(!parseWideEffort(ws,result,actorId,isAdmin))parseDetailedEffort(ws,result,actorId,isAdmin);
   if(ws.rowCount>10_015)result.errors.push('Workbook exceeds 10,000 data rows');
 }
 if(result.rows===0)result.warnings.push('No data rows found');
 if(mode!=='tasks'&&timeSheet?.name==='Timesheet')result.warnings.push('Grid import has no Note column; existing detailed notes remain protected.');
 return result;
}
function title(ws:ExcelJS.Worksheet,headers:string[],frozen=0):void {
 ws.addRow(headers);
 ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
 ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF25313B'}};
 ws.getRow(1).height=29;
 ws.views=[{state:'frozen',xSplit:frozen,ySplit:1}];
 ws.autoFilter={from:{row:1,column:1},to:{row:1,column:headers.length}};
 headers.forEach((h,i)=>{ws.getColumn(i+1).width=i>=4&&/^\d{2}\.\d{2}\.\d{4}$/.test(h)?13:Math.min(42,Math.max(15,h.length+4));});
}
export function safeExcelText(value:string):string {return /^[=+@\-\t\r]/.test(value)?`'${value}`:value;}
function timesheetHeaders(month:string){const {start,end}=monthBounds(month);return ['Engineer','Status','Task ID','Role',...dateRange(start,end).map(d=>`${d.slice(8,10)}.${d.slice(5,7)}.${d.slice(0,4)}`)];}
export function templateWorkbook(month:string):ExcelJS.Workbook{
 const wb=new ExcelJS.Workbook();wb.creator='Aventics Suite · Timesheet';
 const tasks=wb.addWorksheet('Task Tracking'),effort=wb.addWorksheet('Timesheet'),guide=wb.addWorksheet('Instructions');
 title(tasks,TRACKING_COLUMNS.map(c=>c.header),5);title(effort,timesheetHeaders(month),4);
 tasks.addRow([3614,'ip1614','ug','r11','3614-ip1614','3614-ip1788_ug_r11','CAD project for Universal gripper, Series UG, update asm','DuyNK','LuatVV',16,16,8,8,'On hold','Completed',46084,46084,46094,46094,'Clkble','','',0,'Very Difficult',46121,'',49,0,24,24,16,8]);
 // Example row only: remove it before importing live data.
 effort.addRow(['DuyNK','Completed','3792-ip1614_series: nl4','EX',...dateRange(monthBounds(month).start,monthBounds(month).end).map(d=>[5,6,9].includes(Number(d.slice(-2)))?Number(d.slice(-2))===6?5:3:null)]);
 tasks.getRow(2).eachCell({includeEmpty:false},c=>{if(c.numFmt==='General'&&typeof c.value==='number')c.numFmt='0.##';});
 guide.addRows([
  ['AVENTICS TIMESHEET · TEMPLATE'],['Timesheet format','Engineer | Status | Task ID | Role | DD.MM.YYYY date columns for the selected month.'],
  ['Task Tracking','32 columns as requested. Actual EX/QC values are imported as historical baselines.'],
  ['Example rows','DELETE the example rows before importing real effort/tasks. Create matching engineer accounts first.'],
  ['Engineer','Use the login username; e.g. DuyNK is matched case-insensitively to duynk.'],
  ['Task row','Task ID must already exist in Task Tracking; Role is EX or QC.'],
  ['Non-project row','Leave Task ID blank; Status must equal Meeting/Training, Public Holiday, Full-day Leave, Half-day Leave - 1st, Half-day Leave - 2nd, or Other; Role NA.'],
  ['Values','Use 0.25-hour increments. Empty or 0 cells are skipped on import, not deletion.'],
  ['Date columns','DD.MM.YYYY with 4-digit year (e.g. 05.01.2026).'],
  ['Legacy compatibility','Import/Export still accepts older Tasks/Effort sheets with row-per-entry format.'],
  ['Security','Imported workbooks are validated before commit. Keep internal data off public repositories.']
 ]);
 guide.getColumn(1).width=32;guide.getColumn(2).width=112;
 guide.getRow(1).font={bold:true,size:15,color:{argb:'FF007BC0'}};
 return wb;
}
export function makeExport(mode:'tasks'|'effort',tasks:Task[],entries:Array<Entry&{user_id:string}>,breakdown:TaskEffortRow[]=[],month:string):ExcelJS.Workbook{
 const wb=new ExcelJS.Workbook();wb.creator='Aventics Suite · Timesheet';
 if(mode==='tasks'){
   const ws=wb.addWorksheet('Task Tracking');title(ws,TRACKING_COLUMNS.map(c=>c.header),5);
   const actuals=new Map<string,{ex:number;qc:number}>();
   for(const b of breakdown){const a=actuals.get(b.task_id)||{ex:0,qc:0};if(b.role==='EX')a.ex+=b.hours;else a.qc+=b.hours;actuals.set(b.task_id,a);}
   for(const t of tasks){const a=actuals.get(t.id)||{ex:0,qc:0};const totalEx=t.actual_ex_baseline+a.ex,totalQc=t.actual_qc_baseline+a.qc;
     ws.addRow(TRACKING_COLUMNS.map(c=>{
       if(c.key==='total_estimated')return t.estimated_ex+t.estimated_qc;
       if(c.key==='total_actual')return totalEx+totalQc;
       if(c.key==='actual_ex_baseline')return totalEx;
       if(c.key==='actual_qc_baseline')return totalQc;
       const value=t[c.key];return typeof value==='string'?safeExcelText(value):value;
     }));
   }
   return wb;
 }
 const ws=wb.addWorksheet('Timesheet');title(ws,timesheetHeaders(month),4);
 const dates=dateRange(monthBounds(month).start,monthBounds(month).end);
 const groups=new Map<string,{id:string;status:string;task:string;role:string;byDay:Map<string,number>}>();
 const taskById=new Map(tasks.map(t=>[t.id,t]));
 for(const e of entries){
   const status=e.kind==='Task'?(taskById.get(e.task_id)?.status||'Not started'):e.kind;
   const key=JSON.stringify([e.user_id,e.kind,e.task_id,e.role]);
   const g=groups.get(key)||{id:e.user_id,status,task:e.task_id,role:e.role,byDay:new Map<string,number>()};
   g.byDay.set(e.date,(g.byDay.get(e.date)||0)+e.hours);groups.set(key,g);
 }
 for(const g of [...groups.values()].sort((a,b)=>a.id.localeCompare(b.id)||a.task.localeCompare(b.task)))
   ws.addRow([safeExcelText(g.id),safeExcelText(g.status),safeExcelText(g.task),g.role,...dates.map(d=>g.byDay.get(d)||null)]);
 // Raw sheet retains notes & multiple entries: importing this workbook uses Timesheet view unless renamed.
 const detail=wb.addWorksheet('Effort Details');title(detail,['Date','Engineer','Task ID','Kind','Role','Hours','Note']);
 for(const e of entries)detail.addRow([e.date,safeExcelText(e.user_id),safeExcelText(e.task_id),e.kind,e.role,e.hours,safeExcelText(e.note)]);
 return wb;
}