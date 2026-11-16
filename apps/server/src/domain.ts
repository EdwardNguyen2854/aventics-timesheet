/** Pure, shared timesheet rules. Independent of the database. */
export const ENTRY_KINDS = ['Task','Meeting/Training','Public Holiday','Full-day Leave','Half-day Leave - 1st','Half-day Leave - 2nd','Other'] as const;
export const ROLES = ['EX','QC','NA'] as const;
export const TASK_STATUSES = ['Not started','In progress','Sent to QC','Completed','On hold','Cancelled'] as const;
export type EntryKind = typeof ENTRY_KINDS[number];
export type Role = typeof ROLES[number];
export type TaskStatus = typeof TASK_STATUSES[number];
export function validIsoDate(s: unknown): s is string {
  if(typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10) === s;
}
export function validHours(n: unknown): n is number { return typeof n==='number' && Number.isFinite(n) && n > 0 && n <= 24 && Math.round(n*4) === n*4; }
export function normalizeTaskId(s: unknown): string { return String(s ?? '').trim(); }
export function monthBounds(month: string): {start:string,end:string} {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid month: use YYYY-MM');
  const [y,m]=month.split('-').map(Number);
  const end=new Date(Date.UTC(y!,m!,0)).toISOString().slice(0,10);
  return {start:`${month}-01`,end};
}
export function dateRange(start:string,end:string): string[] {
  if(!validIsoDate(start)||!validIsoDate(end)||end<start)throw new Error('Invalid date range');
  const days:string[]=[];
  for(let date=new Date(`${start}T00:00:00Z`);date.toISOString().slice(0,10)<=end;date.setUTCDate(date.getUTCDate()+1)) {
    days.push(date.toISOString().slice(0,10));if(days.length>366)throw new Error('Range exceeds one year');
  }
  return days;
}
export function safeSlug(value:string):string {
  const slug=value.trim().toLowerCase().replace(/[^a-z0-9_-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
  if(!slug || slug.length>64)throw new Error('Invalid username');
  return slug;
}
