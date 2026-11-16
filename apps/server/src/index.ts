import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import {existsSync, writeFileSync, mkdirSync, readFileSync, renameSync, unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z,ZodError} from 'zod';
import {ENTRY_KINDS,ROLES,TASK_STATUSES,monthBounds,validHours,validIsoDate} from './domain.js';
import {bootstrap,central,createUser,newSession,hashToken,userForSession,listTasks,listUsers,listEntries,allEntries,userDb,aggregateTaskActuals,taskEffortBreakdown,upsertTask,addEntry,removeEntry,replaceEffortCell,verifyPassword,DATA_ROOT,type User,type Task} from './db.js';
import {templateWorkbook,parseWorkbook,makeExport} from './excel.js';
import {initializeWorktrack,migrateEngineer,auditEntry,writeTaskWithAudit,getAudit,taskDetail,varianceReport,listAliases,setAlias,savedViews,setSavedView,beginImport,updateImport,listImports,backupAll,listBackups} from './worktrack.js';
import {EXPERIENCE_FACTORS,listEffortRates,listTaskEstimates,addTaskEstimate,listTrackingMarks} from './db.js';


bootstrap();
initializeWorktrack();
const app=Fastify({logger:true,bodyLimit:2_000_000,trustProxy:false});
await app.register(cookie);
await app.register(multipart,{limits:{fileSize:10*1024*1024,files:1,fields:4}});
const webRoot=resolve(import.meta.dirname,'../../web/dist');
if(existsSync(webRoot))await app.register(staticPlugin,{root:webRoot,prefix:'/',wildcard:false});
const secureCookie=process.env.SESSION_SECURE === 'true';
const cookieOptions={path:'/',httpOnly:true,sameSite:'strict' as const,secure:secureCookie,maxAge:8*60*60};
type RequestWithActor=FastifyRequest&{actor:User};
function actor(r:FastifyRequest):User{return (r as RequestWithActor).actor;}
function guardAdmin(r:FastifyRequest){if(!actor(r).is_admin)throw Object.assign(new Error('Admin access required'),{statusCode:403});}
function canReadUser(r:FastifyRequest,userId:string){if(!actor(r).is_admin && actor(r).id!==userId)throw Object.assign(new Error('Cannot access another engineer'),{statusCode:403});}
function httpError(message:string,statusCode=400){return Object.assign(new Error(message),{statusCode});}
app.setErrorHandler((err,req,reply)=>{
  req.log.error(err);
  const error=err as Error & {statusCode?:number};
  const code=err instanceof ZodError?400:typeof error.statusCode==='number'&&error.statusCode!>=400&&error.statusCode!<500?error.statusCode!:500;
  reply.status(code).send({error:err instanceof ZodError?err.issues.map(i=>i.path.join('.')+': '+i.message).join('; '):code===500?'Internal server error':error.message});
});
app.addHook('preHandler',async (request)=>{
  if(!request.url.startsWith('/api/')||request.url==='/api/auth/login'||request.url==='/api/health'||request.url.startsWith('/api/branding/')&&request.method==='GET')return;
  if(!['GET','HEAD','OPTIONS'].includes(request.method)&&request.headers['x-requested-with']!=='aventics-timesheet')throw httpError('Invalid request origin',403);
  const user=userForSession(request.cookies.av_session);
  if(!user)throw httpError('Please sign in',401);
  (request as RequestWithActor).actor=user;
});
app.get('/api/health',async()=>({status:'ok',app:'aventics-work-desk',version:'0.3.0'}));
app.post('/api/auth/login',async(req,reply)=>{
  if(!['aventics-timesheet','aventics-worktrack'].includes(String(req.headers['x-requested-with']||'')))throw httpError('Invalid request origin',403);
  const input=z.object({username:z.string().min(1).max(64),password:z.string().min(1).max(256)}).parse(req.body);
  const row=central.prepare('SELECT id,password_hash,active FROM users WHERE id=?').get(input.username.trim().toLowerCase()) as {id:string,password_hash:string,active:number}|undefined;
  if(!row||!row.active||!verifyPassword(input.password,row.password_hash))throw httpError('Invalid username or password',401);
  const token=newSession(row.id);reply.setCookie('av_session',token,cookieOptions);
  return {user:userForSession(token)};
});
app.post('/api/auth/logout',async(req,reply)=>{
  const token=req.cookies.av_session;if(token)central.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
  reply.clearCookie('av_session',{path:'/'});return {ok:true};
});
app.get('/api/auth/me',async(req)=>({user:actor(req)}));
app.get('/api/users',async(req)=>listUsers());
app.post('/api/users',async(req)=>{
  guardAdmin(req);
  const input=z.object({id:z.string().min(2),name:z.string().min(1).max(100),password:z.string().min(12),is_admin:z.boolean().default(false)}).parse(req.body);
  return createUser(input);
});
app.post('/api/users/:id/activate',async(req)=>{
 guardAdmin(req);const {id}=req.params as {id:string};
 const {active}=z.object({active:z.boolean()}).parse(req.body);
 const result=central.prepare('UPDATE users SET active=? WHERE id=?').run(active?1:0,id);
 if(!result.changes)throw httpError('Engineer not found',404);
 if(!active)central.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
 return {ok:true};
});
app.post('/api/users/:id/password',async(req)=>{
  guardAdmin(req);const {id}=req.params as {id:string};const body=z.object({password:z.string().min(12)}).parse(req.body);
  const {passwordHash}=await import('./db.js');
  const change=central.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash(body.password),id);
  central.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  if(!change.changes)throw httpError('Engineer not found',404);return {ok:true};
});
app.get('/api/tasks',async()=>listTasks());
app.get('/api/tasks/:id/detail',async(req)=>{
 const {id}=req.params as {id:string};const detail=taskDetail(id,actor(req).id,!!actor(req).is_admin);
 if(!detail)throw httpError('Task not found',404);return detail;
});
app.get('/api/tasks/:id/history',async(req)=>{
 const {id}=req.params as {id:string};
 if(!actor(req).is_admin)throw httpError('Admin access required',403);
 return central.prepare("SELECT * FROM task_audit_events WHERE entity_type='task' AND entity_id=? ORDER BY created_at DESC LIMIT 100").all(id);
});
app.get('/api/reports/variance',async(req)=>{
 const filter=z.object({project:z.string().optional(),engineer:z.string().optional(),status:z.string().optional()}).parse(req.query);
 return varianceReport(actor(req).id,!!actor(req).is_admin).filter(r=>(!filter.project||r.project_id===filter.project)&&(!filter.engineer||r.engineer===filter.engineer)&&(!filter.status||r.status===filter.status));
});
app.get('/api/task-aliases',async()=>listAliases());
app.post('/api/task-aliases',async(req)=>{
 guardAdmin(req);const {alias,task_id}=z.object({alias:z.string().min(1).max(200),task_id:z.string().min(1).max(200)}).parse(req.body);
 setAlias(alias,task_id,actor(req).id);return {ok:true};
});
app.get('/api/views',async(req)=>savedViews(actor(req).id).map(v=>({id:v.view_id,config:JSON.parse(v.config_json),updated_at:v.updated_at})));
app.put('/api/views/:id',async(req)=>{
 const id=(req.params as {id:string}).id;
 if(!/^[a-z0-9_-]{1,40}$/.test(id))throw httpError('Invalid view ID');
 const {config}=z.object({config:z.record(z.string(),z.unknown())}).parse(req.body);
 setSavedView(actor(req).id,id,config);return {ok:true};
});
app.get('/api/audit',async(req)=>{const {taskId}=z.object({taskId:z.string().optional()}).parse(req.query);
 return getAudit(actor(req).id,!!actor(req).is_admin,taskId);
});
app.get('/api/admin/imports',async(req)=>{guardAdmin(req);return listImports();});
app.get('/api/admin/backups',async(req)=>{guardAdmin(req);return listBackups();});
app.post('/api/admin/backups',async(req)=>{guardAdmin(req);const result=await backupAll();return result;});

