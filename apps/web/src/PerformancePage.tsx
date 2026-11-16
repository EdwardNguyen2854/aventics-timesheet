import {useEffect,useMemo,useState} from 'react';
import {api,fmtHours} from './api';
interface RecordRow{task_id:string;project_id:string;name:string;engineer:string;qc_engineer:string;status:string;estimated_ex:number;estimated_qc:number;actual_ex:number;actual_qc:number;estimated:number;actual:number;variance:number;variance_pct:number|null;remaining:number}
const pct=(n:number|null)=>n===null?'No estimate':(n>0?'+':'')+n.toFixed(1)+'%';
export function PerformancePage({revision}:{revision:number}){
 const [data,setData]=useState<RecordRow[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [project,setProject]=useState(''),[engineer,setEngineer]=useState(''),[status,setStatus]=useState('');
 useEffect(()=>{let live=true;setBusy(true);api<RecordRow[]>('/reports/variance').then(rows=>{if(live){setData(rows);setError('');}}).catch(e=>{if(live)setError((e as Error).message)}).finally(()=>{if(live)setBusy(false)});return()=>{live=false};},[revision]);
 const projects=[...new Set(data.map(r=>r.project_id).filter(Boolean))].sort();
 const engineers=[...new Set(data.map(r=>r.engineer).filter(Boolean))].sort();
 const statuses=[...new Set(data.map(r=>r.status).filter(Boolean))].sort();
 const filtered=useMemo(()=>data.filter(r=>(!project||r.project_id===project)&&(!engineer||r.engineer===engineer)&&(!status||r.status===status)),[data,project,engineer,status]);
 const totals=useMemo(()=>filtered.reduce((n,r)=>({estimated:n.estimated+r.estimated,actual:n.actual+r.actual,ex:n.ex+r.actual_ex,qc:n.qc+r.actual_qc,unestimated:n.unestimated+(r.estimated===0?1:0),overruns:n.overruns+(r.estimated>0&&r.actual>r.estimated*1.2?1:0)}),{estimated:0,actual:0,ex:0,qc:0,unestimated:0,overruns:0}),[filtered]);
 const top=filtered.filter(r=>r.actual>0||r.estimated>0).sort((a,b)=>b.actual-b.estimated-(a.actual-a.estimated)).slice(0,25);
 const scale=Math.max(1,...top.map(r=>Math.max(r.actual,r.estimated)));
 return <div className="wt-analytics">
 <div className="toolbar panel-toolbar"><div className="toolbar-left">
 <select className="input short" aria-label="Project filter" value={project} onChange={e=>setProject(e.target.value)}><option value="">All projects</option>{projects.map(x=><option key={x}>{x}</option>)}</select>
 <select className="input short" aria-label="Engineer filter" value={engineer} onChange={e=>setEngineer(e.target.value)}><option value="">All engineers</option>{engineers.map(x=><option key={x}>{x}</option>)}</select>
 <select className="input short" aria-label="Status filter" value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{statuses.map(x=><option key={x}>{x}</option>)}</select>
 </div><span className="subtle">{filtered.length} tasks {busy?'· Refreshing…':''}</span></div>
 {error&&<div className="error-msg" role="alert">{error}</div>}
 <div className="wt-kpi-grid wt-analytics-kpis">
 <div><small>ESTIMATED TOTAL</small><strong>{fmtHours(totals.estimated)}h</strong></div><div><small>ACTUAL TOTAL</small><strong>{fmtHours(totals.actual)}h</strong></div><div><small>VARIANCE</small><strong>{fmtHours(totals.actual-totals.estimated)}h</strong></div><div><small>OVER 120%</small><strong>{totals.overruns}</strong></div><div><small>NO ESTIMATE</small><strong>{totals.unestimated}</strong></div></div>
 <section className="panel"><div className="panel-header"><h2>Estimated vs actual effort</h2><span className="subtle">All-time · EX + QC · top 25 task variances</span></div>
 <div className="panel-body wt-variance-bars">{top.map(r=><div className="wt-variance-row" key={r.task_id}>
 <div className="wt-variance-label"><strong title={r.name}>{r.task_id}</strong><small>{r.project_id} · {r.status}</small></div>
 <div className="wt-variance-track" title={'Est. '+fmtHours(r.estimated)+' h · Actual '+fmtHours(r.actual)+' h'}>
 <div className="wt-estimate-bar" style={{width:r.estimated/scale*100+'%'}}/>
 <div className={'wt-actual-bar '+(r.estimated>0&&r.actual>r.estimated*1.2?'overrun':'')} style={{width:r.actual/scale*100+'%'}}/>
 </div><strong className="wt-variance-number">{pct(r.variance_pct)}</strong></div>)}{!top.length&&<p className="muted">No effort records match these filters.</p>}</div></section>
 <section className="panel"><div className="panel-header"><h2>Task variance details</h2><span className="subtle">Baseline + dated actuals; estimates never count as actuals</span></div>
 <div className="table-scroll"><table><thead><tr><th>Task ID</th><th>Project</th><th>EX est.</th><th>QC est.</th><th>EX actual</th><th>QC actual</th><th>Variance</th><th>Remaining</th></tr></thead><tbody>{filtered.slice(0,500).map(r=><tr key={r.task_id}><td className="mono">{r.task_id}</td><td>{r.project_id}</td><td className="num">{fmtHours(r.estimated_ex)}</td><td className="num">{fmtHours(r.estimated_qc)}</td><td className="num">{fmtHours(r.actual_ex)}</td><td className="num">{fmtHours(r.actual_qc)}</td><td className="num">{pct(r.variance_pct)}</td><td className="num">{fmtHours(r.remaining)}</td></tr>)}</tbody></table></div>
 </section></div>;
}
