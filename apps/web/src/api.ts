export interface EffortRate {id:string;activity:string;difficulty:string;activity_code:string;execution_hours:number;qc_hours:number;criteria:string;updated_at:string}
export interface WorkEstimate {id:string;task_id:string;rate_id:string;quantity:number;experience:string;factor:number;ex_hours:number;qc_hours:number;created_by:string;created_at:string}
export interface TrackingMark {user_id:string;scope:'cell'|'row'|'column';task_id:string;column_key:string;fill_color:string;text_color:string;pinned:number}
export interface Engineer {id:string;name:string;is_admin:number;active:number;created_at:string}
export interface Task {
 id:string;serial_no:string;ip_no:string;series:string;revision:string;name:string;email_subject:string;
 engineer:string;qc_engineer:string;estimated_ex:number;actual_ex_baseline:number;estimated_qc:number;
 actual_qc_baseline:number;rework_effort:string;status:string;planned_start_date:string;start_date:string;
 planned_completion_date:string;completion_date:string;activity_code:string;required_internal:string;
 self_qc_completion_date:string;internal_errors:number;flexibility:string;customer_approval_date:string;
 task_type:string;code_add:string;code_update:string;mu_execution:number;mu_qc:number;updated_at:string;
}
export const TRACKING_COLUMNS:{header:string;key:keyof Task|'total_estimated'|'total_actual';type:'text'|'number'|'date'|'calculated'}[]=[
 ['Serial no.','serial_no','text'],['Project ID','ip_no','text'],['Series','series','text'],['Revision','revision','text'],
 ['Task ID','id','text'],['Task Name','name','text'],['Mail Subject','email_subject','text'],
 ['Engineer','engineer','text'],['QC Engineer','qc_engineer','text'],
 ['Estimation Effort','estimated_ex','number'],['Actual effort','actual_ex_baseline','number'],
 ['Estimation time for QC','estimated_qc','number'],['QC effort','actual_qc_baseline','number'],
 ['Rework effort','rework_effort','text'],['Status','status','text'],
 ['Planned Start Date','planned_start_date','date'],['Actual Start Date','start_date','date'],
 ['Planned completion Date','planned_completion_date','date'],['Actual completion Date','completion_date','date'],
 ['Activity code','activity_code','text'],['Required Internal (Sent for Peer QC)','required_internal','text'],
 ['Task Completion date with Self QC','self_qc_completion_date','date'],['No of Internal Error','internal_errors','number'],
 ['Flexibility','flexibility','text'],['Customer Approval date','customer_approval_date','date'],
 ['Type of task','task_type','text'],['Code no. ADD','code_add','text'],['Code no. UPDATE','code_update','text'],
 ['Total Estimation Effort','total_estimated','calculated'],['Total Actual effort','total_actual','calculated'],
 ['MU-Execution','mu_execution','number'],['MU-QC','mu_qc','number']
].map(([header,key,type])=>({header:header!,key:key as keyof Task|'total_estimated'|'total_actual',type:type as 'text'|'number'|'date'|'calculated'}));

export interface Entry {id:string;user_id:string;date:string;task_id:string;kind:string;role:string;hours:number;note:string;created_at:string;updated_at:string}
export interface Overview {users:Engineer[];tasks:Task[];entries:Entry[];taskActuals:Record<string,{ex:number;qc:number}>;start:string;end:string;role:'admin'|'member'}
export interface ImportPreview {mode:'tasks'|'effort'|'workbook';rows:number;tasks:Task[];entries:Entry[];errors:string[];warnings:string[];engineers?:string[];reconciliation?:{newTasks:number;changedTasks:number;unchangedTasks:number;newEntries:number;changedEntries:number;identicalEntries:number;taskDiffs:Array<{task_id:string;field:string;existing:string;incoming:string}>}}
export const KINDS=['Task','Meeting/Training','Public Holiday','Full-day Leave','Half-day Leave - 1st','Half-day Leave - 2nd','Other'] as const;
export const STATUSES=['Not started','In progress','Sent to QC','Completed','On hold','Cancelled'] as const;
export async function api<T>(path:string,init:RequestInit={}):Promise<T>{
 const res=await fetch(`/api${path}`,{credentials:'include',...init,headers:{...(init.body instanceof FormData?{}:{'Content-Type':'application/json'}),'X-Requested-With':'aventics-timesheet',...init.headers}});
 if(!res.ok){let data:{error?:string}={};try{data=await res.json();}catch{}throw new Error(data.error||`HTTP ${res.status}`);}
 return res.json() as Promise<T>;
}
export async function download(path:string,fallback:string){
 const res=await fetch(`/api${path}`,{credentials:'include'});if(!res.ok)throw new Error(`Download failed: HTTP ${res.status}`);
 const blob=await res.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=fallback;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);
}
export async function upload<T>(path:string,file:File):Promise<T>{const form=new FormData();form.append('file',file);
 return api<T>(path,{method:'POST',body:form});}
export function sum(entries:Entry[],fn:(e:Entry)=>boolean=()=>true):number{return entries.filter(fn).reduce((n,e)=>n+e.hours,0);}
export function isoMonth(d:Date):string{return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
export function daysOfMonth(month:string):string[]{const [y,m]=month.split('-').map(Number);return Array.from({length:new Date(y!,m!,0).getDate()},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`);}
export function fmtHours(n:number):string{return Number.isInteger(n)?`${n}`:n.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');}

export function daysOfYear(year:number):string[]{return Array.from({length:(Date.UTC(year+1,0,1)-Date.UTC(year,0,1))/86400000},(_,i)=>{const date=new Date(Date.UTC(year,0,i+1));return date.toISOString().slice(0,10);});}