import {useEffect,useMemo,useState} from 'react';
import {X,RefreshCw,Clock3,ListChecks,History,Calculator} from 'lucide-react';
import {api,fmtHours,type Task,type Entry} from './api';

type Audit={id:string;actor:string;action:string;created_at:string;old_json?:string;new_json?:string};
type Estimate={id:string;activity:string;difficulty:string;activity_code:string;quantity:number;factor:number;ex_hours:number;qc_hours:number};
type PersonEffort={user_id:string;role:'EX'|'QC';hours:number};
type Detail={task:Task;actuals:PersonEffort[];entries:Entry[];estimates:Estimate[];history:Audit[]};
type Tab='overview'|'effort'|'estimation'|'history';
export function TaskWorkspace({taskId,onClose}:{taskId:string;onClose:()=>void}){
 const [tab,setTab]=useState<Tab>('overview'),[data,setData]=useState<Detail|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const load=()=>{setLoading(true);api<Detail>('/tasks/'+encodeURIComponent(taskId)+'/detail').then(d=>{setData(d);setError('')}).catch(e=>setError((e as Error).message)).finally(()=>setLoading(false));};
 useEffect(()=>{load();setTab('overview');},[taskId]);
 useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey);},[onClose]);
 const totals=useMemo(()=>{const ex=data?.actuals.filter(x=>x.role==='EX').reduce((n,x)=>n+x.hours,0)||0;
  const qc=data?.actuals.filter(x=>x.role==='QC').reduce((n,x)=>n+x.hours,0)||0;
  return {ex,qc,total:ex+qc};},[data]);
 const task=data?.task,est=(task?.estimated_ex||0)+(task?.estimated_qc||0);
 return <div className="wt-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <aside className="wt-task-drawer" role="dialog" aria-modal="true" aria-label={'Task details '+taskId}>
   <header className="wt-drawer-head"><div><small>TASK WORKSPACE</small><h2>{taskId}</h2><p>{task?.name||'Loading task details'}</p></div>
   <div className="wt-actions"><button className="icon-btn" aria-label="Refresh task" onClick={load}><RefreshCw size={17}/></button><button className="icon-btn" aria-label="Close task details" onClick={onClose}><X size={18}/></button></div></header>
   <nav className="wt-tabs" aria-label="Task details tabs">
   {([['overview','Overview',ListChecks],['effort','Effort',Clock3],['estimation','Estimation',Calculator],['history','History',History]] as const).map(([id,label,Icon])=>
    <button key={id} className={tab===id?'active':''} aria-current={tab===id?'page':undefined} onClick={()=>setTab(id)}><Icon size={13}/>{label}</button>)}</nav>
   <div className="wt-drawer-body">{error&&<div className="error-msg" role="alert">{error}</div>}{loading&&<p className="muted">Loading task data…</p>}
   {task&&tab==='overview'&&<div className="wt-detail-list">
    {([['Task name',task.name],['Project ID',task.ip_no],['Serial no.',task.serial_no],['Series',task.series],['Revision',task.revision],['Status',task.status],['Execution engineer',task.engineer],['QC engineer',task.qc_engineer],['Planned start',task.planned_start_date],['Actual start',task.start_date],['Planned completion',task.planned_completion_date],['Actual completion',task.completion_date],['Activity code',task.activity_code],['Mail subject',task.email_subject]] as const).map(([label,value])=><div key={label}><span>{label}</span><strong>{value||'—'}</strong></div>)}
   </div>}
   {task&&tab==='effort'&&<>
    <div className="wt-kpi-grid">
    <div><small>ESTIMATED EX</small><strong>{fmtHours(task.estimated_ex)}h</strong></div><div><small>ESTIMATED QC</small><strong>{fmtHours(task.estimated_qc)}h</strong></div>
    <div><small>ACTUAL EX</small><strong>{fmtHours(totals.ex+task.actual_ex_baseline)}h</strong></div><div><small>ACTUAL QC</small><strong>{fmtHours(totals.qc+task.actual_qc_baseline)}h</strong></div>
    </div>
    <p className="wt-metric-summary">Variance: <strong>{est?fmtHours(totals.total+task.actual_ex_baseline+task.actual_qc_baseline-est)+' h':'No estimate'}</strong>. Historical baselines are kept separate from dated logs.</p>
    <h3>Effort by engineer</h3><div className="wt-detail-list">{data?.actuals.map((x,i)=><div key={i}><span>{x.user_id} · {x.role}</span><strong>{fmtHours(x.hours)}h</strong></div>)}{!data?.actuals.length&&<p>No dated effort yet.</p>}</div>
    <h3>Recent effort records</h3><div className="wt-detail-list">{data?.entries.slice(0,100).map(e=><div key={e.id}><span>{e.date} · {e.user_id} · {e.role}</span><strong>{fmtHours(e.hours)}h</strong></div>)}{!data?.entries.length&&<p>No entries.</p>}</div>
   </>}
   {task&&tab==='estimation'&&<>
    <div className="wt-kpi-grid"><div><small>EX ESTIMATE</small><strong>{fmtHours(task.estimated_ex)}h</strong></div><div><small>QC ESTIMATE</small><strong>{fmtHours(task.estimated_qc)}h</strong></div></div>
    <p className="muted">Estimate lines use saved rate × quantity × experience factor. Applying planned hours is an explicit action in Estimation & Lookup.</p>
    <div className="wt-detail-list">{data?.estimates.map(e=><div key={e.id}><span>{e.activity_code} · {e.difficulty} × {e.quantity} · factor {e.factor}</span><strong>{fmtHours(e.ex_hours)} EX / {fmtHours(e.qc_hours)} QC</strong></div>)}{!data?.estimates.length&&<p>No detailed estimate lines.</p>}</div>
   </>}
   {task&&tab==='history'&&<div className="wt-detail-list">{data?.history.map(x=><div key={x.id}><span>{x.created_at} · {x.actor}</span><strong>{x.action}</strong></div>)}{!data?.history.length&&<p>No recent shared-task history or insufficient access.</p>}</div>}
   </div>
  </aside></div>;
}
