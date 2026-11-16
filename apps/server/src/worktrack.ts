import Database from 'better-sqlite3';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join,relative,resolve,sep} from 'node:path';
import {central,DATA_ROOT,listTasks,listUsers,userDb,type Task,type Entry,taskEffortBreakdown,upsertTask} from './db.js';

export function initializeWorktrack():void{
 central.exec(`
 CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS task_aliases(alias TEXT PRIMARY KEY COLLATE NOCASE,task_id TEXT NOT NULL REFERENCES tasks(id),created_by TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX IF NOT EXISTS idx_task_aliases_task ON task_aliases(task_id);
 CREATE TABLE IF NOT EXISTS saved_views(user_id TEXT NOT NULL REFERENCES users(id),view_id TEXT NOT NULL,config_json TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,view_id));
 CREATE TABLE IF NOT EXISTS task_audit_events(id TEXT PRIMARY KEY,actor TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL,old_json TEXT,new_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX IF NOT EXISTS idx_task_audit_entity ON task_audit_events(entity_type,entity_id,created_at);
 CREATE TABLE IF NOT EXISTS import_jobs(id TEXT PRIMARY KEY,actor TEXT NOT NULL,mode TEXT NOT NULL,source_sha256 TEXT NOT NULL,status TEXT NOT NULL,task_count INTEGER NOT NULL DEFAULT 0,entry_count INTEGER NOT NULL DEFAULT 0,processed_users_json TEXT NOT NULL DEFAULT '[]',error_text TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,completed_at TEXT);
 CREATE INDEX IF NOT EXISTS idx_import_jobs_created ON import_jobs(created_at);
 `);
 const jobColumns=new Set((central.pragma('table_info(import_jobs)') as Array<{name:string}>).map(c=>c.name));
 if(!jobColumns.has('backup_id'))central.exec("ALTER TABLE import_jobs ADD COLUMN backup_id TEXT NOT NULL DEFAULT ''");
 central.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES(4)').run();
 for(const user of listUsers())migrateEngineer(user.id);
}
export function migrateEngineer(userId:string):void{
 const db=userDb(userId);
 db.exec(`
 CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS entry_audit_events(id TEXT PRIMARY KEY,actor TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL,old_json TEXT,new_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX IF NOT EXISTS idx_entry_audit_entity ON entry_audit_events(entity_id,created_at);
 `);
 db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES(4)').run();
}
export function auditTask(actor:string,type:string,entityId:string,action:string,before:unknown,after:unknown):void{
 central.prepare('INSERT INTO task_audit_events(id,actor,entity_type,entity_id,action,old_json,new_json) VALUES(?,?,?,?,?,?,?)')
 .run(randomUUID(),actor,type,entityId,action,before===undefined?null:JSON.stringify(before),after===undefined?null:JSON.stringify(after));
}
export function auditEntry(userId:string,actor:string,entryId:string,action:string,before:unknown,after:unknown):void{
 migrateEngineer(userId);
 userDb(userId).prepare('INSERT INTO entry_audit_events(id,actor,entity_id,action,old_json,new_json) VALUES(?,?,?,?,?,?)')
 .run(randomUUID(),actor,entryId,action,before===undefined?null:JSON.stringify(before),after===undefined?null:JSON.stringify(after));
}
export function writeTaskWithAudit(input:Omit<Task,'updated_at'>,actor:string,expected?:string):void{
 central.transaction(()=>{
  const previous=central.prepare('SELECT * FROM tasks WHERE id=?').get(input.id) as Task|undefined;
  if(expected!==undefined && (previous?.updated_at||'')!==expected)
   throw Object.assign(new Error('This task was modified. Reload before saving.'),{statusCode:409});
  upsertTask(input);
  central.prepare('UPDATE tasks SET updated_at=? WHERE id=?').run(new Date().toISOString(),input.id);
  const next=central.prepare('SELECT * FROM tasks WHERE id=?').get(input.id);
  auditTask(actor,'task',input.id,previous?'update':'create',previous,next);
 })();
}
export function getAudit(userId:string,isAdmin:boolean,taskId?:string,limit=100){
 const taskEvents=isAdmin?central.prepare('SELECT * FROM task_audit_events WHERE (? = ? OR entity_id=?) ORDER BY created_at DESC LIMIT ?').all(taskId||'','',taskId||'',limit):[];
 const entryEvents:unknown[]=[];
 for(const user of isAdmin?listUsers().map(u=>u.id):[userId]){
  migrateEngineer(user);
  const rows=userDb(user).prepare('SELECT *,? AS user_id FROM entry_audit_events ORDER BY created_at DESC LIMIT ?').all(user,limit);
  entryEvents.push(...rows);
 }
 return {taskEvents,entryEvents:entryEvents.slice(0,limit)};
}
export function taskDetail(taskId:string,viewer:string,isAdmin:boolean){
 const task=central.prepare('SELECT * FROM tasks WHERE id=?').get(taskId) as Task|undefined;
 if(!task)return null;
 const actuals=taskEffortBreakdown().filter(r=>r.task_id===taskId);
 const entries:Array<Entry&{user_id:string}>=[];
 for(const user of (isAdmin?listUsers().map(u=>u.id):[viewer])){
  const rows=userDb(user).prepare('SELECT * FROM entries WHERE task_id=? ORDER BY date DESC LIMIT 2000').all(taskId) as Entry[];
  entries.push(...rows.map(e=>({...e,user_id:user})));
 }
 const estimates=central.prepare('SELECT e.*,r.activity,r.difficulty,r.activity_code FROM task_estimates e JOIN effort_rates r ON r.id=e.rate_id WHERE e.task_id=? ORDER BY e.created_at DESC').all(taskId);
 const history=isAdmin?central.prepare("SELECT * FROM task_audit_events WHERE entity_type='task' AND entity_id=? ORDER BY created_at DESC LIMIT 100").all(taskId):[];
 return {task,actuals,entries,estimates,history};
}
export function varianceReport(userId:string,isAdmin:boolean){
 const effort=taskEffortBreakdown();
 const grouped=new Map<string,{ex:number;qc:number}>();
 for(const row of effort){
  if(!isAdmin&&row.user_id!==userId)continue;
  const value=grouped.get(row.task_id)||{ex:0,qc:0};
  value[row.role==='EX'?'ex':'qc']+=row.hours;grouped.set(row.task_id,value);
 }
 return listTasks().map(task=>{
  const log=grouped.get(task.id)||{ex:0,qc:0};
  const estimated=task.estimated_ex+task.estimated_qc;
  const actualEX=(isAdmin?task.actual_ex_baseline:0)+log.ex;
  const actualQC=(isAdmin?task.actual_qc_baseline:0)+log.qc;
  const actual=actualEX+actualQC;
  return {task_id:task.id,project_id:task.ip_no,name:task.name,engineer:task.engineer,qc_engineer:task.qc_engineer,status:task.status,estimated_ex:task.estimated_ex,estimated_qc:task.estimated_qc,actual_ex:actualEX,actual_qc:actualQC,estimated,actual,variance:actual-estimated,variance_pct:estimated>0?(actual-estimated)/estimated*100:null,remaining:Math.max(estimated-actual,0)};
 });
}
export function listAliases(){return central.prepare('SELECT * FROM task_aliases ORDER BY alias').all() as Array<{alias:string;task_id:string}>;}
export function setAlias(alias:string,taskId:string,actor:string){
 const key=alias.trim();if(!key||key.length>200||key.toLowerCase()===taskId.toLowerCase())throw new Error('Provide a distinct legacy alias');
 if(!central.prepare('SELECT 1 FROM tasks WHERE id=?').get(taskId))throw new Error('Unknown canonical task');
 const before=central.prepare('SELECT * FROM task_aliases WHERE alias=?').get(key);
 central.transaction(()=>{
  central.prepare('INSERT INTO task_aliases(alias,task_id,created_by) VALUES(?,?,?) ON CONFLICT(alias) DO UPDATE SET task_id=excluded.task_id,created_by=excluded.created_by').run(key,taskId,actor);
  auditTask(actor,'alias',key,'upsert',before,{alias:key,task_id:taskId});
 })();
}
export function savedViews(userId:string){return central.prepare('SELECT view_id,config_json,updated_at FROM saved_views WHERE user_id=? ORDER BY view_id').all(userId) as Array<{view_id:string;config_json:string;updated_at:string}>;}
export function setSavedView(userId:string,id:string,config:unknown){
 const data=JSON.stringify(config);
 if(data.length>20000)throw new Error('View configuration too large');
 central.prepare('INSERT INTO saved_views(user_id,view_id,config_json) VALUES(?,?,?) ON CONFLICT(user_id,view_id) DO UPDATE SET config_json=excluded.config_json,updated_at=CURRENT_TIMESTAMP').run(userId,id,data);
}
export function beginImport(actor:string,mode:string,source:Buffer,taskCount:number,entryCount:number,backupId=''):string{
 const id=randomUUID(),hash=createHash('sha256').update(source).digest('hex');
 central.prepare('INSERT INTO import_jobs(id,actor,mode,source_sha256,status,task_count,entry_count,backup_id) VALUES(?,?,?,?,?,?,?,?)').run(id,actor,mode,hash,'in_progress',taskCount,entryCount,backupId);
 return id;
}
export function updateImport(id:string,status:'completed'|'partial'|'failed',users:string[],error=''){
 central.prepare('UPDATE import_jobs SET status=?,processed_users_json=?,error_text=?,completed_at=CURRENT_TIMESTAMP WHERE id=?').run(status,JSON.stringify(users),error.slice(0,2000),id);
}
export function listImports(){return central.prepare('SELECT * FROM import_jobs ORDER BY created_at DESC LIMIT 100').all();}
export interface BackupManifest{created_at:string;files:Array<{path:string;bytes:number;sha256:string}>}
export async function backupAll():Promise<{id:string;manifest:BackupManifest}>{
 const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
 const root=join(DATA_ROOT,'backups',id);mkdirSync(root,{recursive:true});
 const all=[{path:'shared/catalog.sqlite',db:central},...listUsers().map(u=>({path:'users/'+u.id+'/effort.sqlite',db:userDb(u.id)}))];
 const manifest:BackupManifest={created_at:new Date().toISOString(),files:[]};
 for(const {path,db} of all){
  const out=join(root,path);mkdirSync(resolve(out,'..'),{recursive:true});
  await db.backup(out);
  const bytes=readFileSync(out);
  const check=new Database(out,{readonly:true,fileMustExist:true});
  try{const integrity=check.pragma('integrity_check',{simple:true});if(integrity!=='ok')throw new Error('Backup failed integrity check: '+path);}
  finally{check.close();}
  manifest.files.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
 writeFileSync(join(root,'manifest.json'),JSON.stringify(manifest,null,2));
 return {id,manifest};
}
export function listBackups(){
 const dir=join(DATA_ROOT,'backups');
 if(!existsSync(dir))return [];
 return readdirSync(dir,{withFileTypes:true}).filter(f=>f.isDirectory()&&/^[\w-]+$/.test(f.name)).map(f=>{
  try{return {id:f.name,manifest:JSON.parse(readFileSync(join(dir,f.name,'manifest.json'),'utf8')) as BackupManifest};}catch{return {id:f.name,error:'Incomplete backup'};}
 });
}