const taskSchema=z.object({
 id:z.string().trim().min(1).max(200),
 serial_no:z.string().max(300).default(''),ip_no:z.string().max(300).default(''),
 series:z.string().max(300).default(''),revision:z.string().max(300).default(''),
 name:z.string().max(1000).default(''),email_subject:z.string().max(3000).default(''),
 engineer:z.string().max(300).default(''),qc_engineer:z.string().max(300).default(''),
 estimated_ex:z.number().finite().min(0).default(0),actual_ex_baseline:z.number().finite().min(0).default(0),
 estimated_qc:z.number().finite().min(0).default(0),actual_qc_baseline:z.number().finite().min(0).default(0),
 rework_effort:z.string().max(500).default(''),status:z.enum(TASK_STATUSES).default('Not started'),
 planned_start_date:z.string().default(''),start_date:z.string().default(''),
 planned_completion_date:z.string().default(''),completion_date:z.string().default(''),
 activity_code:z.string().max(300).default(''),required_internal:z.string().max(300).default(''),
 self_qc_completion_date:z.string().default(''),internal_errors:z.number().finite().min(0).default(0),
 flexibility:z.string().max(300).default(''),customer_approval_date:z.string().default(''),
 task_type:z.string().max(300).default(''),code_add:z.string().max(300).default(''),
 code_update:z.string().max(300).default(''),mu_execution:z.number().finite().min(0).default(0),mu_qc:z.number().finite().min(0).default(0)
});
const TASK_DATE_KEYS=['planned_start_date','start_date','planned_completion_date','completion_date','self_qc_completion_date','customer_approval_date'] as const;
function validateTaskDates(input:z.infer<typeof taskSchema>) {
 for(const key of TASK_DATE_KEYS)if(input[key]&&!validIsoDate(input[key]))throw httpError(`${key}: use YYYY-MM-DD`);
}
app.post('/api/tasks',async(req)=>{
  guardAdmin(req);const input=taskSchema.extend({expected_updated_at:z.string().optional()}).parse(req.body);
  validateTaskDates(input);
  const {expected_updated_at,...task}=input;
  writeTaskWithAudit(task,actor(req).id,expected_updated_at);return {ok:true};
});
app.post('/api/tasks/bulk',async(req)=>{
 guardAdmin(req);
 const {tasks}=z.object({tasks:z.array(taskSchema.extend({expected_updated_at:z.string().optional()})).min(1).max(500)}).parse(req.body);
 const seen=new Set<string>();for(const task of tasks){
   if(seen.has(task.id))throw httpError('Repeated Task ID in paste');seen.add(task.id);validateTaskDates(task);
 }
 central.transaction(()=>{for(const task of tasks){const {expected_updated_at,...payload}=task;writeTaskWithAudit(payload,actor(req).id,expected_updated_at);}})();
 return {ok:true,updated:tasks.length};
});
app.get('/api/overview',async(req)=>{
  const {month}=z.object({month:z.string()}).parse(req.query);
  const {start,end}=monthBounds(month);const current=actor(req);
  const users=listUsers().filter(u=>current.is_admin||u.id===current.id);
  const entries=current.is_admin?allEntries(start,end):listEntries(current.id,start,end).map(e=>({...e,user_id:current.id}));
  return {users,tasks:listTasks(),entries,taskActuals:aggregateTaskActuals(users.map(u=>u.id)),start,end,role:current.is_admin?'admin':'member'};
});

