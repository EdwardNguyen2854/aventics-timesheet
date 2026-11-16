import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent,type ClipboardEvent,type KeyboardEvent,type PointerEvent,type CSSProperties} from 'react';
import {LayoutDashboard,CalendarDays,ListChecks,Users,FileSpreadsheet,Settings,Plus,Download,Upload,ChevronLeft,ChevronRight,Search,RefreshCw,X,Trash2,Check,AlertTriangle,LogOut,Database,LockKeyhole,PanelLeftClose,PanelLeftOpen,RotateCcw,Calculator,Pin,Palette,BookOpen} from 'lucide-react';
import {api,download,upload,daysOfMonth,fmtHours,isoMonth,sum,KINDS,STATUSES,type Engineer,type Task,type Entry,type Overview,type ImportPreview,type EffortRate,type WorkEstimate,type TrackingMark,TRACKING_COLUMNS,daysOfYear} from './api';
import {TaskWorkspace} from './TaskWorkspace';
import {PerformancePage} from './PerformancePage';
import {WorkGrid,type GridCoordinate} from './WorkGrid';

type Page='overview'|'timesheet'|'tasks'|'estimation'|'performance'|'team'|'exchange'|'admin';
const NAV:[Page,string,typeof LayoutDashboard][]=[['overview','Overview',LayoutDashboard],['timesheet','Timesheet',CalendarDays],['tasks','Task Tracking',ListChecks],['estimation','Estimation & Lookup',Calculator],['performance','Performance Analytics',LayoutDashboard],['team','Team capacity',Users],['exchange','Import / Export',FileSpreadsheet],['admin','Administration',Settings]];
const emptyTask:Omit<Task,'updated_at'>={
 id:'',serial_no:'',ip_no:'',series:'',revision:'',name:'',email_subject:'',engineer:'',qc_engineer:'',
 estimated_ex:0,actual_ex_baseline:0,estimated_qc:0,actual_qc_baseline:0,rework_effort:'',status:'Not started',
 planned_start_date:'',start_date:'',planned_completion_date:'',completion_date:'',activity_code:'',required_internal:'',
 self_qc_completion_date:'',internal_errors:0,flexibility:'',customer_approval_date:'',task_type:'',code_add:'',code_update:'',
 mu_execution:0,mu_qc:0
};
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const labelDate=(date:string)=>new Date(`${date}T00:00:00`).toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short'});
const isWeekend=(date:string)=>[0,6].includes(new Date(`${date}T00:00:00`).getDay());
function Status({value}:{value:string}){const kind=value==='Completed'?'good':value==='Sent to QC'?'pending':value==='On hold'||value==='Cancelled'?'bad':'neutral';return <span className={`status ${kind}`}>{value}</span>;}
function Notice({message,onClose}:{message:string;onClose:()=>void}){return <div className="notice" role="status"><span>{message}</span><button className="icon-btn" onClick={onClose} aria-label="Dismiss"><X size={14}/></button></div>;}
function Login({onDone}:{onDone:(u:Engineer)=>void}){
 const [username,setUsername]=useState('admin'),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(ev:FormEvent){ev.preventDefault();setBusy(true);setError('');try{const data=await api<{user:Engineer}>('/auth/login',{method:'POST',body:JSON.stringify({username,password})});onDone(data.user);}catch(e){setError(String((e as Error).message));}finally{setBusy(false);}}
 return <div className="login-shell"><Supergraphic/><form className="login-card" onSubmit={submit}>
 <div className="brand login-brand"><div className="brand-slot"><img src="/bosch-logo.svg" alt="Bosch"/></div><div className="brand-copy"><span className="brand-kicker">AVENTICS SUITE</span><strong className="brand-product">WorkTrack</strong></div></div>
 <h1>Sign in</h1><p className="muted">Team effort tracking · Internal network</p>
 <label>Username<input className="input" autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} required/></label>
 <label>Password<input className="input" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
 {error&&<div className="error-msg">{error}</div>}<button className="btn primary" disabled={busy}>{busy?'Signing in…':'Sign in'}</button><small>Access is limited to authorized engineers.</small>
 </form></div>;
}
function Supergraphic({revision=0}:{revision?:number}){
 const [custom,setCustom]=useState(false);
 useEffect(()=>{let live=true;api<{custom:boolean}>('/branding/status').then(s=>{if(live)setCustom(s.custom);}).catch(()=>{if(live)setCustom(false);});return()=>{live=false;};},[revision]);
 return <div className="accent-strip" aria-hidden="true">{custom&&<img src={`/api/branding/supergraphic.svg?v=${revision}`} alt=""/>}</div>;
}
function OverviewInsights({overview}:{overview:Overview}){
 const entries=overview.entries,tasks=overview.tasks;
 const ex=sum(entries,e=>e.kind==='Task'&&e.role==='EX'),qc=sum(entries,e=>e.kind==='Task'&&e.role==='QC');
 const support=sum(entries,e=>['Meeting/Training','Other'].includes(e.kind)),leave=sum(entries,e=>e.kind.includes('Leave')||e.kind==='Public Holiday');
 const mix=[{name:'Execution',value:ex,cls:'blue'},{name:'QC',value:qc,cls:'teal'},{name:'Meetings / other',value:support,cls:'gray'},{name:'Leave / holiday',value:leave,cls:'amber'}];
 const total=ex+qc+support+leave;
 const weekly=new Map<string,{name:string;ex:number;qc:number;other:number}>();
 for(const entry of entries){
   const d=new Date(`${entry.date}T00:00:00Z`),day=d.getUTCDay();d.setUTCDate(d.getUTCDate()-(day===0?6:day-1));
   const name=`${String(d.getUTCDate()).padStart(2,'0')} ${d.toLocaleString('en',{month:'short',timeZone:'UTC'})}`;
   const group=weekly.get(name)||{name,ex:0,qc:0,other:0};
   if(entry.role==='EX'&&entry.kind==='Task')group.ex+=entry.hours;
   else if(entry.role==='QC'&&entry.kind==='Task')group.qc+=entry.hours;else group.other+=entry.hours;
   weekly.set(name,group);
 }
 const weeks=[...weekly.values()],maximum=Math.max(1,...weeks.map(w=>w.ex+w.qc+w.other));
 const projects=new Map<string,number>();
 for(const entry of entries){if(entry.kind!=='Task')continue;const id=tasks.find(t=>t.id===entry.task_id)?.ip_no||'Unassigned';projects.set(id,(projects.get(id)||0)+entry.hours);}
 const top=[...projects.entries()].sort((a,b)=>b[1]-a[1]).slice(0,7),maxProject=Math.max(1,...top.map(p=>p[1]));
 const byStatus=STATUSES.map(status=>({status,n:tasks.filter(t=>t.status===status).length})).filter(x=>x.n),maxStatus=Math.max(1,...byStatus.map(s=>s.n));
 return <div className="insights-grid">
   <section className="panel"><div className="panel-header"><h2>Effort composition</h2><span className="subtle">By category · hours</span></div><div className="panel-body insight-layout">
     <div className="donut" style={{background:total?`conic-gradient(var(--av-blue) 0 ${ex/total*100}%, var(--av-green) ${ex/total*100}% ${(ex+qc)/total*100}%, #bfc3c7 ${(ex+qc)/total*100}% ${(ex+qc+support)/total*100}%, var(--av-amber) ${(ex+qc+support)/total*100}% 100%)`:undefined}}>
       <div><strong>{fmtHours(total)}</strong><span>hours</span></div></div>
     <div className="insight-legend">{mix.map(x=><div key={x.name}><i className={`swatch ${x.cls}`}/><span>{x.name}</span><strong>{fmtHours(x.value)}h</strong></div>)}</div>
   </div></section>
   <section className="panel"><div className="panel-header"><h2>Weekly effort mix</h2><span className="subtle">EX / QC / support + leave</span></div><div className="panel-body compact-chart">
     {weeks.length?weeks.map(w=><div className="metric-row" key={w.name}><span>{w.name}</span><div className="metric-track stacked">
       <i className="metric-blue" style={{width:`${100*w.ex/maximum}%`}}/><i className="metric-green" style={{width:`${100*w.qc/maximum}%`}}/><i className="metric-gray" style={{width:`${100*w.other/maximum}%`}}/>
       </div><strong>{fmtHours(w.ex+w.qc+w.other)}h</strong></div>):<div className="empty">No effort logged this month.</div>}
   </div></section>
   <section className="panel"><div className="panel-header"><h2>Top projects by effort</h2><span className="subtle">This month · project ID</span></div><div className="panel-body compact-chart">
     {top.length?top.map(([project,h])=><div className="metric-row" key={project}><span title={project}>{project}</span><div className="metric-track"><i className="metric-blue" style={{width:`${100*h/maxProject}%`}}/></div><strong>{fmtHours(h)}h</strong></div>):<div className="empty">No task effort to compare.</div>}
   </div></section>
   <section className="panel"><div className="panel-header"><h2>Task status distribution</h2><span className="subtle">All registered tasks</span></div><div className="panel-body compact-chart">
     {byStatus.length?byStatus.map(x=><div className="metric-row" key={x.status}><span title={x.status}>{x.status}</span><div className="metric-track"><i className="metric-blue" style={{width:`${100*x.n/maxStatus}%`}}/></div><strong>{x.n}</strong></div>):<div className="empty">Import a Task Tracking workbook first.</div>}
   </div></section>
 </div>;
}
function KPIs({overview}:{overview:Overview}){
 const entries=overview.entries,tasks=overview.tasks;
 const ex=sum(entries,e=>e.kind==='Task'&&e.role==='EX'),qc=sum(entries,e=>e.kind==='Task'&&e.role==='QC');
 const support=sum(entries,e=>e.kind==='Meeting/Training'||e.kind==='Other'),leave=sum(entries,e=>e.kind.includes('Leave')||e.kind==='Public Holiday');
 return <div className="kpi-grid">
 {[["TOTAL LOGGED",fmtHours(ex+qc+support+leave)+' h',`${entries.length} effort records`],["EXECUTION",fmtHours(ex)+' h','EX · engineering effort'],["QUALITY CONTROL",fmtHours(qc)+' h','QC · review effort'],["NON-PROJECT",fmtHours(support+leave)+' h','Meetings, leave & holidays']].map(([label,val,hint])=><section className="kpi" key={label}><div className="kpi-label">{label}</div><strong>{val}</strong><div className="kpi-hint">{hint}</div></section>)}
 </div>;
}
function OverviewPage({overview,month,onGo}:{overview:Overview;month:string;onGo:(p:Page)=>void}){
 const days=daysOfMonth(month),entries=overview.entries,users=overview.users;
 const totals=days.map(d=>sum(entries,e=>e.date===d));const peak=Math.max(8*users.length,...totals,1);
 const summary=users.map(u=>{const mine=entries.filter(e=>e.user_id===u.id);return {u,ex:sum(mine,e=>e.kind==='Task'&&e.role==='EX'),qc:sum(mine,e=>e.kind==='Task'&&e.role==='QC'),other:sum(mine,e=>e.kind!=='Task'),total:sum(mine)};});
 const assigned=new Set(entries.filter(e=>e.task_id).map(e=>e.task_id));
 return <><KPIs overview={overview}/><div className="two-col">
 <section className="panel"><div className="panel-header"><h2>Daily effort distribution</h2><span className="subtle">Hours per day · {month}</span></div>
 <div className="chart-content"><div className="legend"><span><i className="swatch blue"/>Logged effort</span><span><i className="swatch gray"/>Weekend</span></div>
 <div className="bar-chart">{days.map((day,i)=><div className="bar-col" key={day} title={`${day}: ${fmtHours(totals[i]||0)} h`}><div className="bar-track"><div className={`bar ${isWeekend(day)?'weekend-bar':''}`} style={{height:`${((totals[i]||0)/peak)*100}%`}}/></div><span>{i%5===0||i===days.length-1?String(i+1).padStart(2,'0'):''}</span></div>)}</div>
 <div className="chart-foot"><span>01 {month}</span><span>{fmtHours(sum(entries))} hours recorded</span><span>{days.length} days</span></div></div></section>
 <section className="panel"><div className="panel-header"><h2>Workload snapshot</h2><span className="subtle">Active task register</span></div>
 <div className="snapshot"><div className="snapshot-row"><span>Tasks with effort this month</span><strong>{assigned.size}</strong></div><div className="snapshot-row"><span>Completed tasks</span><strong>{overview.tasks.filter(t=>t.status==='Completed').length}</strong></div><div className="snapshot-row"><span>Pending QC</span><strong>{overview.tasks.filter(t=>t.status==='Sent to QC').length}</strong></div><div className="snapshot-row"><span>Team members</span><strong>{users.length}</strong></div><button className="btn small" onClick={()=>onGo('tasks')}>Open Task Tracking <ChevronRight size={13}/></button></div></section>
 </div><OverviewInsights overview={overview}/><section className="panel"><div className="panel-header"><h2>Team summary</h2><button className="btn small" onClick={()=>onGo('team')}>View capacity <ChevronRight size={14}/></button></div><div className="table-scroll"><table><thead><tr><th>Engineer</th><th>EX effort</th><th>QC effort</th><th>Other / leave</th><th>Total logged</th><th>Distribution</th></tr></thead><tbody>{summary.map(x=><tr key={x.u.id}><td><strong>{x.u.name}</strong><div className="mono subtle">{x.u.id}</div></td><td className="num">{fmtHours(x.ex)}</td><td className="num">{fmtHours(x.qc)}</td><td className="num">{fmtHours(x.other)}</td><td className="num strong">{fmtHours(x.total)}</td><td style={{minWidth:160}}><div className="stacked-bar"><span style={{width:`${x.total?100*x.ex/x.total:0}%`}}/><span style={{width:`${x.total?100*x.qc/x.total:0}%`,opacity:.6}}/><span style={{width:`${x.total?100*x.other/x.total:0}%`,background:'#bfc3c7'}}/></div></td></tr>)}{!summary.length&&<tr><td colSpan={6} className="empty">Add engineers in Administration to get started.</td></tr>}</tbody></table></div></section></>;
}
function EntryEditor({overview,selectedUser,initialDate,onSaved,onClose}:{overview:Overview;selectedUser:string;initialDate:string;onSaved:()=>void;onClose:()=>void}){
 const [date,setDate]=useState(initialDate),[kind,setKind]=useState<string>('Task'),[role,setRole]=useState('EX'),[hours,setHours]=useState('8'),[taskId,setTaskId]=useState(''),[filter,setFilter]=useState(''),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[err,setErr]=useState('');
 const tasks=overview.tasks.filter(t=>`${t.id} ${t.name} ${t.ip_no}`.toLowerCase().includes(filter.toLowerCase())).slice(0,50);
 async function save(e:FormEvent){e.preventDefault();setErr('');setBusy(true);try{await api('/entries',{method:'POST',body:JSON.stringify({user_id:selectedUser,date,task_id:kind==='Task'?taskId:'',kind,role:kind==='Task'?role:'NA',hours:Number(hours),note})});onSaved();}catch(e){setErr((e as Error).message);}finally{setBusy(false);}}
 return <div className="modal-backdrop" onClick={onClose}><section className="modal" onClick={e=>e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Log effort"><div className="panel-header"><h2>Log daily effort</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={17}/></button></div><form onSubmit={save} className="form-body"><div className="form-row"><label>Engineer<input disabled className="input" value={selectedUser}/></label><label>Date<input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)} required/></label></div>
 <div className="form-row"><label>Category<select className="input" value={kind} onChange={e=>{setKind(e.target.value);setRole(e.target.value==='Task'?'EX':'NA');}}>{KINDS.map(k=><option key={k}>{k}</option>)}</select></label><label>Hours<input className="input" type="number" step="0.25" min="0.25" max="24" value={hours} onChange={e=>setHours(e.target.value)} required/></label></div>
 {kind==='Task'&&<><label>Task search<input className="input" placeholder="Search task ID, name or IP" value={filter} onChange={e=>setFilter(e.target.value)}/></label><label>Task<select className="input" value={taskId} onChange={e=>setTaskId(e.target.value)} required><option value="">Select task</option>{tasks.map(t=><option key={t.id} value={t.id}>{t.id} · {t.name}</option>)}</select></label><div className="form-row"><label>Role<select className="input" value={role} onChange={e=>setRole(e.target.value)}><option>EX</option><option>QC</option></select></label><div className="form-hint">EX = execution; QC = quality control</div></div></>}
 <label>Notes (optional)<textarea className="input textarea" rows={3} value={note} onChange={e=>setNote(e.target.value)} placeholder="What did you work on?"/></label>
 {err&&<div className="error-msg">{err}</div>}
 <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy?'Saving…':'Save effort'}</button></div></form></section></div>;
}
interface GridRow {key:string;userId:string;status:string;taskId:string;kind:string;role:string;entries:Entry[]}
function TimesheetPage({overview,selectedUser,onUser,refresh,flash,onOpenTask}:{overview:Overview;selectedUser:string;onUser:(id:string)=>void;refresh:()=>void;flash:(s:string)=>void;onOpenTask:(taskId:string)=>void}){
 const [year,setYear]=useState(new Date().getFullYear()),[period,setPeriod]=useState('all');
 const [yearEntries,setYearEntries]=useState<Entry[]>([]),[rangeBusy,setRangeBusy]=useState(false),[rangeError,setRangeError]=useState('');
 const days=useMemo(()=>period==='all'?daysOfYear(year):daysOfMonth(String(year)+'-'+period),[year,period]);
 useEffect(()=>{let active=true;setRangeBusy(true);
   api<{entries:Entry[]}>('/timesheet-range?year='+year+'&month='+period).then(r=>{if(active){setYearEntries(r.entries);setRangeError('');}})
   .catch(e=>{if(active)setRangeError((e as Error).message);})
   .finally(()=>{if(active)setRangeBusy(false);});
   return()=>{active=false;};},[year,period,overview.entries]);
 const users=overview.users,allView=selectedUser==='all',isAdmin=overview.role==='admin';
 const entries=useMemo(()=>yearEntries.filter(e=>allView||e.user_id===selectedUser),[yearEntries,allView,selectedUser]);
 const cells=useMemo(()=>{const map=new Map<string,Entry[]>();for(const e of entries){const key=JSON.stringify([e.user_id,e.kind,e.task_id,e.role,e.date]);const arr=map.get(key)||[];arr.push(e);map.set(key,arr);}return map;},[entries]);
 const daily=useMemo(()=>{const map=new Map<string,number>();for(const e of entries)map.set(e.date,(map.get(e.date)||0)+e.hours);return map;},[entries]);
 const heat=(h:number)=>h<=0?0:h<=2?1:h<=4?2:h<=6?3:h<=8?4:5;
 const [editMode,setEditMode]=useState(false),[active,setActive]=useState<{key:string;date:string;draft:string}|null>(null);
 const [entryModal,setEntryModal]=useState<{userId:string;date:string}|null>(null),[details,setDetails]=useState<{entries:Entry[];userId:string}|null>(null);
 const [search,setSearch]=useState(''),[err,setErr]=useState('');
 const [extraRows,setExtraRows]=useState<GridRow[]>([]),[newTask,setNewTask]=useState(''),[newKind,setNewKind]=useState('Task'),[newRole,setNewRole]=useState('EX'),[newPerson,setNewPerson]=useState('');
 const saving=useRef(new Set<string>());
 useEffect(()=>{setActive(null);setExtraRows([]);},[year,period,selectedUser]);
 const taskMap=useMemo(()=>new Map(overview.tasks.map(t=>[t.id,t])),[overview.tasks]);
 const userMap=useMemo(()=>new Map(users.map(u=>[u.id,u])),[users]);
 const makeKey=(userId:string,kind:string,taskId:string,role:string)=>JSON.stringify([userId,kind,taskId,role]);
 const rows=useMemo(()=>{
   const map=new Map<string,GridRow>();
   for(const e of entries){const key=makeKey(e.user_id,e.kind,e.task_id,e.role);
     const row=map.get(key)||{key,userId:e.user_id,status:e.kind,taskId:e.task_id,kind:e.kind,role:e.role,entries:[]};
     row.entries.push(e);map.set(key,row);
   }
   for(const row of extraRows)if((allView||row.userId===selectedUser)&&!map.has(row.key))map.set(row.key,row);
   return [...map.values()].map(row=>({...row,status:row.kind==='Task'?taskMap.get(row.taskId)?.status||'Unknown task':row.kind}))
     .filter(row=>`${row.userId} ${row.status} ${row.taskId} ${row.kind} ${row.role}`.toLowerCase().includes(search.toLowerCase()))
     .sort((a,b)=>a.userId.localeCompare(b.userId)||a.taskId.localeCompare(b.taskId)||a.kind.localeCompare(b.kind)||a.role.localeCompare(b.role));
 },[entries,extraRows,allView,selectedUser,taskMap,search]);
 const rowIndex=new Map(rows.map((row,i)=>[row.key,i]));
 const entriesFor=(row:GridRow,date:string)=>cells.get(JSON.stringify([row.userId,row.kind,row.taskId,row.role,date]))||[];
 const valueFor=(row:GridRow,date:string)=>sum(entriesFor(row,date));
 const dayTotal=(date:string)=>daily.get(date)||0;
 function addRow(){const userId=allView?(newPerson||users[0]?.id||''):selectedUser;
   if(!userId){setErr('Select an engineer first.');return;}
   if(newKind==='Task'&&!newTask){setErr('Choose a task before adding the row.');return;}
   const taskId=newKind==='Task'?newTask:'',role=newKind==='Task'?newRole:'NA';
   const row:GridRow={key:makeKey(userId,newKind,taskId,role),userId,status:newKind,taskId,kind:newKind,role,entries:[]};
   if(!rows.some(r=>r.key===row.key))setExtraRows(old=>[...old,row]);
   setSearch('');setErr('');
   setActive({key:row.key,date:days[0]||String(year)+'-01-01',draft:''});
 }
 async function commitCell(cell:{key:string;date:string;draft:string},next?:{key:string;date:string}){
   const id=cell.key+'@'+cell.date;if(saving.current.has(id))return;
   const row=rows.find(r=>r.key===cell.key);
   if(!row){setActive(null);return;}
   const text=cell.draft.trim().replace(',','.');const hours=text===''?0:Number(text);
   if(!Number.isFinite(hours)||hours<0||hours>24||Math.round(hours*4)!==hours*4){setErr('Enter hours in 0.25 increments from 0 to 24. Empty clears the cell.');return;}
   if(entriesFor(row,cell.date).length>1){setErr('This cell contains multiple entries with notes. Use View mode to manage them individually.');return;}
   if(hours===valueFor(row,cell.date)){setActive(next?{...next,draft:String(valueFor(rows.find(r=>r.key===next.key)||row,next.date)||'')}:null);return;}
   saving.current.add(id);setActive(next?{...next,draft:String(valueFor(rows.find(r=>r.key===next.key)||row,next.date)||'')}:null);setErr('');
   try{await api('/effort-cells',{method:'POST',body:JSON.stringify({cells:[{user_id:row.userId,date:cell.date,task_id:row.taskId,kind:row.kind,role:row.role,hours}]})});
     flash('Cell saved');refresh();
   }catch(error){setErr((error as Error).message);}finally{saving.current.delete(id);}
 }
 async function pasteCells(event:ClipboardEvent<HTMLInputElement>,cell:{key:string;date:string;draft:string}){
   const text=event.clipboardData.getData('text/plain');if(!text.includes('\t')&&!text.includes('\n'))return;
   event.preventDefault();
   const startRow=rowIndex.get(cell.key),startDay=days.indexOf(cell.date);
   if(startRow===undefined||startDay<0)return;
   const lines=text.replace(/\r/g,'').trimEnd().split('\n').map(line=>line.split('\t'));
   const cells:Array<{user_id:string;date:string;task_id:string;kind:string;role:string;hours:number}>=[];
   for(let r=0;r<lines.length;r++)for(let c=0;c<(lines[r]?.length||0);c++){
     const row=rows[startRow+r],date=days[startDay+c];if(!row||!date){setErr('Paste exceeds the visible grid; no changes made.');return;}
     const raw=(lines[r]?.[c]||'').trim().replace(',','.');const hours=raw?Number(raw):0;
     if(!Number.isFinite(hours)||hours<0||hours>24||Math.round(hours*4)!==hours*4){setErr(`Invalid pasted hours at row ${r+1}, column ${c+1}`);return;}
     cells.push({user_id:row.userId,date,task_id:row.taskId,kind:row.kind,role:row.role,hours});
   }
   if(!cells.length)return;const pasteKey=cell.key+'@'+cell.date;saving.current.add(pasteKey);setActive(null);setErr('');
   try{await api<{updated:number}>('/effort-cells',{method:'POST',body:JSON.stringify({cells})});flash(`${cells.length} cells pasted`);refresh();}
   catch(error){setErr((error as Error).message);}finally{saving.current.delete(pasteKey);}
 }
 async function pasteVirtual(start:GridCoordinate,text:string){
  const lines=text.replace(/\r/g,'').replace(/\n$/,'').split('\n').map(line=>line.split('\t'));
  const batch:Array<{user_id:string;date:string;task_id:string;kind:string;role:string;hours:number}>=[];
  for(let r=0;r<lines.length;r++)for(let c=0;c<(lines[r]?.length||0);c++){
   const row=rows[start.row+r],date=days[start.day+c];
   if(!row||!date){setErr('Paste exceeds the visible grid. No changes were applied.');return;}
   const raw=(lines[r]?.[c]||'').trim().replace(',','.'),hours=raw?Number(raw):0;
   if(!Number.isFinite(hours)||hours<0||hours>24||Math.round(hours*4)!==hours*4){setErr('Invalid pasted effort at row '+(r+1));return;}
   batch.push({user_id:row.userId,date,task_id:row.taskId,kind:row.kind,role:row.role,hours});
  }
  if(batch.length>1000){setErr('Paste limit is 1,000 cells. Split into smaller ranges.');return;}
  try{await api('/effort-cells',{method:'POST',body:JSON.stringify({cells:batch})});flash(`${batch.length} cells saved`);refresh();}
  catch(e){setErr((e as Error).message);}
 }
 function move(cell:{key:string;date:string;draft:string},event:KeyboardEvent<HTMLInputElement>){
   if(event.key==='Escape'){event.preventDefault();setActive(null);return;}
   if(!['Enter','Tab'].includes(event.key))return;
   event.preventDefault();const rowNo=rowIndex.get(cell.key)||0,dayNo=days.indexOf(cell.date);
   const nextRow=event.key==='Enter'?rowNo+(event.shiftKey?-1:1):rowNo;
   const nextDay=event.key==='Tab'?dayNo+(event.shiftKey?-1:1):dayNo;
   const row=rows[nextRow],date=days[nextDay];
   void commitCell(cell,row&&date?{key:row.key,date}:undefined);
 }
 async function removeEntry(entry:Entry,userId:string){if(!window.confirm(`Delete ${entry.hours} h from ${entry.date}?`))return;
   try{await api(`/entries/${encodeURIComponent(entry.id)}?userId=${encodeURIComponent(userId)}`,{method:'DELETE'});setDetails(null);refresh();flash('Entry removed');}
   catch(error){setErr((error as Error).message);}
 }
 return <>
 <div className="toolbar panel-toolbar"><div className="toolbar-left">
   <select className="input short" aria-label="Timesheet year" value={year} onChange={e=>setYear(Number(e.target.value))}>{Array.from({length:7},(_,i)=>new Date().getFullYear()-5+i).map(y=><option key={y} value={y}>{y}</option>)}</select>
 <select className="input short" aria-label="Timesheet period" value={period} onChange={e=>setPeriod(e.target.value)}><option value="all">All months</option>{Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0')).map(m=><option key={m} value={m}>{new Date(2026,Number(m)-1,1).toLocaleDateString('en',{month:'long'})}</option>)}</select>
 <select className="input short" aria-label="Engineer view" value={selectedUser} onChange={e=>onUser(e.target.value)}>
     {isAdmin&&<option value="all">All engineers</option>}{users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
   </select><div className="search-wrap"><Search size={15}/><input aria-label="Filter timesheet" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filter engineer / task / status"/></div>
 </div><div className="toolbar-right"><span className="subtle">{rows.length} rows · {allView?'Team':userMap.get(selectedUser)?.name||selectedUser}{rangeBusy?' · Loading…':''}</span>
   <button className={`btn ${editMode?'primary':''}`} aria-pressed={editMode} onClick={()=>{setEditMode(v=>!v);setActive(null);}}>{editMode?'Exit edit mode':'Edit like Excel'}</button>
   <button className="btn primary" onClick={()=>setEntryModal({userId:allView?users[0]?.id||'':selectedUser,date:days.includes(today())?today():days[0]||String(year)+'-01-01'})}><Plus size={14}/>Log effort</button>
 </div></div>
 {rangeError&&<div className="error-msg" role="alert">{rangeError}</div>}
  {err&&<div className="error-msg" role="alert">{err} <button className="icon-btn" aria-label="Dismiss" onClick={()=>setErr('')}><X size={13}/></button></div>}
 {editMode&&<div className="edit-rail">
   <span><strong>EDIT MODE</strong> Click cells to type hours · Enter next row · Tab next day · paste TSV from Excel · Delete/0 clears cell</span>
   {allView&&<select aria-label="New row engineer" className="input short" value={newPerson||users[0]?.id||''} onChange={e=>setNewPerson(e.target.value)}>{users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select>}
   <select className="input short" aria-label="New row kind" value={newKind} onChange={e=>setNewKind(e.target.value)}>{KINDS.map(k=><option key={k}>{k}</option>)}</select>
   {newKind==='Task'&&<><select className="input short task-select" aria-label="New task row" value={newTask} onChange={e=>setNewTask(e.target.value)}><option value="">Choose task</option>{overview.tasks.map(t=><option key={t.id} value={t.id}>{t.id} · {t.name}</option>)}</select><select aria-label="New task role" className="input short" value={newRole} onChange={e=>setNewRole(e.target.value)}><option>EX</option><option>QC</option></select></>}
   <button className="btn small" onClick={addRow}><Plus size={13}/>Add row</button>
 </div>}
 <section className="panel"><div className="panel-header"><h2>{period==='all'?'Full-year effort grid':'Monthly effort grid'}</h2><span className="subtle">{period==='all'?'All months · '+year:year+'-'+period} · frozen task columns · scroll horizontally</span></div>
 <WorkGrid days={days} rows={rows} userNames={new Map(users.map(u=>[u.id,u.name]))} dailyTotals={daily} valueAt={valueFor}
   editable={editMode} onTaskOpen={onOpenTask} onPasteRange={(start,text)=>void pasteVirtual(start,text)}
   renderCell={(row,date)=>{
    const records=entriesFor(row,date),value=sum(records),isActive=active?.key===row.key&&active.date===date;
    return isActive?<input autoFocus aria-label={`Edit ${row.userId} ${row.taskId||row.kind} ${date}`} className="excel-input" inputMode="decimal" value={active!.draft}
       onFocus={e=>e.target.select()} onChange={e=>setActive(v=>v?{...v,draft:e.target.value}:v)}
       onBlur={()=>void commitCell(active!)} onKeyDown={event=>move(active!,event)} onPaste={e=>void pasteCells(e,active!)}/>
     :<button className="wt-hour-button" title={`${row.userId} · ${date} · ${fmtHours(value)}h`}
       onClick={()=>editMode?(records.length>1?setErr('Multiple records: edit details individually'):setActive({key:row.key,date,draft:value?fmtHours(value):''})):
         (records.length?setDetails({entries:records,userId:row.userId}):setEntryModal({userId:row.userId,date}))}>
       {value?fmtHours(value):'·'}</button>;
   }}/>
 <div className="table-footer"><span>Logged hours:</span><span className="heat-legend heat-1">0.25–2h</span><span className="heat-legend heat-2">2–4h</span><span className="heat-legend heat-3">4–6h</span><span className="heat-legend heat-4">6–8h</span><span className="heat-legend heat-5">8h+</span>{editMode&&<span>Each change is saved to the server; cells with multiple notes are protected.</span>}</div>
 </section>
 {details&&<div className="modal-backdrop" onClick={()=>setDetails(null)}><section className="modal" role="dialog" aria-modal="true" onClick={e=>e.stopPropagation()}><div className="panel-header"><h2>Logged records · {details.entries[0]?.date}</h2><button className="icon-btn" aria-label="Close" onClick={()=>setDetails(null)}><X size={15}/></button></div><div className="panel-body">{details.entries.map(e=><div key={e.id} className="entry-detail"><div><strong>{fmtHours(e.hours)} h · {e.role==='NA'?e.kind:e.role}</strong><small>{e.note||e.task_id||'No note'}</small></div><button className="btn small" onClick={()=>void removeEntry(e,details.userId)}><Trash2 size={13}/>Delete</button></div>)}<div className="modal-actions"><button className="btn" onClick={()=>setDetails(null)}>Close</button><button className="btn primary" onClick={()=>{setEntryModal({date:details.entries[0]?.date||today(),userId:details.userId});setDetails(null);}}>Add entry</button></div></div></section></div>}
 {entryModal&&<EntryEditor overview={overview} selectedUser={entryModal.userId} initialDate={entryModal.date} onClose={()=>setEntryModal(null)} onSaved={()=>{setEntryModal(null);refresh();flash('Effort saved');}}/>}
 </>;
}
function parseTaskGridDate(raw:string):string {
 const v=raw.trim();if(!v)return '';
 if(/^\d{5}$/.test(v)){const d=new Date((Number(v)-25569)*86400000);return Number.isNaN(d.getTime())?'__invalid__':d.toISOString().slice(0,10);}
 const match=v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
 if(match)return `${match[3]}-${match[2]!.padStart(2,'0')}-${match[1]!.padStart(2,'0')}`;
 return v;
}
function taskActual(t:Task,overview:Overview){return overview.taskActuals[t.id]||{ex:0,qc:0};}
function fieldDisplay(t:Task,column:(typeof TRACKING_COLUMNS)[number],overview:Overview):string{
 const actual=taskActual(t,overview);
 switch(column.key){
 case 'actual_ex_baseline':return fmtHours(t.actual_ex_baseline+actual.ex);
 case 'actual_qc_baseline':return fmtHours(t.actual_qc_baseline+actual.qc);
 case 'total_estimated':return fmtHours(t.estimated_ex+t.estimated_qc);
 case 'total_actual':return fmtHours(t.actual_ex_baseline+t.actual_qc_baseline+actual.ex+actual.qc);
 default:return String(t[column.key]??'');
 }
}
function taskFieldChange(t:Task,column:(typeof TRACKING_COLUMNS)[number],raw:string,overview:Overview):Task{
 if(column.type==='calculated'||column.key==='id')return t;
 const key=column.key,clean=raw.trim();
 let value:string|number=column.type==='number'?Number(clean||0):column.type==='date'?parseTaskGridDate(clean):clean;
 if(typeof value==='number'&&(!Number.isFinite(value)||value<0))throw new Error(`${column.header}: value must be nonnegative`);
 if(column.type==='date'&&value&&!/^\d{4}-\d{2}-\d{2}$/.test(String(value)))throw new Error(`${column.header}: use YYYY-MM-DD`);
 if(key==='status'&&!STATUSES.includes(String(value) as (typeof STATUSES)[number]))throw new Error('Unsupported task status');
 if(key==='actual_ex_baseline'||key==='actual_qc_baseline'){
   const logged=taskActual(t,overview)[key==='actual_ex_baseline'?'ex':'qc'];
   value=Number(value)-logged;
   if(value<0)throw new Error(`${column.header}: cannot set below ${logged} h already logged via timesheet`);
 }
 return {...t,[key]:value};
}
function TaskEditor({initial,onClose,onSaved}:{initial:Omit<Task,'updated_at'>;onClose:()=>void;onSaved:()=>void}){
 const [task,setTask]=useState(initial),[saving,setSaving]=useState(false),[err,setErr]=useState('');
 function change(key:keyof Task,value:string,type:string){setTask(t=>({...t,[key]:type==='number'?Number(value):value}));}
 async function submit(event:FormEvent){event.preventDefault();setSaving(true);setErr('');try{await api('/tasks',{method:'POST',body:JSON.stringify(task)});onSaved();}catch(error){setErr((error as Error).message);}finally{setSaving(false);}}
 return <div className="modal-backdrop" onClick={onClose}><section className="modal full-task-editor" role="dialog" aria-modal="true" aria-label="Task Tracking editor" onClick={e=>e.stopPropagation()}>
   <div className="panel-header"><h2>{initial.id?'Edit task tracking':'New task tracking record'}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={17}/></button></div>
   <form onSubmit={submit} className="form-body"><p className="subtle">32-column task model. Actual and QC effort entered here are historical baselines; recorded timesheet hours are added separately.</p>
   <div className="task-editor-fields">{TRACKING_COLUMNS.filter(c=>c.type!=='calculated').map(c=><label key={c.key}>{c.header}
     {c.key==='status'?<select className="input" value={task.status} onChange={e=>change('status',e.target.value,'text')}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select>:
     <input className="input" type={c.type==='date'?'date':c.type==='number'?'number':'text'} step={c.type==='number'?'0.25':undefined} min={c.type==='number'?'0':undefined}
       disabled={c.key==='id'&&!!initial.id} required={c.key==='id'} value={String(task[c.key as keyof typeof task]??'')}
       onChange={e=>change(c.key as keyof Task,e.target.value,c.type)}/>}
   </label>)}</div>
   {err&&<div className="error-msg" role="alert">{err}</div>}
   <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={saving}>{saving?'Saving…':'Save task'}</button></div>
   </form>
 </section></div>;
}
// Column sizes are browser preferences only; they never modify Task Tracking records.
const TRACKING_WIDTH_KEY='aventics-timesheet.tracking-column-widths.v1';
const SIDEBAR_COLLAPSED_KEY='aventics-timesheet.sidebar-collapsed.v1';
const MIN_TRACKING_WIDTH=72;
const MAX_TRACKING_WIDTH=720;
const TRACKING_DEFAULT_WIDTHS:Record<string,number>={
 serial_no:108,ip_no:136,series:100,revision:100,id:194,name:250,email_subject:350,
 engineer:134,qc_engineer:134,estimated_ex:136,actual_ex_baseline:126,
 estimated_qc:154,actual_qc_baseline:126,rework_effort:138,status:130,
 planned_start_date:170,start_date:170,planned_completion_date:176,completion_date:176,
 activity_code:136,required_internal:260,self_qc_completion_date:216,
 internal_errors:162,flexibility:154,customer_approval_date:182,task_type:138,
 code_add:134,code_update:142,total_estimated:162,total_actual:154,
 mu_execution:120,mu_qc:104
};
function trackingWidth(key:string,overrides:Record<string,number>):number{
 const stored=overrides[key];
 return typeof stored==='number'&&Number.isFinite(stored)?Math.max(MIN_TRACKING_WIDTH,Math.min(MAX_TRACKING_WIDTH,stored)):(TRACKING_DEFAULT_WIDTHS[key]??140);
}
function readStoredWidths():Record<string,number>{
 try{
   const raw=localStorage.getItem(TRACKING_WIDTH_KEY);
   if(!raw)return {};
   const parsed:unknown=JSON.parse(raw);
   if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {};
   return Object.fromEntries(Object.entries(parsed).filter(([k,v])=>
      Object.hasOwn(TRACKING_DEFAULT_WIDTHS,k)&&typeof v==='number'&&Number.isFinite(v)
   ));
 }catch{return {};}
}
function TasksPage({overview,onRefresh,flash,month,onOpenTask}:{overview:Overview;onRefresh:()=>void;flash:(s:string)=>void;month:string;onOpenTask:(id:string)=>void}){
 const [search,setSearch]=useState(''),[status,setStatus]=useState('All');
 const [editing,setEditing]=useState<Omit<Task,'updated_at'>|null>(null),[editMode,setEditMode]=useState(false);
 const [active,setActive]=useState<{taskId:string;column:number;draft:string}|null>(null),[err,setErr]=useState('');
 const saving=useRef(new Set<string>()),isAdmin=overview.role==='admin';
 const [marks,setMarks]=useState<TrackingMark[]>([]);
 const [markEditor,setMarkEditor]=useState<{scope:'cell'|'row'|'column';task_id:string;column_key:string;fill_color:string;text_color:string;pinned:boolean}|null>(null);
 const [markBusy,setMarkBusy]=useState(false);
 const reloadMarks=()=>api<TrackingMark[]>('/tracking-marks').then(setMarks).catch(e=>setErr((e as Error).message));
 useEffect(()=>{void reloadMarks();},[]);
 const marker=(scope:'cell'|'row'|'column',id='',column='')=>marks.find(m=>m.scope===scope&&m.task_id===id&&m.column_key===column);
 const markFor=(id:string,column:string)=>marker('cell',id,column)||marker('row',id)||marker('column','',column);
 const isPinnedCol=(column:string)=>!!marker('column','',column)?.pinned;
 const freeze=(i:number):CSSProperties=>{
   if(i<2||!isPinnedCol(TRACKING_COLUMNS[i]?.key||''))return {};
   const pinnedBefore=TRACKING_COLUMNS.slice(2,i).filter(c=>isPinnedCol(c.key));
   const left=widthOf(TRACKING_COLUMNS[0]!.key)+widthOf(TRACKING_COLUMNS[1]!.key)+pinnedBefore.reduce((acc,c)=>acc+widthOf(c.key),0);
   return {position:'sticky',left,zIndex:4,background:'#fff'};
 };
 function openMark(scope:'cell'|'row'|'column',task_id='',column_key=''){
   const old=marker(scope,task_id,column_key);
   setMarkEditor({scope,task_id,column_key,fill_color:old?.fill_color||'',text_color:old?.text_color||'',pinned:!!old?.pinned});
 }
 async function saveMark(clear=false){if(!markEditor)return;setMarkBusy(true);try{
   const keys={scope:markEditor.scope,task_id:markEditor.task_id,column_key:markEditor.column_key};
   await api('/tracking-marks',{method:clear?'DELETE':'POST',body:JSON.stringify(clear?keys:markEditor)});
   await reloadMarks();setMarkEditor(null);flash(clear?'Mark cleared':'Mark saved');
 }catch(e){setErr((e as Error).message);}finally{setMarkBusy(false);}}

 const [columnWidths,setColumnWidths]=useState<Record<string,number>>(readStoredWidths);
 const scrollRef=useRef<HTMLDivElement>(null);
 const tableRef=useRef<HTMLTableElement>(null);
 const dragging=useRef<{pointerId:number;key:string;startX:number;startWidth:number;startTotal:number;currentWidth:number;col:HTMLTableColElement|null}|null>(null);
 const widthOf=(key:string)=>trackingWidth(key,columnWidths);
 const totalWidth=TRACKING_COLUMNS.reduce((acc,c)=>acc+widthOf(c.key),isAdmin?112:0);
 useEffect(()=>{try{localStorage.setItem(TRACKING_WIDTH_KEY,JSON.stringify(columnWidths));}catch{}},[columnWidths]);
 function setWidth(key:string,width:number){
   setColumnWidths(old=>({...old,[key]:Math.max(MIN_TRACKING_WIDTH,Math.min(MAX_TRACKING_WIDTH,Math.round(width)))}));
 }
 function beginResize(e:PointerEvent<HTMLDivElement>,key:string){
   if(e.button!==0)return;
   e.preventDefault();e.stopPropagation();
   const width=widthOf(key);
   const col=Array.from(tableRef.current?.querySelectorAll('col[data-column-key]')||[])
     .find(element=>element.getAttribute('data-column-key')===key) as HTMLTableColElement|undefined;
   dragging.current={pointerId:e.pointerId,key,startX:e.clientX,startWidth:width,startTotal:totalWidth,currentWidth:width,col:col??null};
   e.currentTarget.setPointerCapture(e.pointerId);
 }
 function duringResize(e:PointerEvent<HTMLDivElement>){
   const drag=dragging.current;
   if(!drag||drag.pointerId!==e.pointerId)return;
   const width=Math.max(MIN_TRACKING_WIDTH,Math.min(MAX_TRACKING_WIDTH,Math.round(drag.startWidth+e.clientX-drag.startX)));
   if(width===drag.currentWidth)return;
   drag.currentWidth=width;
   // Update the table during dragging without rerendering every row on every pointer event.
   if(drag.col)drag.col.style.width=`${width}px`;
   if(tableRef.current){
     tableRef.current.style.width=`${drag.startTotal+width-drag.startWidth}px`;
     if(drag.key===TRACKING_COLUMNS[0]?.key)tableRef.current.style.setProperty('--tracking-first-width',`${width}px`);
   }
 }
 function endResize(e:PointerEvent<HTMLDivElement>){
   const drag=dragging.current;
   if(!drag||drag.pointerId!==e.pointerId)return;
   dragging.current=null;
   setWidth(drag.key,drag.currentWidth);
   if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
 }
 function autoFitColumn(key:string,column:number){
   const ctx=document.createElement('canvas').getContext('2d');
   if(ctx)ctx.font='600 11px "Segoe UI", Arial, sans-serif';
   const textWidth=(text:string)=>ctx?ctx.measureText(text).width:text.length*7;
   const content=Math.max(textWidth(TRACKING_COLUMNS[column]?.header||''),...filtered.map(t=>textWidth(display(t,column))));
   setWidth(key,Math.ceil(content+30));
 }
 function resizeWithKeyboard(e:KeyboardEvent<HTMLDivElement>,key:string){
   if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;
   e.preventDefault();e.stopPropagation();
   setWidth(key,widthOf(key)+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?32:12));
 }
 function scrollColumns(direction:-1|1){
   const node=scrollRef.current;if(!node)return;
   node.scrollBy({left:direction*Math.max(260,Math.round(node.clientWidth*.8)),behavior:'smooth'});
 }
 const filtered=overview.tasks.filter(t=>(status==='All'||status===t.status)&&`${t.id} ${t.name} ${t.ip_no} ${t.serial_no} ${t.series} ${t.revision} ${t.engineer} ${t.qc_engineer}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>Number(!!marker('row',b.id)?.pinned)-Number(!!marker('row',a.id)?.pinned));
 const display=(t:Task,col:number)=>fieldDisplay(t,TRACKING_COLUMNS[col]!,overview);
 async function saveCell(cell:{taskId:string;column:number;draft:string},next?:{taskId:string;column:number}){
   const task=filtered.find(t=>t.id===cell.taskId),column=TRACKING_COLUMNS[cell.column];if(!task||!column)return;
   const unique=cell.taskId+'-'+cell.column;if(saving.current.has(unique))return;
   let updated:Task;try{updated=taskFieldChange(task,column,cell.draft,overview);}catch(error){setErr((error as Error).message);return;}
   setActive(next?{...next,draft:display(filtered.find(t=>t.id===next.taskId)!,next.column)}:null);
   if(JSON.stringify(updated)===JSON.stringify(task))return;
   saving.current.add(unique);setErr('');
   try{const {updated_at,...payload}=updated;await api('/tasks',{method:'POST',body:JSON.stringify(payload)});flash('Task updated');onRefresh();}
   catch(error){setErr((error as Error).message);}finally{saving.current.delete(unique);}
 }
 function moveCell(cell:{taskId:string;column:number;draft:string},event:KeyboardEvent<HTMLInputElement>){
   if(event.key==='Escape'){setActive(null);return;}
   if(!['Tab','Enter'].includes(event.key))return;
   event.preventDefault();const rowIndex=filtered.findIndex(t=>t.id===cell.taskId);
   const row=event.key==='Enter'?filtered[rowIndex+(event.shiftKey?-1:1)]:filtered[rowIndex];
   const col=event.key==='Tab'?cell.column+(event.shiftKey?-1:1):cell.column;
   const column=TRACKING_COLUMNS[col];
   void saveCell(cell,row&&column&&column.type!=='calculated'&&column.key!=='id'?{taskId:row.id,column:col}:undefined);
 }
 async function pasteTracking(event:ClipboardEvent<HTMLInputElement>,cell:{taskId:string;column:number;draft:string}){
   const text=event.clipboardData.getData('text/plain');if(!text.includes('\t')&&!text.includes('\n'))return;
   event.preventDefault();const rows=text.replace(/\r/g,'').trimEnd().split('\n').map(line=>line.split('\t'));
   const start=filtered.findIndex(t=>t.id===cell.taskId),updates=new Map<string,Task>();
   for(let r=0;r<rows.length;r++)for(let c=0;c<(rows[r]?.length||0);c++){
     const original=filtered[start+r],col=TRACKING_COLUMNS[cell.column+c];
     if(!original||!col){setErr('Pasted range exceeds visible Task Tracking cells; nothing changed.');return;}
     if(col.key==='id'||col.type==='calculated')continue;
     const previous=updates.get(original.id)||original;
     try{updates.set(original.id,taskFieldChange(previous,col,rows[r]?.[c]||'',overview));}
     catch(error){setErr((error as Error).message);return;}
   }
   if(!updates.size)return;
   const pasteKey=cell.taskId+'-'+cell.column;saving.current.add(pasteKey);setActive(null);setErr('');
   try{const tasks=[...updates.values()].map(({updated_at,...task})=>task);await api('/tasks/bulk',{method:'POST',body:JSON.stringify({tasks})});flash(`${tasks.length} task rows updated`);onRefresh();}
   catch(error){setErr((error as Error).message);}finally{saving.current.delete(pasteKey);}
 }
 return <><div className="toolbar panel-toolbar"><div className="toolbar-left"><div className="search-wrap"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search task, project, engineer"/></div>
 <select className="input short" value={status} onChange={e=>setStatus(e.target.value)}><option>All</option>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></div>
 <div className="toolbar-right"><span className="subtle">{filtered.length} / {overview.tasks.length} records · {TRACKING_COLUMNS.length} columns</span>
 {isAdmin&&<><button className={`btn ${editMode?'primary':''}`} aria-pressed={editMode} onClick={()=>{setEditMode(v=>!v);setActive(null);}}>{editMode?'Exit edit mode':'Edit like Excel'}</button>
 <button className="btn primary" onClick={()=>setEditing({...emptyTask})}><Plus size={15}/>Add task</button></>}</div></div>
 {err&&<div className="error-msg" role="alert">{err}<button className="icon-btn" onClick={()=>setErr('')} aria-label="Dismiss"><X size={13}/></button></div>}
 {editMode&&<div className="edit-rail"><strong>EDIT MODE</strong> Click a field to edit · Tab/Enter navigate · paste Excel rows. Task ID and computed totals are read-only. Imported actual hours are historical baselines plus logged time.</div>}
 <section className="panel"><div className="panel-header tracking-header"><div><h2>Task Tracking</h2><span className="subtle">Resize header borders · right-click any column or cell to pin, highlight or recolor</span></div><div className="tracking-tools"><button className="btn small" type="button" onClick={()=>scrollColumns(-1)} aria-label="Scroll columns left" title="Scroll columns left"><ChevronLeft size={15}/></button><button className="btn small" type="button" onClick={()=>scrollColumns(1)} aria-label="Scroll columns right" title="Scroll columns right"><ChevronRight size={15}/></button><button className="btn small" type="button" onClick={()=>setColumnWidths({})} title="Restore the default widths for all columns"><RotateCcw size={13}/>Reset widths</button></div></div>
 <div className="table-scroll tracking-scroll" ref={scrollRef} tabIndex={0} aria-label="Task Tracking table — use horizontal scrolling to see additional columns">
 <table ref={tableRef} className="tracking-grid" style={{width:totalWidth,'--tracking-first-width':`${widthOf(TRACKING_COLUMNS[0]!.key)}px`} as CSSProperties}>
 <colgroup>{TRACKING_COLUMNS.map(c=><col key={c.key} data-column-key={c.key} style={{width:widthOf(c.key)}}/>)}{isAdmin&&<col style={{width:112}}/>}</colgroup>
 <thead><tr>{TRACKING_COLUMNS.map((c,i)=><th scope="col" title={c.header+' · right-click to mark'} key={c.key} onContextMenu={e=>{e.preventDefault();openMark('column','',c.key);}} style={{...freeze(i),...(marker('column','',c.key)?.fill_color?{background:marker('column','',c.key)!.fill_color}:{}),...(marker('column','',c.key)?.text_color?{color:marker('column','',c.key)!.text_color}:{})}}><span className="tracking-heading">{marker('column','',c.key)?.pinned&&<Pin size={11}/>} {c.header}</span><div className="tracking-resizer" role="separator" tabIndex={0} aria-orientation="vertical" aria-valuemin={MIN_TRACKING_WIDTH} aria-valuemax={MAX_TRACKING_WIDTH} aria-valuenow={widthOf(c.key)} aria-label={`Resize ${c.header} column`} title={`Drag to resize ${c.header} · double-click to auto-fit · arrow keys to resize`} onPointerDown={e=>beginResize(e,c.key)} onPointerMove={duringResize} onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={endResize} onDoubleClick={()=>autoFitColumn(c.key,TRACKING_COLUMNS.findIndex(column=>column.key===c.key))} onKeyDown={e=>resizeWithKeyboard(e,c.key)}/></th>)}{isAdmin&&<th scope="col">Actions</th>}</tr></thead><tbody>
 {filtered.map(t=><tr key={t.id} className={marker('row',t.id)?.pinned?'tracking-row-pinned':''}>{TRACKING_COLUMNS.map((column,i)=>{
   const isActive=active?.taskId===t.id&&active.column===i,editable=isAdmin&&editMode&&column.type!=='calculated'&&column.key!=='id';
   const mark=markFor(t.id,column.key);
   return <td key={column.key} className={`${column.type==='number'||column.type==='calculated'?'num':''} ${column.key==='id'?'mono':''}`} title={(display(t,i)||column.header)+' · right-click to mark'}
   onContextMenu={e=>{e.preventDefault();e.stopPropagation();openMark('cell',t.id,column.key);}}
   style={{...freeze(i),...(mark?.fill_color?{background:mark.fill_color}:{}),...(mark?.text_color?{color:mark.text_color}:{})}}>
     {isActive?<input autoFocus className="tracking-input" aria-label={`${column.header} for ${t.id}`} type={column.type==='number'?'number':column.type==='date'?'date':'text'}
        step={column.type==='number'?'0.25':undefined} value={active!.draft} onFocus={e=>e.target.select()}
        onChange={e=>setActive(a=>a?{...a,draft:e.target.value}:a)} onBlur={()=>void saveCell(active!)}
        onKeyDown={e=>moveCell(active!,e)} onPaste={e=>void pasteTracking(e,active!)}/>
     :editable?<button className="tracking-cell" title={`${column.header}: click to edit`} onClick={()=>setActive({taskId:t.id,column:i,draft:display(t,i)})}>{mark?.pinned&&<Pin size={11}/>} {column.key==='status'?<Status value={t.status}/>:display(t,i)||'·'}</button>
     :column.key==='status'?<Status value={t.status}/>:<>{mark?.pinned&&<Pin size={11}/>} {display(t,i)||'·'}</>}
   </td>;
 })}{isAdmin&&<td><div className="tracking-row-actions"><button className="btn small" onClick={()=>onOpenTask(t.id)}>Open</button><button className="btn small" onClick={()=>{const {updated_at,...initial}=t;setEditing(initial);}}>Edit</button><button className="icon-btn" title="Mark or pin this row" onClick={()=>openMark('row',t.id)}><Pin size={14}/></button></div></td>}</tr>)}
 {!filtered.length&&<tr><td colSpan={TRACKING_COLUMNS.length+(isAdmin?1:0)} className="empty">No tasks match the filters. Import Task Tracking or add a task.</td></tr>}
 </tbody></table></div></section>
 {markEditor&&<div className="modal-backdrop" onClick={()=>setMarkEditor(null)}><section className="modal mark-dialog" role="dialog" aria-modal="true" aria-label="Mark Task Tracking area" onClick={e=>e.stopPropagation()}>
 <div className="panel-header"><h2><Palette size={16}/> Mark / pin {markEditor.scope}</h2><button className="icon-btn" onClick={()=>setMarkEditor(null)} aria-label="Close"><X size={15}/></button></div>
 <div className="panel-body">
 <p className="subtle">Private per-user marker · {markEditor.task_id||'every task'} · {markEditor.column_key||'every column'}</p>
 <label>Highlight<select className="input" value={markEditor.fill_color} onChange={e=>setMarkEditor(v=>v?{...v,fill_color:e.target.value}:v)}>
 <option value="">None</option><option value="#e7f2f1">Green</option><option value="#fff4d6">Yellow</option><option value="#e5f3f8">Blue</option><option value="#fde8e9">Red</option>
 </select></label>
 <label>Text color<select className="input" value={markEditor.text_color} onChange={e=>setMarkEditor(v=>v?{...v,text_color:e.target.value}:v)}>
 <option value="">Default</option><option value="#0e625e">Green</option><option value="#865600">Amber</option><option value="#004975">Blue</option><option value="#ac2027">Red</option>
 </select></label>
 <label className="check-line"><input type="checkbox" checked={markEditor.pinned} onChange={e=>setMarkEditor(v=>v?{...v,pinned:e.target.checked}:v)}/>Pin {markEditor.scope}</label>
 <div className="modal-actions"><button className="btn" disabled={markBusy} onClick={()=>void saveMark(true)}>Clear</button><button className="btn primary" disabled={markBusy} onClick={()=>void saveMark(false)}>Save mark</button></div>
 </div></section></div>}
 {editing&&<TaskEditor initial={editing} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);onRefresh();flash('Task saved');}}/>}
 </>;
}

function EstimationPage({overview,flash,onRefresh}:{overview:Overview;flash:(message:string)=>void;onRefresh:()=>void}){
 const [rates,setRates]=useState<EffortRate[]>([]),[estimates,setEstimates]=useState<WorkEstimate[]>([]);
 const [activity,setActivity]=useState(''),[rateId,setRateId]=useState(''),[experience,setExperience]=useState('Intermediate');
 const [quantity,setQuantity]=useState(1),[taskId,setTaskId]=useState(''),[search,setSearch]=useState('');
 const [loading,setLoading]=useState(false),[error,setError]=useState('');
 const [selectedFile,setSelectedFile]=useState<File|null>(null),[showAdd,setShowAdd]=useState(false);
 const [draftRate,setDraftRate]=useState({id:'',activity:'',difficulty:'',activity_code:'',execution_hours:0,qc_hours:0,criteria:''});
 const admin=overview.role==='admin';
 async function reload(){setLoading(true);try{
   const [lookup,saved]=await Promise.all([
     api<{rates:EffortRate[];factors:Record<string,number>}>('/effort-lookup'),api<WorkEstimate[]>('/task-estimates')]);
   setRates(lookup.rates);setEstimates(saved);setError('');
 }catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 useEffect(()=>{void reload();},[]);
 const activities=[...new Set(rates.map(r=>r.activity))];
 const visible=rates.filter(r=>(!activity||r.activity===activity)&&(r.activity+' '+r.difficulty+' '+r.activity_code+' '+r.criteria).toLowerCase().includes(search.toLowerCase()));
 const rate=rates.find(r=>r.id===rateId)||visible[0];
 const factor=experience==='Beginner'?1:experience==='Expert'?0.8:0.9;
 const ex=rate?Math.round(rate.execution_hours*quantity*factor*10)/10:0;
 const qc=rate?Math.round(rate.qc_hours*quantity*factor*10)/10:0;
 const taskItems=estimates.filter(x=>x.task_id===taskId);
 const taskTotals={ex:taskItems.reduce((n,x)=>n+x.ex_hours,0),qc:taskItems.reduce((n,x)=>n+x.qc_hours,0)};
 async function saveEstimate(){if(!rate||!taskId)return;setLoading(true);try{
   await api('/task-estimates',{method:'POST',body:JSON.stringify({task_id:taskId,rate_id:rate.id,quantity,experience})});
   flash('Estimation item saved');await reload();
 }catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 async function applyEstimate(){if(!taskId||!taskItems.length)return;
   if(!window.confirm('Replace Task Tracking EX/QC estimates for '+taskId+' with '+fmtHours(taskTotals.ex)+' h EX and '+fmtHours(taskTotals.qc)+' h QC?'))return;
   try{await api('/task-estimates/apply',{method:'POST',body:JSON.stringify({task_id:taskId})});flash('Task Tracking estimates updated');onRefresh();}
   catch(e){setError((e as Error).message);}}
 async function removeEstimate(id:string){if(!window.confirm('Delete this estimate item?'))return;
   try{await api('/task-estimates/'+encodeURIComponent(id),{method:'DELETE'});flash('Estimate removed');await reload();}
   catch(e){setError((e as Error).message);}}
 async function importRates(){if(!selectedFile)return;setLoading(true);try{
   const response=await upload<{imported:number}>('/effort-lookup/import',selectedFile);
   flash(response.imported+' reference rates imported');setSelectedFile(null);await reload();
 }catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 async function saveRate(){setLoading(true);try{
   await api('/effort-lookup',{method:'POST',body:JSON.stringify(draftRate)});
   setShowAdd(false);flash('Reference rate saved');await reload();
 }catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 return <div className="work-estimation">
 <div className="work-flow-note"><BookOpen size={16}/><span><strong>Task → estimation item → reference rate.</strong> A saved estimate uses a rate, quantity and engineer experience. Actual effort always comes from dated timesheet entries. Only Apply to Task Tracking changes the task's planned estimate.</span></div>
 {error&&<div className="error-msg" role="alert">{error}</div>}
 <section className="panel"><div className="panel-header"><h2>Effort lookup</h2><span className="subtle">{rates.length} reference activities · EX / QC hours</span></div>
 <div className="lookup-toolbar">
 <div className="search-wrap"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search category, difficulty, code or criteria"/></div>
 <select className="input short" aria-label="Activity filter" value={activity} onChange={e=>{setActivity(e.target.value);setRateId('');}}><option value="">All activities</option>{activities.map(a=><option key={a}>{a}</option>)}</select>
 {admin&&<><input type="file" accept=".json,application/json" aria-label="Private estimation reference JSON" onChange={e=>setSelectedFile(e.target.files?.[0]||null)}/><button className="btn small" disabled={!selectedFile||loading} onClick={()=>void importRates()}><Upload size={14}/>Import reference</button><button className="btn small" onClick={()=>setShowAdd(v=>!v)}><Plus size={14}/>Add rate</button></>}
 </div>
 {showAdd&&admin&&<div className="lookup-new-rate"><input className="input" placeholder="Identifier" value={draftRate.id} onChange={e=>setDraftRate(v=>({...v,id:e.target.value}))}/><input className="input" placeholder="Activity" value={draftRate.activity} onChange={e=>setDraftRate(v=>({...v,activity:e.target.value}))}/><input className="input" placeholder="Difficulty" value={draftRate.difficulty} onChange={e=>setDraftRate(v=>({...v,difficulty:e.target.value}))}/><input className="input" placeholder="Code" value={draftRate.activity_code} onChange={e=>setDraftRate(v=>({...v,activity_code:e.target.value}))}/><input className="input" type="number" min="0" step=".1" aria-label="EX hours" value={draftRate.execution_hours} onChange={e=>setDraftRate(v=>({...v,execution_hours:Number(e.target.value)}))}/><input className="input" type="number" min="0" step=".1" aria-label="QC hours" value={draftRate.qc_hours} onChange={e=>setDraftRate(v=>({...v,qc_hours:Number(e.target.value)}))}/><input className="input" placeholder="Criteria" value={draftRate.criteria} onChange={e=>setDraftRate(v=>({...v,criteria:e.target.value}))}/><button className="btn primary" onClick={()=>void saveRate()}>Save rate</button></div>}
 <div className="table-scroll lookup-scroll"><table className="lookup-table"><thead><tr><th>Activity</th><th>Difficulty</th><th>Activity code</th><th>EX · h</th><th>QC · h</th><th>Criteria</th><th/></tr></thead><tbody>
 {visible.map(r=><tr key={r.id} className={rate?.id===r.id?'selected':''}><td>{r.activity}</td><td>{r.difficulty}</td><td className="mono">{r.activity_code}</td><td className="num">{fmtHours(r.execution_hours)}</td><td className="num">{fmtHours(r.qc_hours)}</td><td title={r.criteria}>{r.criteria}</td><td><button className="btn small" onClick={()=>setRateId(r.id)}>Use</button></td></tr>)}
 {!visible.length&&<tr><td colSpan={7} className="empty">No reference data. Admins can import the private estimation lookup JSON.</td></tr>}
 </tbody></table></div></section>
 <section className="panel"><div className="panel-header"><h2>Task estimation</h2><span className="subtle">Formula: reference hours × quantity × experience factor</span></div>
 <div className="panel-body">
 <div className="estimation-controls">
 <label>Task ID<select className="input" value={taskId} onChange={e=>setTaskId(e.target.value)}><option value="">Select task to save estimate</option>{overview.tasks.map(t=><option key={t.id} value={t.id}>{t.id} · {t.name}</option>)}</select></label>
 <label>Reference rate<select className="input" value={rate?.id||''} onChange={e=>setRateId(e.target.value)}>{visible.map(r=><option key={r.id} value={r.id}>{r.activity} · {r.difficulty} · {r.activity_code}</option>)}</select></label>
 <label>Quantity<input className="input" type="number" min="1" max="100000" step="1" value={quantity} onChange={e=>setQuantity(Math.max(1,Math.floor(Number(e.target.value)||1)))}/></label>
 <label>Experience<select className="input" value={experience} onChange={e=>setExperience(e.target.value)}><option value="Beginner">Beginner · 1.00</option><option value="Intermediate">Intermediate · 0.90</option><option value="Expert">Expert · 0.80</option></select></label>
 </div>
 <div className="estimate-result"><div><small>REFERENCE EX</small><strong>{fmtHours(rate?.execution_hours||0)}h</strong></div><div><small>REFERENCE QC</small><strong>{fmtHours(rate?.qc_hours||0)}h</strong></div><div><small>ESTIMATED EX</small><strong>{fmtHours(ex)}h</strong></div><div><small>ESTIMATED QC</small><strong>{fmtHours(qc)}h</strong></div><div><small>EST. TOTAL</small><strong>{fmtHours(ex+qc)}h</strong></div></div>
 <div className="button-line"><button className="btn primary" disabled={!admin||!rate||!taskId||loading} onClick={()=>void saveEstimate()}><Plus size={14}/>Save line to task</button>{!admin&&<span className="subtle">Preview only. Admins save and apply estimates.</span>}</div>
 {taskId&&<><h3>Saved estimation lines · {taskId}</h3><div className="table-scroll"><table><thead><tr><th>Rate</th><th>Quantity</th><th>Experience</th><th>Factor</th><th>EX hours</th><th>QC hours</th><th/></tr></thead><tbody>
 {taskItems.map(x=><tr key={x.id}><td>{rates.find(r=>r.id===x.rate_id)?.activity_code||x.rate_id}</td><td className="num">{x.quantity}</td><td>{x.experience}</td><td>{x.factor}</td><td className="num">{fmtHours(x.ex_hours)}</td><td className="num">{fmtHours(x.qc_hours)}</td><td>{admin&&<button className="icon-btn" aria-label="Delete estimate" onClick={()=>void removeEstimate(x.id)}><Trash2 size={14}/></button>}</td></tr>)}
 {!taskItems.length&&<tr><td colSpan={7} className="empty">No saved estimates for this task.</td></tr>}</tbody></table></div>
 <div className="estimate-apply"><span>Calculated task total · <strong>{fmtHours(taskTotals.ex)}h EX</strong> + <strong>{fmtHours(taskTotals.qc)}h QC</strong></span><button className="btn" disabled={!admin||!taskItems.length} onClick={()=>void applyEstimate()}>Apply to Task Tracking</button></div></>}
 </div></section></div>;
}

function TeamPage({overview,month}:{overview:Overview;month:string}){
 const days=daysOfMonth(month),byUser=overview.users.map(u=>({user:u,entries:overview.entries.filter(e=>e.user_id===u.id)}));
 return <><div className="note-line"><AlertTriangle size={15}/> The 8 h/day target is a planning reference, not a restriction. Weekends are shaded.</div>
 <section className="panel"><div className="panel-header"><h2>Team effort calendar</h2><span className="subtle">Daily logged hours by engineer</span></div><div className="timesheet-scroll"><table className="timegrid teamgrid"><thead><tr><th className="sticky-task">ENGINEER</th><th className="sticky-total">MONTH</th>{days.map(d=><th key={d} className={`day-head ${isWeekend(d)?'weekend':''}`}>{d.slice(-2)}<small>{new Date(`${d}T00:00:00`).toLocaleDateString('en',{weekday:'short'})}</small></th>)}</tr></thead><tbody>{byUser.map(({user,entries})=><tr key={user.id}><td className="sticky-task"><strong>{user.name}</strong><small>{user.id}</small></td><td className="sticky-total strong num">{fmtHours(sum(entries))}</td>{days.map(d=>{const n=sum(entries,e=>e.date===d);return <td className={`day-cell ${isWeekend(d)?'weekend':''}`} key={d}><span className={`capacity-cell ${n>8?'excess':n===8?'full':n>0?'partial':''}`}>{n?fmtHours(n):'·'}</span></td>;})}</tr>)}{!byUser.length&&<tr><td className="empty" colSpan={days.length+2}>No engineers available.</td></tr>}</tbody><tfoot><tr><td className="sticky-task"><strong>TEAM TOTAL</strong></td><td className="sticky-total num strong">{fmtHours(sum(overview.entries))}</td>{days.map(d=><td key={d} className="day-cell strong">{fmtHours(sum(overview.entries,e=>e.date===d))||'·'}</td>)}</tr></tfoot></table></div></section>
 <section className="panel"><div className="panel-header"><h2>Category breakdown</h2></div><div className="table-scroll"><table><thead><tr><th>Engineer</th><th>EX</th><th>QC</th><th>Meetings / Other</th><th>Leave / Holidays</th><th>Total</th><th>Days over 8 h</th></tr></thead><tbody>{byUser.map(({user,entries})=><tr key={user.id}><td><strong>{user.name}</strong></td><td className="num">{fmtHours(sum(entries,e=>e.role==='EX'))}</td><td className="num">{fmtHours(sum(entries,e=>e.role==='QC'))}</td><td className="num">{fmtHours(sum(entries,e=>e.kind==='Meeting/Training'||e.kind==='Other'))}</td><td className="num">{fmtHours(sum(entries,e=>e.kind.includes('Leave')||e.kind==='Public Holiday'))}</td><td className="num strong">{fmtHours(sum(entries))}</td><td className="num">{days.filter(d=>sum(entries,e=>e.date===d)>8).length}</td></tr>)}</tbody></table></div></section></>;
}
function ExchangePage({isAdmin,refresh,flash,month,selectedUser}:{isAdmin:boolean;refresh:()=>void;flash:(s:string)=>void;month:string;selectedUser:string}){
 const [mode,setMode]=useState<'tasks'|'effort'|'workbook'>('workbook'),[file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<ImportPreview|null>(null),[busy,setBusy]=useState(false),[err,setErr]=useState(''),inputRef=useRef<HTMLInputElement|null>(null),[provisionUsers,setProvisionUsers]=useState(true);
 async function importAction(commit:boolean){if(!file)return;setBusy(true);setErr('');try{if(commit){const response=await upload<{imported:number}>('/import/commit?mode='+mode+'&provisionUsers='+(provisionUsers?'1':'0'),file);flash(`${response.imported} records imported`);setPreview(null);setFile(null);if(inputRef.current)inputRef.current.value='';refresh();}else{setPreview(await upload<ImportPreview>('/import/preview?mode='+mode+'&provisionUsers='+(provisionUsers?'1':'0'),file));}}catch(e){setErr((e as Error).message);}finally{setBusy(false);}}
 return <><div className="two-col"><section className="panel"><div className="panel-header"><h2>Import workbook</h2><span className="status neutral">PREVIEW FIRST</span></div><div className="panel-body"><p className="muted">Use the Aventics Excel template. Preview all rows before writing to the internal server.</p><label>Import data type<select className="input" value={mode} onChange={e=>{setMode(e.target.value as 'tasks'|'effort'|'workbook');setPreview(null);}}>{isAdmin&&<option value="workbook">Full workbook · Task Tracking + Timesheet</option>}<option value="effort">Timesheet · daily columns (Timesheet sheet)</option>{isAdmin&&<option value="tasks">Task Tracking · 32 columns (Task Tracking sheet)</option>}</select></label>{isAdmin&&mode==='workbook'&&<label className="check-line"><input type="checkbox" checked={provisionUsers} onChange={e=>{setProvisionUsers(e.target.checked);setPreview(null);}}/>Provision missing engineers as inactive accounts (set passwords and activate them later)</label>}<label>Workbook (.xlsx)<input ref={inputRef} className="input file-input" type="file" accept=".xlsx" onChange={e=>{setFile(e.target.files?.[0]||null);setPreview(null);}}/></label><div className="button-line"><button className="btn" onClick={()=>void download(`/template?month=${month}`,'aventics-timesheet-template.xlsx')}><Download size={15}/>Download template</button><button className="btn primary" disabled={!file||busy} onClick={()=>void importAction(false)}><Upload size={15}/>{busy?'Processing…':'Preview import'}</button></div>{err&&<div className="error-msg">{err}</div>}</div></section>
 <section className="panel"><div className="panel-header"><h2>Export data</h2><span className="subtle">Formatted .xlsx</span></div><div className="panel-body"><p className="muted">Export task details or your selected engineer's dated effort. Files are generated without modifying stored data.</p><div className="export-options">{isAdmin&&<div><div><strong>Task Tracking</strong><small>32 Task Tracking columns · historical + logged actuals</small></div><button className="btn small" onClick={()=>void download('/export?mode=tasks','aventics-task-tracking.xlsx')}><Download size={14}/>Export</button></div>}<div><div><strong>Timesheet · {month}</strong><small>Excel-style date columns + detailed entries</small></div><button className="btn small" onClick={()=>void download(`/export?mode=effort&month=${month}&userId=${selectedUser}`,'aventics-timesheet.xlsx')}><Download size={14}/>Export</button></div>{isAdmin&&<div><div><strong>All engineers · {month}</strong><small>Combined monthly effort report</small></div><button className="btn small" onClick={()=>void download(`/export?mode=effort&month=${month}&userId=all`,'aventics-team-timesheet.xlsx')}><Download size={14}/>Export</button></div>}</div></div></section></div>
 {preview&&<section className="panel"><div className="panel-header"><h2>Import preview</h2><span className="subtle">{preview.tasks.length} tasks · {preview.entries.length} dated entries · {preview.errors.length} errors</span></div><div className="panel-body">{preview.errors.length?<div className="error-msg"><strong>Import blocked</strong>{preview.errors.slice(0,12).map((s,i)=><div key={i}>{s}</div>)}</div>:<div className="success-msg"><Check size={16}/>Validation passed. Confirm to write {preview.mode!=='effort'?preview.tasks.length:preview.mode==='effort'?preview.entries.length:preview.tasks.length+preview.entries.length} records.</div>}{preview.warnings.map((s,i)=><div className="warning-msg" key={i}>{s}</div>)}
 <div className="table-scroll preview-table"><table><thead><tr>{preview.mode!=='effort'?<><th>Task ID</th><th>Status</th><th>Est. EX</th><th>Est. QC</th></>:<><th>Date</th><th>Engineer</th><th>Task ID</th><th>Kind</th><th>Role</th><th>Hours</th></>}</tr></thead><tbody>{(preview.mode!=='effort'?preview.tasks:preview.entries).slice(0,15).map((r,i)=>preview.mode!=='effort'?<tr key={i}><td>{(r as Task).id}</td><td>{(r as Task).status}</td><td>{(r as Task).estimated_ex}</td><td>{(r as Task).estimated_qc}</td></tr>:<tr key={i}><td>{(r as Entry).date}</td><td>{(r as Entry).user_id}</td><td>{(r as Entry).task_id}</td><td>{(r as Entry).kind}</td><td>{(r as Entry).role}</td><td>{(r as Entry).hours}</td></tr>)}</tbody></table></div><div className="modal-actions"><span className="subtle">Showing first 15 rows</span><button className="btn primary" disabled={!!preview.errors.length||!preview.rows||busy} onClick={()=>void importAction(true)}>Confirm import</button></div></div></section>}
 <div className="note-line"><Database size={15}/> Data stays on your internal server. Imports are archived under the engineer's directory; task imports under shared/imports.</div></>;
}
function AdminPage({refresh,flash,onBrandChanged}:{refresh:()=>void;flash:(s:string)=>void;onBrandChanged:()=>void}){
 const [id,setId]=useState(''),[name,setName]=useState(''),[password,setPassword]=useState(''),[isAdmin,setIsAdmin]=useState(false),[busy,setBusy]=useState(false),[err,setErr]=useState('');
 const [svg,setSvg]=useState<File|null>(null),[brandBusy,setBrandBusy]=useState(false),[brandError,setBrandError]=useState('');
 const [hasCustom,setHasCustom]=useState(false);
 const [engineers,setEngineers]=useState<Engineer[]>([]),[credentialUser,setCredentialUser]=useState(''),[newCredential,setNewCredential]=useState('');
 const reloadEngineers=()=>api<Engineer[]>('/users').then(setEngineers).catch(e=>setErr((e as Error).message));
 useEffect(()=>{void reloadEngineers();},[]);
 async function setActive(id:string,active:boolean){
   if(!window.confirm((active?'Activate':'Deactivate')+' engineer '+id+'?'))return;
   try{await api('/users/'+encodeURIComponent(id)+'/activate',{method:'POST',body:JSON.stringify({active})});
     flash('Engineer access updated');void reloadEngineers();refresh();
   }catch(e){setErr((e as Error).message);}
 }
 async function setNewPassword(){
   if(!credentialUser||newCredential.length<12){setErr('Choose an engineer and enter a password of at least 12 characters');return;}
   try{await api('/users/'+encodeURIComponent(credentialUser)+'/password',{method:'POST',body:JSON.stringify({password:newCredential})});
     setNewCredential('');setErr('');flash('Password updated; previous sessions revoked');
   }catch(e){setErr((e as Error).message);}
 }

 useEffect(()=>{api<{custom:boolean}>('/branding/status').then(r=>setHasCustom(r.custom)).catch(()=>{});},[]);
 async function updateBrand(reset:boolean){setBrandError('');setBrandBusy(true);
  try{
    if(reset){await api('/branding/supergraphic',{method:'DELETE'});setHasCustom(false);flash('Default supergraphic restored');}
    else {if(!svg)throw new Error('Select your SVG file first');await upload('/branding/supergraphic',svg);setHasCustom(true);setSvg(null);flash('Custom supergraphic is now active');}
    onBrandChanged();
  }catch(error){setBrandError((error as Error).message);}finally{setBrandBusy(false);}
 }

 async function save(e:FormEvent){e.preventDefault();setBusy(true);setErr('');try{await api('/users',{method:'POST',body:JSON.stringify({id,name,password,is_admin:isAdmin})});flash(`Engineer ${id} created`);setId('');setName('');setPassword('');setIsAdmin(false);refresh();void reloadEngineers();}catch(e){setErr((e as Error).message);}finally{setBusy(false);}}
 return <><section className="panel"><div className="panel-header"><h2>Create engineer</h2><span className="subtle">Admin only</span></div><form onSubmit={save} className="panel-body admin-form"><p className="muted">Each engineer receives an isolated server directory and SQLite file. Login credentials are set here.</p><div className="form-row"><label>Username / folder ID<input className="input" placeholder="duynk" pattern="[a-z0-9_-]+" value={id} onChange={e=>setId(e.target.value.toLowerCase())} required/></label><label>Display name<input className="input" placeholder="Engineer name" value={name} onChange={e=>setName(e.target.value)} required/></label></div><div className="form-row"><label>Initial password (12+ characters)<input className="input" type="password" minLength={12} value={password} onChange={e=>setPassword(e.target.value)} required/></label><label className="check-line"><input type="checkbox" checked={isAdmin} onChange={e=>setIsAdmin(e.target.checked)}/>Administrator access</label></div>{err&&<div className="error-msg">{err}</div>}<button className="btn primary" disabled={busy}><Plus size={15}/>Create engineer</button></form></section>
 <section className="panel"><div className="panel-header"><h2>Engineer access</h2><span className="subtle">Provisioned imports are inactive until you activate them</span></div>
 <div className="panel-body"><div className="table-scroll"><table><thead><tr><th>Engineer</th><th>State</th><th>Access</th></tr></thead><tbody>
 {engineers.map(u=><tr key={u.id}><td><strong>{u.name}</strong><div className="mono subtle">{u.id}</div></td><td>{u.active?'Active':'Inactive'}</td><td><button className="btn small" onClick={()=>void setActive(u.id,!u.active)}>{u.active?'Deactivate':'Activate'}</button></td></tr>)}
 </tbody></table></div><p className="muted">For an imported engineer: set the password, then activate the account.</p>
 <div className="form-row"><label>Engineer<select className="input" value={credentialUser} onChange={e=>setCredentialUser(e.target.value)}><option value="">Select engineer</option>{engineers.map(u=><option key={u.id} value={u.id}>{u.name} ({u.id})</option>)}</select></label>
 <label>New password (12+ characters)<input className="input" type="password" autoComplete="new-password" value={newCredential} onChange={e=>setNewCredential(e.target.value)}/></label></div>
 <button className="btn" onClick={()=>void setNewPassword()}>Set / reset password</button>
 </div></section>
 <section className="panel"><div className="panel-header"><h2>Supergraphic · custom SVG</h2><span className="subtle">{hasCustom?'Custom asset active':'Suite default active'}</span></div>
 <div className="panel-body"><p>Upload your own supergraphic SVG to replace the top 6 px accent strip across the site. It is stored under the internal server's shared branding folder and survives app updates.</p>
 <div className="brand-upload"><input type="file" className="input file-input" accept=".svg,image/svg+xml" aria-label="Upload supergraphic SVG" onChange={e=>setSvg(e.target.files?.[0]||null)}/>
 <button className="btn primary" disabled={!svg||brandBusy} onClick={()=>void updateBrand(false)}><Upload size={14}/>Apply SVG</button>
 <button className="btn" disabled={!hasCustom||brandBusy} onClick={()=>void updateBrand(true)}>Restore default</button></div>
 <p className="subtle">SVG only · max 256 KB · no scripts or external resources. The strip uses your image's full width.</p>
 {brandError&&<div className="error-msg" role="alert">{brandError}</div>}</div></section></>;
}
export default function App(){
 const [brandRevision,setBrandRevision]=useState(0);
 const [openTaskId,setOpenTaskId]=useState<string|null>(null);
 const [sidebarCollapsed,setSidebarCollapsed]=useState(()=>{try{return localStorage.getItem(SIDEBAR_COLLAPSED_KEY)==='1';}catch{return false;}});
 useEffect(()=>{try{localStorage.setItem(SIDEBAR_COLLAPSED_KEY,sidebarCollapsed?'1':'0');}catch{}},[sidebarCollapsed]);
 const [currentUser,setCurrentUser]=useState<Engineer|null>(null),[checking,setChecking]=useState(true),[page,setPage]=useState<Page>('overview'),[month,setMonth]=useState(isoMonth(new Date())),[selectedUser,setSelectedUser]=useState(''),[overview,setOverview]=useState<Overview|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const flash=(message:string)=>{setNotice(message);};
 useEffect(()=>{api<{user:Engineer}>('/auth/me').then(r=>{setCurrentUser(r.user);setSelectedUser(r.user.id);}).catch(()=>{}).finally(()=>setChecking(false));},[]);
 const refresh=useCallback(async()=>{if(!currentUser)return;setLoading(true);setError('');try{const r=await api<Overview>(`/overview?month=${month}`);setOverview(r);setSelectedUser(old=>(old==='all'&&currentUser.is_admin)||r.users.some(u=>u.id===old)?old:(r.users[0]?.id||currentUser.id));}catch(e){setError((e as Error).message);}finally{setLoading(false);}},[currentUser,month]);
 useEffect(()=>{void refresh();},[refresh]);
 useEffect(()=>{if(!currentUser)return;const id=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh();},60000);return ()=>window.clearInterval(id);},[currentUser,refresh]);
 async function logout(){await api('/auth/logout',{method:'POST'}).catch(()=>{});setCurrentUser(null);setOverview(null);}
 function moveMonth(delta:number){const [y,m]=month.split('-').map(Number);setMonth(isoMonth(new Date(y!,m!-1+delta,1)));}
 if(checking)return <div className="loader">Loading Aventics WorkTrack…</div>;
 if(!currentUser)return <Login onDone={u=>{setCurrentUser(u);setSelectedUser(u.id);}}/>;
 const selected=overview?.users.find(u=>u.id===selectedUser);
 const pages=NAV.filter(([key])=>key!=='admin'||!!currentUser.is_admin);
 const meta:Record<Page,[string,string]>={overview:['Overview','Team effort, tracking and monthly activity'],timesheet:['Timesheet','Daily execution, QC and non-project hours'],tasks:['Task Tracking','32-column project task tracking with estimated and actual effort'],performance:['Performance Analytics','Estimated vs actual effort and project overruns'],estimation:['Estimation & Lookup','Reference rates, experience factors, and task estimation'],team:['Team capacity','Review daily workload across the team'],exchange:['Import / Export','Excel templates and controlled data exchange'],admin:['Administration','Engineer accounts and access']};
 return <div className={`app-shell ${sidebarCollapsed?'sidebar-collapsed':''}`}><Supergraphic revision={brandRevision}/>
 <header className="topbar"><div className="brand"><div className="brand-slot"><img src="/bosch-logo.svg" alt="Bosch"/></div><div className="brand-copy"><span className="brand-kicker">AVENTICS SUITE</span><strong className="brand-product">WorkTrack</strong></div></div><div className="header-context"><span className={error?"offline-dot":"online-dot"}/><span>{error?"Connection problem":"Connected"}</span></div><div className="account"><div className="user-circle">{currentUser.name.slice(0,2).toUpperCase()}</div><div><strong>{currentUser.name}</strong><small>{currentUser.is_admin?'Administrator':'Engineer'}</small></div><button className="icon-btn" onClick={()=>void logout()} title="Sign out" aria-label="Sign out"><LogOut size={17}/></button></div></header>
 <aside className="sidebar" aria-label="Workspace navigation"><div className="sidebar-heading"><div className="sidebar-label">WORKSPACE</div><button type="button" className="sidebar-toggle" onClick={()=>setSidebarCollapsed(v=>!v)} title={sidebarCollapsed?'Expand sidebar':'Collapse sidebar'} aria-label={sidebarCollapsed?'Expand sidebar':'Collapse sidebar'} aria-expanded={!sidebarCollapsed}>{sidebarCollapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}</button></div><nav aria-label="Workspace pages">{pages.map(([key,label,Icon])=><button key={key} className={page===key?'active':''} title={sidebarCollapsed?label:undefined} aria-label={label} aria-current={page===key?'page':undefined} onClick={()=>setPage(key)}><Icon size={17}/><span>{label}</span></button>)}</nav><div className="sidebar-bottom"><div className="server-tile"><Database size={17}/><div><strong>Server-managed storage</strong><span>SQLite · Per engineer</span></div></div><span>AVENTICS WORKTRACK</span><small>v0.4.0 · Web</small></div></aside>
 <main className="main"><div className="page-header"><div><div className="crumb">WORKSPACE <ChevronRight size={12}/> {meta[page][0].toUpperCase()}</div><h1>{meta[page][0]}</h1><p>{meta[page][1]}</p></div><div className="page-actions">{page!=='timesheet'&&<div className="month-picker"><button aria-label="Previous month" onClick={()=>moveMonth(-1)}><ChevronLeft size={15}/></button><input type="month" value={month} onChange={e=>setMonth(e.target.value)}/><button aria-label="Next month" onClick={()=>moveMonth(1)}><ChevronRight size={15}/></button></div>}<button className="btn small" onClick={()=>void refresh()} title="Refresh"><RefreshCw size={14}/>{loading?'Loading…':'Refresh'}</button></div></div>
 {notice&&<Notice message={notice} onClose={()=>setNotice('')}/>} {error&&<div className="error-msg">{error}</div>}
 {!overview?<div className="empty large">{loading?'Loading team data…':'No data available.'}</div>:<>
 {page==='overview'&&<OverviewPage overview={overview} month={month} onGo={setPage}/>}
 {page==='timesheet'&&<TimesheetPage overview={overview} selectedUser={selectedUser} onUser={setSelectedUser} refresh={()=>void refresh()} flash={flash} onOpenTask={setOpenTaskId}/>}
 {page==='tasks'&&<TasksPage overview={overview} onRefresh={()=>void refresh()} flash={flash} month={month} onOpenTask={setOpenTaskId}/>}
  {page==='performance'&&<PerformancePage revision={overview.entries.length+overview.tasks.length}/>}
  {page==='estimation'&&<EstimationPage overview={overview} onRefresh={()=>void refresh()} flash={flash}/>}
 {page==='team'&&<TeamPage overview={overview} month={month}/>}
 {page==='exchange'&&<ExchangePage isAdmin={!!currentUser.is_admin} refresh={()=>void refresh()} flash={flash} month={month} selectedUser={selectedUser}/>}
 {page==='admin'&&!!currentUser.is_admin&&<AdminPage refresh={()=>void refresh()} flash={flash} onBrandChanged={()=>setBrandRevision(x=>x+1)}/>}
 </>}{openTaskId&&<TaskWorkspace taskId={openTaskId} onClose={()=>setOpenTaskId(null)}/>}</main><footer className="statusbar"><span><span className={error?"offline-dot":"online-dot"}/>{error?"API error":"Connected to internal API"}</span><span>{overview?.users.length??0} engineers · {overview?.tasks.length??0} registered tasks</span><span><LockKeyhole size={12}/> Local SQLite storage</span></footer>
 </div>;
}