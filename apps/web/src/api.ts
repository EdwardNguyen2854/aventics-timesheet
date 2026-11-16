export interface Engineer {id:string;name:string;is_admin:number;active:number;created_at:string}
export interface Task {id:string;serial_no:string;ip_no:string;name:string;status:string;estimated_ex:number;estimated_qc:number;email_subject:string;start_date:string;completion_date:string;updated_at:string}
export interface Entry {id:string;user_id:string;date:string;task_id:string;kind:string;role:string;hours:number;note:string;created_at:string;updated_at:string}
export interface Overview {users:Engineer[];tasks:Task[];entries:Entry[];taskActuals:Record<string,{ex:number;qc:number}>;start:string;end:string;role:'admin'|'member'}
export interface ImportPreview {mode:'tasks'|'effort';rows:number;tasks:Task[];entries:Entry[];errors:string[];warnings:string[]}
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