/** Excel-like year and month browsing. Default is the whole calendar year. */
app.get('/api/timesheet-range',async(req)=>{
 const input=z.object({year:z.coerce.number().int().min(2000).max(2100),month:z.enum(['all','01','02','03','04','05','06','07','08','09','10','11','12']).default('all')}).parse(req.query);
 const start=input.month==='all'?`${input.year}-01-01`:`${input.year}-${input.month}-01`;
 const end=input.month==='all'?`${input.year}-12-31`:monthBounds(`${input.year}-${input.month}`).end;
 const me=actor(req),entries=me.is_admin?allEntries(start,end):listEntries(me.id,start,end).map(e=>({...e,user_id:me.id}));
 return {start,end,entries,year:input.year,month:input.month};
});
const rateSchema=z.object({
 id:z.string().trim().min(1).max(80),activity:z.string().trim().min(1).max(120),
 difficulty:z.string().trim().min(1).max(80),activity_code:z.string().trim().min(1).max(120),
 execution_hours:z.number().finite().min(0).max(100000),qc_hours:z.number().finite().min(0).max(100000),
 criteria:z.string().max(4000).default('')
});
app.get('/api/effort-lookup',async()=>({rates:listEffortRates(),factors:EXPERIENCE_FACTORS}));
app.post('/api/effort-lookup/import',async(req)=>{
 guardAdmin(req);
 const file=await req.file();if(!file||!file.filename.toLowerCase().endsWith('.json'))throw httpError('Upload a JSON reference file');
 const bytes=await file.toBuffer();let parsed:unknown;
 try{parsed=JSON.parse(bytes.toString('utf8'));}catch{throw httpError('Invalid JSON');}
 const input=z.object({version:z.number().optional(),rates:z.array(rateSchema).min(1).max(2000)}).parse(parsed);
 const ids=new Set<string>(),codes=new Set<string>();
 for(const rate of input.rates){if(ids.has(rate.id)||codes.has(rate.activity_code))throw httpError('Duplicate rate identifier or activity code in file');ids.add(rate.id);codes.add(rate.activity_code);}
 central.transaction(()=>{
  const stmt=central.prepare(`INSERT INTO effort_rates(id,activity,difficulty,activity_code,execution_hours,qc_hours,criteria)
   VALUES(@id,@activity,@difficulty,@activity_code,@execution_hours,@qc_hours,@criteria)
   ON CONFLICT(id) DO UPDATE SET activity=excluded.activity,difficulty=excluded.difficulty,
   activity_code=excluded.activity_code,execution_hours=excluded.execution_hours,qc_hours=excluded.qc_hours,
   criteria=excluded.criteria,updated_at=CURRENT_TIMESTAMP`);
  for(const rate of input.rates)stmt.run(rate);
 })();
 return {ok:true,imported:input.rates.length};
});
app.post('/api/effort-lookup',async(req)=>{
 guardAdmin(req);const rate=rateSchema.parse(req.body);
 central.prepare(`INSERT INTO effort_rates(id,activity,difficulty,activity_code,execution_hours,qc_hours,criteria)
 VALUES(@id,@activity,@difficulty,@activity_code,@execution_hours,@qc_hours,@criteria)
 ON CONFLICT(id) DO UPDATE SET activity=excluded.activity,difficulty=excluded.difficulty,
 activity_code=excluded.activity_code,execution_hours=excluded.execution_hours,qc_hours=excluded.qc_hours,
 criteria=excluded.criteria,updated_at=CURRENT_TIMESTAMP`).run(rate);return {ok:true};
});
app.get('/api/task-estimates',async()=>listTaskEstimates());
app.post('/api/task-estimates',async(req)=>{
 guardAdmin(req);const input=z.object({task_id:z.string().min(1),rate_id:z.string().min(1),
 quantity:z.number().int().min(1).max(100000),experience:z.enum(['Beginner','Intermediate','Expert'])}).parse(req.body);
 return addTaskEstimate({...input,created_by:actor(req).id});
});
app.delete('/api/task-estimates/:id',async(req)=>{
 guardAdmin(req);const id=(req.params as {id:string}).id;
 const changed=central.prepare('DELETE FROM task_estimates WHERE id=?').run(id).changes;
 if(!changed)throw httpError('Estimate not found',404);return {ok:true};
});
app.post('/api/task-estimates/apply',async(req)=>{
 guardAdmin(req);const {task_id}=z.object({task_id:z.string().min(1)}).parse(req.body);
 const totals=central.prepare('SELECT COUNT(*) n,SUM(ex_hours) ex,SUM(qc_hours) qc FROM task_estimates WHERE task_id=?').get(task_id) as {n:number;ex:number|null;qc:number|null};
 if(!totals.n)throw httpError('No estimate items for this Task ID');
 const changed=central.prepare('UPDATE tasks SET estimated_ex=?,estimated_qc=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(totals.ex||0,totals.qc||0,task_id);
 if(!changed.changes)throw httpError('Task not found',404);
 return {ok:true,estimated_ex:totals.ex,estimated_qc:totals.qc};
});
const markSchema=z.object({scope:z.enum(['cell','row','column']),task_id:z.string().max(200).default(''),column_key:z.string().max(100).default(''),
 fill_color:z.enum(['','#e7f2f1','#fff4d6','#e5f3f8','#fde8e9']).default(''),
 text_color:z.enum(['','#0e625e','#865600','#004975','#ac2027']).default(''),pinned:z.boolean().default(false)});
app.get('/api/tracking-marks',async(req)=>listTrackingMarks(actor(req).id));
app.post('/api/tracking-marks',async(req)=>{
 const mark=markSchema.parse(req.body);
 if((mark.scope==='row'&&!mark.task_id)||(mark.scope==='column'&&!mark.column_key)||(mark.scope==='cell'&&(!mark.task_id||!mark.column_key)))
  throw httpError('Specify a target row, column, or cell');
 const {TASK_WRITABLE_COLUMNS}=await import('./task-fields.js');
 if(mark.column_key&&!TASK_WRITABLE_COLUMNS.some(x=>x===mark.column_key)&&!['total_estimated','total_actual'].includes(mark.column_key))
  throw httpError('Invalid target column');
 if(mark.task_id&&!central.prepare('SELECT id FROM tasks WHERE id=?').get(mark.task_id))throw httpError('Unknown Task ID');
 central.prepare(`INSERT INTO tracking_marks(user_id,scope,task_id,column_key,fill_color,text_color,pinned) VALUES(?,?,?,?,?,?,?)
 ON CONFLICT(user_id,scope,task_id,column_key) DO UPDATE SET fill_color=excluded.fill_color,text_color=excluded.text_color,pinned=excluded.pinned`).run(
 actor(req).id,mark.scope,mark.task_id,mark.column_key,mark.fill_color,mark.text_color,mark.pinned?1:0);
 return {ok:true};
});
app.delete('/api/tracking-marks',async(req)=>{
 const mark=z.object({scope:z.enum(['cell','row','column']),task_id:z.string().default(''),column_key:z.string().default('')}).parse(req.body);
 central.prepare('DELETE FROM tracking_marks WHERE user_id=? AND scope=? AND task_id=? AND column_key=?').run(actor(req).id,mark.scope,mark.task_id,mark.column_key);
 return {ok:true};
});

app.get('/api/entries',async(req)=>{
  const input=z.object({userId:z.string(),month:z.string()}).parse(req.query);canReadUser(req,input.userId);
  const {start,end}=monthBounds(input.month);return listEntries(input.userId,start,end);
});
const entrySchema=z.object({
 user_id:z.string().min(1),date:z.string(),task_id:z.string().default(''),kind:z.enum(ENTRY_KINDS),role:z.enum(ROLES),hours:z.number(),note:z.string().max(500).default('')
});
function checkEntry(input:z.infer<typeof entrySchema>):void {
  if(!validIsoDate(input.date)||!validHours(input.hours))throw httpError('Date must be YYYY-MM-DD; hours in 0.25 increments between 0.25 and 24');
  if(input.kind==='Task'){
    if(!input.task_id||input.role==='NA')throw httpError('Task work requires a task ID and EX/QC role');
    if(!central.prepare('SELECT 1 FROM tasks WHERE id=?').get(input.task_id))throw httpError('Unknown Task ID: import/create the task first');
  } else if(input.task_id||input.role!=='NA')throw httpError('Non-task time must have blank Task ID and NA role');
  if(!listUsers().some(u=>u.id===input.user_id&&u.active))throw httpError('Unknown engineer');
}
app.post('/api/entries',async(req)=>{
  const input=entrySchema.parse(req.body);canReadUser(req,input.user_id);checkEntry(input);
  const {user_id,...data}=input;const db=userDb(user_id);migrateEngineer(user_id);
  return db.transaction(()=>{const previous=db.prepare('SELECT * FROM entries WHERE date=? AND task_id=? AND kind=? AND role=? AND note=?').get(data.date,data.task_id,data.kind,data.role,data.note);
    const saved=addEntry(user_id,data);auditEntry(user_id,actor(req).id,saved.id,previous?'update':'create',previous,saved);return saved;})();
});
// Spreadsheet-style cell updates; owner/admin authorization and conflict checks on server.
const cellSchema=z.object({user_id:z.string(),date:z.string(),task_id:z.string().default(''),kind:z.enum(ENTRY_KINDS),role:z.enum(ROLES),hours:z.number().finite().min(0).max(24),expected_hours:z.number().finite().min(0).max(24).optional()});
app.post('/api/effort-cells',async(req)=>{
 const {cells}=z.object({cells:z.array(cellSchema).min(1).max(1000)}).parse(req.body);
 const seen=new Set<string>(),groups=new Map<string,typeof cells>();
 for(const cell of cells){
   canReadUser(req,cell.user_id);
   if(!validIsoDate(cell.date)|| (cell.hours!==0&&!validHours(cell.hours)))throw httpError('Use valid dates and quarter-hour values (0 to 24)');
   checkEntry({...cell,hours:cell.hours||0.25,note:''});
   const key=JSON.stringify([cell.user_id,cell.date,cell.task_id,cell.kind,cell.role]);
   if(seen.has(key))throw httpError('Duplicate cell in batch');seen.add(key);
   const group=groups.get(cell.user_id)||[];group.push(cell);groups.set(cell.user_id,group);
 }
 // Preflight all groups before making writes (a multi-engineer write still cannot be atomic across files).
 for(const [userId,group] of groups){const db=userDb(userId);for(const cell of group){
   const {n}=db.prepare('SELECT COUNT(*) n FROM entries WHERE date=? AND task_id=? AND kind=? AND role=?').get(cell.date,cell.task_id,cell.kind,cell.role) as {n:number};
   if(n>1)throw httpError(`Cell ${cell.date} / ${cell.task_id||cell.kind} has multiple entries; use the details editor`,409);
   if(cell.expected_hours!==undefined){
     const current=db.prepare('SELECT COALESCE(SUM(hours),0) total FROM entries WHERE date=? AND task_id=? AND kind=? AND role=?').get(cell.date,cell.task_id,cell.kind,cell.role) as {total:number};
     if(Math.abs(current.total-cell.expected_hours)>0.00001)throw httpError('Cell changed since you opened it; refresh before overwriting.',409);
   }
 }}
 for(const [userId,group] of groups){migrateEngineer(userId);userDb(userId).transaction(()=>{for(const cell of group){
  const db=userDb(userId);
  const before=db.prepare('SELECT * FROM entries WHERE date=? AND task_id=? AND kind=? AND role=?').get(cell.date,cell.task_id,cell.kind,cell.role) as {id:string}|undefined;
  replaceEffortCell(userId,cell);
  const after=db.prepare('SELECT * FROM entries WHERE date=? AND task_id=? AND kind=? AND role=?').get(cell.date,cell.task_id,cell.kind,cell.role) as {id:string}|undefined;
  auditEntry(userId,actor(req).id,after?.id||before?.id||randomUUID(),cell.hours===0?'clear':'update',before,after);
 }})();}
 return {ok:true,updated:cells.length};
});
app.delete('/api/entries/:id',async(req)=>{
  const input=z.object({userId:z.string()}).parse(req.query);canReadUser(req,input.userId);
  migrateEngineer(input.userId);const db=userDb(input.userId),id=(req.params as {id:string}).id;
 return db.transaction(()=>{const before=db.prepare('SELECT * FROM entries WHERE id=?').get(id);
   const deleted=removeEntry(input.userId,id);
   if(deleted)auditEntry(input.userId,actor(req).id,id,'delete',before,null);
   return {deleted};})();
});
// Custom supergraphic is served as a sandboxed image, never as an executable document.
const brandDir=join(DATA_ROOT,'shared','branding');
const supergraphicPath=join(brandDir,'supergraphic.svg');
function validateSupergraphicSvg(text:string):void {
 if(text.length>256*1024 || !/^\s*(?:<\?xml[^>]*>\s*)?<svg\s[\s\S]*<\/svg>\s*$/i.test(text))throw httpError('Provide an SVG image smaller than 256 KB');
 // Reject active tags, event handlers, external references and entities.
 if(/<\s*(?:script|foreignObject|iframe|object|embed|image|link|audio|video|animate|set|feImage)\b/i.test(text)
  ||/\bon[a-z]+\s*=/i.test(text)||/\b(?:href|xlink:href)\s*=\s*['\"](?!#)/i.test(text)
  ||/\b(?:href|xlink:href)\s*=\s*[^'\"\s>]/i.test(text))throw httpError('SVG includes active or unsafe content');
 // SVG namespace URLs are not external dependencies; leave only those untouched.
 const withoutNamespaces=text.replace(/\sxmlns(?::xlink)?\s*=\s*(['\"])http:\/\/www\.w3\.org\/(?:2000\/svg|1999\/xlink)\1/gi,'');
 const withoutFragmentUrls=withoutNamespaces.replace(/url\(\s*(?:['\"]#[^'\")]+['\"]|#[^)]+)\s*\)/gi,'');
 if(/(?:javascript:|data:|https?:|file:|@import|<!DOCTYPE|<!ENTITY|<\?xml-stylesheet)/i.test(withoutFragmentUrls)
  ||/url\s*\(/i.test(withoutFragmentUrls))throw httpError('SVG includes an external resource or unsafe XML construct');
}
app.get('/api/branding/status',async()=>({custom:existsSync(supergraphicPath)}));
app.get('/api/branding/supergraphic.svg',async(_req,reply)=>{
 if(!existsSync(supergraphicPath))return reply.code(404).send({error:'No custom SVG'});
 reply.header('Cache-Control','no-store');
 reply.header('Content-Security-Policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'none'");
 reply.header('X-Content-Type-Options','nosniff');
 reply.type('image/svg+xml; charset=utf-8');return reply.send(readFileSync(supergraphicPath));
});
app.post('/api/branding/supergraphic',async(req)=>{
 guardAdmin(req);const file=await req.file();if(!file||!file.filename.toLowerCase().endsWith('.svg'))throw httpError('Upload a .svg file');
 const bytes=await file.toBuffer(),body=bytes.toString('utf8');validateSupergraphicSvg(body);
 mkdirSync(brandDir,{recursive:true});const tmp=join(brandDir,`supergraphic-${randomUUID()}.tmp`);
 try{writeFileSync(tmp,body);renameSync(tmp,supergraphicPath);}finally{if(existsSync(tmp))unlinkSync(tmp);}
 return {ok:true,custom:true};
});
app.delete('/api/branding/supergraphic',async(req)=>{
 guardAdmin(req);if(existsSync(supergraphicPath))unlinkSync(supergraphicPath);return {ok:true,custom:false};
});
app.get('/api/template',async(req,reply)=>{
  const {month}=z.object({month:z.string().optional()}).parse(req.query);
  const chosen=month||new Date().toISOString().slice(0,7);monthBounds(chosen);
  const wb=templateWorkbook(chosen);const buf=await wb.xlsx.writeBuffer();
  reply.header('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  reply.header('Content-Disposition','attachment; filename="aventics-timesheet-template.xlsx"');return reply.send(Buffer.from(buf));
});
app.get('/api/export',async(req,reply)=>{
  const input=z.object({mode:z.enum(['tasks','effort']),month:z.string().optional(),userId:z.string().optional()}).parse(req.query);
  if(input.mode==='tasks')guardAdmin(req);
  const range=monthBounds(input.month||new Date().toISOString().slice(0,7));
  const selected=input.userId||actor(req).id;
  if(input.mode==='effort' && selected!=='all')canReadUser(req,selected);
  if(selected==='all'&&!actor(req).is_admin)throw httpError('Admin access required',403);
  const entries=input.mode==='effort'?(selected==='all'?allEntries(range.start,range.end):listEntries(selected,range.start,range.end).map(e=>({...e,user_id:selected}))):[];
  const wb=makeExport(input.mode,listTasks(),entries,input.mode==='tasks'?taskEffortBreakdown():[],range.start.slice(0,7));
  const buffer=await wb.xlsx.writeBuffer();const file=`aventics-${input.mode}-${input.mode==='tasks'?'catalog':input.month||'current'}.xlsx`;
  reply.header('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  reply.header('Content-Disposition',`attachment; filename="${file}"`);return reply.send(Buffer.from(buffer));
});
async function receiveWorkbook(req:FastifyRequest,mode:'tasks'|'effort'|'workbook',provisionUsers=false){
  if(mode!=='effort')guardAdmin(req);
  const file=await req.file();if(!file)throw httpError('Choose an .xlsx file');
  if(!file.filename.toLowerCase().endsWith('.xlsx'))throw httpError('Only .xlsx workbooks are supported');
  const bytes=await file.toBuffer();
  if(bytes.length<4 || bytes[0]!==0x50||bytes[1]!==0x4b)throw httpError('Invalid XLSX file');
  const preview=await parseWorkbook(bytes,mode,actor(req).id,!!actor(req).is_admin);
  if(mode!=='effort'){
    const old=new Map(listTasks().map(t=>[t.id,t]));
    const present=new Set(preview.present_task_fields||[]);
    const logged=aggregateTaskActuals(listUsers().map(u=>u.id));
    for(let i=0;i<preview.tasks.length;i++){
      const t=preview.tasks[i]!,prior=old.get(t.id);if(!prior)continue;
      // Imports of previous small catalog sheets must not wipe newly added tracking columns.
      for(const [key,value] of Object.entries(prior)){
        if(key==='updated_at'||key==='id'||present.has(key))continue;
        (t as unknown as Record<string,unknown>)[key]=value;
      }
      // An app-generated Task Tracking export includes logged effort. Reimporting it
      // must not turn those hours into a second historical baseline.
      for(const [field,role] of [['actual_ex_baseline','ex'],['actual_qc_baseline','qc']] as const){
        if(!present.has(field))continue;
        const tracked=logged[t.id]?.[role]||0;
        const imported=t[field],oldTotal=prior[field]+tracked;
        if(Math.abs(imported-oldTotal)<0.0001)t[field]=prior[field];
        else if(tracked>0&&Math.abs(imported-prior[field])>0.0001)
          preview.warnings.push(`${t.id}: imported ${role.toUpperCase()} actual is treated as a historical baseline in addition to ${tracked} h logged. Review for overlap.`);
      }
    }
  }
  if(mode!=='tasks'){

    const sourceIds=[...listTasks().map(x=>x.id),...preview.tasks.map(x=>x.id)];
    const approvedAliases=new Map(listAliases().map(a=>[a.alias.toLowerCase(),a.task_id]));
    const direct=new Map(sourceIds.map(id=>[id.toLowerCase(),id]));
    const alias=new Map<string,Set<string>>();
    for(const id of sourceIds){const short=id.toLowerCase().match(/^\d+-ip\d+/)?.[0];
      if(short){const entries=alias.get(short)||new Set<string>();entries.add(id);alias.set(short,entries);}
    }
    const users=new Set(listUsers().map(u=>u.id));
    const missing=new Set<string>();let normalized=0;
    for(const entry of preview.entries){
      if(entry.kind==='Task'){
        const raw=entry.task_id.trim(),prefix=raw.toLowerCase().match(/^\d+-ip\d+/)?.[0];
        const matches=prefix?alias.get(prefix):undefined;
        const id=direct.get(raw.toLowerCase())||approvedAliases.get(raw.toLowerCase())||(matches?.size===1?[...matches][0]:undefined);
        if(!id)preview.errors.push('Unknown or ambiguous Task ID: '+raw);
        else {if(id!==entry.task_id)normalized++;entry.task_id=id;}
      }
      if(!users.has(entry.user_id))missing.add(entry.user_id);
      if(!users.has(entry.user_id)||entry.note!=='')continue;
      const db=userDb(entry.user_id);
      const existing=db.prepare("SELECT COUNT(*) n FROM entries WHERE date=? AND task_id=? AND kind=? AND role=? AND note != ''").get(entry.date,entry.task_id,entry.kind,entry.role) as {n:number};
      if(existing.n)preview.errors.push(entry.user_id+' / '+entry.date+' / '+entry.task_id+': existing notes require detail editing');
    }
    for(const id of preview.engineers||[])if(!users.has(id))missing.add(id);
    if(normalized)preview.warnings.push(normalized+' dated effort entries matched using a unique serial/project Task ID prefix.');
    if(missing.size){
      const message='Missing engineer accounts: '+[...missing].sort().join(', ');
      if(mode==='workbook'&&provisionUsers)preview.warnings.push(message+'. These accounts will be provisioned as INACTIVE; activate and set passwords in Administration.');
      else preview.errors.push(message+'. Create them or select provision disabled accounts on the full workbook import.');
    }
  }
  // Audit-friendly, read-only reconciliation. Task fields are compared only when supplied in the input sheet.
  const reconciliation={newTasks:0,changedTasks:0,unchangedTasks:0,newEntries:0,changedEntries:0,identicalEntries:0,taskDiffs:[] as Array<{task_id:string;field:string;existing:string;incoming:string}>};
  const knownTasks=new Map(listTasks().map(t=>[t.id,t]));
  const presentFields=preview.present_task_fields||[];
  for(const incoming of preview.tasks){
    const old=knownTasks.get(incoming.id);
    if(!old){reconciliation.newTasks++;continue;}
    let changed=false;
    for(const field of presentFields){
      const before=String((old as unknown as Record<string,unknown>)[field]??'');
      const after=String((incoming as unknown as Record<string,unknown>)[field]??'');
      if(before===after)continue;changed=true;
      if(reconciliation.taskDiffs.length<100)reconciliation.taskDiffs.push({task_id:incoming.id,field,existing:before,incoming:after});
    }
    if(changed)reconciliation.changedTasks++;else reconciliation.unchangedTasks++;
  }
  for(const entry of preview.entries){
    const userExists=central.prepare('SELECT 1 FROM users WHERE id=?').get(entry.user_id);
    if(!userExists){reconciliation.newEntries++;continue;}
    const existing=userDb(entry.user_id).prepare('SELECT hours FROM entries WHERE date=? AND task_id=? AND kind=? AND role=? AND note=?').get(entry.date,entry.task_id,entry.kind,entry.role,entry.note) as {hours:number}|undefined;
    if(!existing)reconciliation.newEntries++;
    else if(Math.abs(existing.hours-entry.hours)>0.00001)reconciliation.changedEntries++;
    else reconciliation.identicalEntries++;
  }
  preview.reconciliation=reconciliation;
  return {preview,bytes};
}
app.post('/api/import/preview',async(req)=>{
  const {mode,provisionUsers}=z.object({mode:z.enum(['tasks','effort','workbook']),provisionUsers:z.enum(['0','1']).default('0')}).parse(req.query);
  const {preview}=await receiveWorkbook(req,mode,provisionUsers==='1');return preview;
});
app.post('/api/import/commit',async(req)=>{
  const {mode,provisionUsers,conflictPolicy}=z.object({mode:z.enum(['tasks','effort','workbook']),provisionUsers:z.enum(['0','1']).default('0'),conflictPolicy:z.enum(['overwrite','keep-existing']).default('overwrite')}).parse(req.query);
  const {preview,bytes}=await receiveWorkbook(req,mode,provisionUsers==='1');
  if(preview.errors.length||!preview.rows)throw httpError(`Import rejected: ${preview.errors.slice(0,4).join('; ') || 'No rows'}`);
  // Snapshot before writing across independent SQLite files; safe recovery is an offline, coordinated restore.
  const backup=actor(req).is_admin?await backupAll():null;
  const jobId=beginImport(actor(req).id,mode,bytes,preview.tasks.length,preview.entries.length,backup?.id||'');
  const processed:string[]=[];
  try{
    if(mode==='workbook'&&provisionUsers){
      const existing=new Set(listUsers().map(u=>u.id));
      for(const id of new Set(preview.engineers||preview.entries.map(e=>e.user_id)))if(!existing.has(id)){
        createUser({id,name:id,password:randomUUID()+randomUUID(),active:false});migrateEngineer(id);
      }
    }
    if(mode!=='effort')central.transaction(()=>{for(const task of preview.tasks){
      if(conflictPolicy==='keep-existing'&&central.prepare('SELECT 1 FROM tasks WHERE id=?').get(task.id))continue;
      writeTaskWithAudit(task,actor(req).id);
    }})();
    if(mode!=='tasks'){
      const groups=new Map<string,typeof preview.entries>();
      for(const entry of preview.entries){const rows=groups.get(entry.user_id)||[];rows.push(entry);groups.set(entry.user_id,rows);}
      for(const [userId,rows] of groups){
        migrateEngineer(userId);const db=userDb(userId);
        db.transaction(()=>{for(const {user_id,...record} of rows){
          const old=db.prepare('SELECT * FROM entries WHERE date=? AND task_id=? AND kind=? AND role=? AND note=?')
            .get(record.date,record.task_id,record.kind,record.role,record.note);
          if(conflictPolicy==='keep-existing'&&old)continue;
          const fresh=addEntry(user_id,record);
          auditEntry(user_id,actor(req).id,fresh.id,old?'import-update':'import-create',old,fresh);
        }})();
        processed.push(userId);
      }
    }
    updateImport(jobId,'completed',processed);
  }catch(error){
    updateImport(jobId,processed.length?'partial':'failed',processed,(error as Error).message);
    throw error;
  }
    const folder=mode==='effort'?join(DATA_ROOT,'users',actor(req).id,'imports'):join(DATA_ROOT,'shared','imports');
  mkdirSync(folder,{recursive:true});writeFileSync(join(folder,`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}.xlsx`),bytes);
  return {ok:true,jobId,backupId:backup?.id||null,conflictPolicy,mode,imported:mode==='tasks'?preview.tasks.length:mode==='effort'?preview.entries.length:preview.tasks.length+preview.entries.length};
});
app.setNotFoundHandler((req,reply)=>{
  if(req.url.startsWith('/api/'))return reply.code(404).send({error:'Not found'});
  const index=join(webRoot,'index.html');if(existsSync(index))return reply.type('text/html').sendFile('index.html');
  return reply.code(404).send({error:'Web UI not built. Run npm run build.'});
});
const port=Number(process.env.PORT||4177);
await app.listen({port,host:process.env.HOST||'127.0.0.1'});