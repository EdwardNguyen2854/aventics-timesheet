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

bootstrap();
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
  const code=err instanceof ZodError?400:typeof err.statusCode==='number'&&err.statusCode>=400&&err.statusCode<500?err.statusCode:500;
  reply.status(code).send({error:err instanceof ZodError?err.issues.map(i=>i.path.join('.')+': '+i.message).join('; '):code===500?'Internal server error':err.message});
});
app.addHook('preHandler',async (request)=>{
  if(!request.url.startsWith('/api/')||request.url==='/api/auth/login'||request.url==='/api/health'||request.url.startsWith('/api/branding/')&&request.method==='GET')return;
  if(!['GET','HEAD','OPTIONS'].includes(request.method)&&request.headers['x-requested-with']!=='aventics-timesheet')throw httpError('Invalid request origin',403);
  const user=userForSession(request.cookies.av_session);
  if(!user)throw httpError('Please sign in',401);
  (request as RequestWithActor).actor=user;
});
app.get('/api/health',async()=>({status:'ok',app:'aventics-timesheet',version:'0.2.0'}));
app.post('/api/auth/login',async(req,reply)=>{
  if(req.headers['x-requested-with']!=='aventics-timesheet')throw httpError('Invalid request origin',403);
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
app.post('/api/users/:id/password',async(req)=>{
  guardAdmin(req);const {id}=req.params as {id:string};const body=z.object({password:z.string().min(12)}).parse(req.body);
  const {passwordHash}=await import('./db.js');
  const change=central.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash(body.password),id);
  central.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  if(!change.changes)throw httpError('Engineer not found',404);return {ok:true};
});
app.get('/api/tasks',async()=>listTasks());
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
  guardAdmin(req);const input=taskSchema.parse(req.body);
  validateTaskDates(input);
  upsertTask(input);return {ok:true};
});
app.post('/api/tasks/bulk',async(req)=>{
 guardAdmin(req);
 const {tasks}=z.object({tasks:z.array(taskSchema).min(1).max(500)}).parse(req.body);
 const seen=new Set<string>();for(const task of tasks){
   if(seen.has(task.id))throw httpError('Repeated Task ID in paste');seen.add(task.id);validateTaskDates(task);
 }
 central.transaction(()=>{for(const task of tasks)upsertTask(task);})();
 return {ok:true,updated:tasks.length};
});
app.get('/api/overview',async(req)=>{
  const {month}=z.object({month:z.string()}).parse(req.query);
  const {start,end}=monthBounds(month);const current=actor(req);
  const users=listUsers().filter(u=>current.is_admin||u.id===current.id);
  const entries=current.is_admin?allEntries(start,end):listEntries(current.id,start,end).map(e=>({...e,user_id:current.id}));
  return {users,tasks:listTasks(),entries,taskActuals:aggregateTaskActuals(users.map(u=>u.id)),start,end,role:current.is_admin?'admin':'member'};
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
  const {user_id,...data}=input;return addEntry(user_id,data);
});
// Spreadsheet-style cell updates; owner/admin authorization and conflict checks on server.
const cellSchema=z.object({user_id:z.string(),date:z.string(),task_id:z.string().default(''),kind:z.enum(ENTRY_KINDS),role:z.enum(ROLES),hours:z.number().finite().min(0).max(24)});
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
 }}
 for(const [userId,group] of groups){userDb(userId).transaction(()=>{for(const cell of group)replaceEffortCell(userId,cell);})();}
 return {ok:true,updated:cells.length};
});
app.delete('/api/entries/:id',async(req)=>{
  const input=z.object({userId:z.string()}).parse(req.query);canReadUser(req,input.userId);
  return {deleted:removeEntry(input.userId,(req.params as {id:string}).id)};
});
// Custom supergraphic is served as a sandboxed image, never as an executable document.
const brandDir=join(DATA_ROOT,'shared','branding');
const supergraphicPath=join(brandDir,'supergraphic.svg');
function validateSupergraphicSvg(text:string):void {
 if(text.length>256*1024 || !/^\s*(?:<\?xml[^>]*>\s*)?<svg\s[\s\S]*<\/svg>\s*$/i.test(text))throw httpError('Provide an SVG image smaller than 256 KB');
 if(/<\s*(?:script|foreignObject|iframe|object|embed|image|use|link|audio|video|animate|set|feImage|style)\b/i.test(text)
  ||/\bon[a-z]+\s*=/i.test(text)||/\b(?:href|xlink:href)\s*=\s*['"](?!#)/i.test(text)
  ||/\b(?:href|xlink:href)\s*=\s*[^'"\s>]/i.test(text)
  ||/\b(?:javascript:|data:|https?:|file:|@import|<!DOCTYPE|<!ENTITY|<\?xml-stylesheet)\b/i.test(text)
  ||/url\(\s*['"]?(?!#)/i.test(text))throw httpError('SVG includes external, active or unsafe content');
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
async function receiveWorkbook(req:FastifyRequest,mode:'tasks'|'effort'){
  if(mode==='tasks')guardAdmin(req);
  const file=await req.file();if(!file)throw httpError('Choose an .xlsx file');
  if(!file.filename.toLowerCase().endsWith('.xlsx'))throw httpError('Only .xlsx workbooks are supported');
  const bytes=await file.toBuffer();
  if(bytes.length<4 || bytes[0]!==0x50||bytes[1]!==0x4b)throw httpError('Invalid XLSX file');
  const preview=await parseWorkbook(bytes,mode,actor(req).id,!!actor(req).is_admin);
  if(mode==='tasks'){
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
  if(mode==='effort'){
    const known=new Set(listTasks().map(t=>t.id));const users=new Set(listUsers().filter(u=>u.active).map(u=>u.id));
    for(const e of preview.entries){
      if(e.kind==='Task'&&!known.has(e.task_id))preview.errors.push(`Unknown Task ID: ${e.task_id}`);
      if(!users.has(e.user_id))preview.errors.push(`Unknown engineer: ${e.user_id}`);
      if(preview.mode==='effort'&&e.note===''){
        if(!users.has(e.user_id))continue;
        const db=userDb(e.user_id);
        const existing=db.prepare('SELECT COUNT(*) n FROM entries WHERE date=? AND task_id=? AND kind=? AND role=? AND note != ?').get(e.date,e.task_id,e.kind,e.role,'') as {n:number};
        if(existing.n)preview.errors.push(`${e.user_id} / ${e.date} / ${e.task_id||e.kind}: existing entries have notes; grid import cannot replace them`);
      }
    }
  }
  return {preview,bytes};
}
app.post('/api/import/preview',async(req)=>{
  const {mode}=z.object({mode:z.enum(['tasks','effort'])}).parse(req.query);
  const {preview}=await receiveWorkbook(req,mode);return preview;
});
app.post('/api/import/commit',async(req)=>{
  const {mode}=z.object({mode:z.enum(['tasks','effort'])}).parse(req.query);
  const {preview,bytes}=await receiveWorkbook(req,mode);
  if(preview.errors.length||!preview.rows)throw httpError(`Import rejected: ${preview.errors.slice(0,4).join('; ') || 'No rows'}`);
  if(mode==='tasks'){
    central.transaction(()=>{for(const task of preview.tasks)upsertTask(task);})();
  } else {
    const group=new Map<string,typeof preview.entries>();
    for(const entry of preview.entries){const list=group.get(entry.user_id)||[];list.push(entry);group.set(entry.user_id,list);}
    // Each user DB commits transactionally; imports spanning multiple engineers cannot be atomic across databases.
    for(const [userId,rows] of group){
      const db=userDb(userId);
      db.transaction(()=>{for(const {user_id,...record} of rows)addEntry(user_id,record);})();
    }
  }
  const folder=mode==='tasks'?join(DATA_ROOT,'shared','imports'):join(DATA_ROOT,'users',actor(req).id,'imports');
  mkdirSync(folder,{recursive:true});writeFileSync(join(folder,`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}.xlsx`),bytes);
  return {ok:true,mode,imported:mode==='tasks'?preview.tasks.length:preview.entries.length};
});
app.setNotFoundHandler((req,reply)=>{
  if(req.url.startsWith('/api/'))return reply.code(404).send({error:'Not found'});
  const index=join(webRoot,'index.html');if(existsSync(index))return reply.type('text/html').sendFile('index.html');
  return reply.code(404).send({error:'Web UI not built. Run npm run build.'});
});
const port=Number(process.env.PORT||4177);
await app.listen({port,host:process.env.HOST||'127.0.0.1'});
