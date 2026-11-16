import './config.js';
import Database from 'better-sqlite3';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { safeSlug } from './domain.js';

export interface User { id:string; name:string; is_admin:number; active:number; created_at:string }
export interface Task { id:string; serial_no:string; ip_no:string; name:string; status:string; estimated_ex:number; estimated_qc:number; email_subject:string; start_date:string; completion_date:string; updated_at:string }
export interface Entry { id:string; date:string; task_id:string; kind:string; role:string; hours:number; note:string; created_at:string; updated_at:string }
export const DATA_ROOT=resolve(process.env.DATA_ROOT || './data');
const sharedPath=join(DATA_ROOT,'shared');
mkdirSync(sharedPath,{recursive:true});
export const central=new Database(join(sharedPath,'catalog.sqlite'));
central.pragma('journal_mode = WAL');central.pragma('busy_timeout = 5000');central.pragma('foreign_keys = ON');
central.exec(`
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, password_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_session_user ON sessions(user_id);
 CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, serial_no TEXT NOT NULL DEFAULT '',ip_no TEXT NOT NULL DEFAULT '',name TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'Not started',estimated_ex REAL NOT NULL DEFAULT 0,estimated_qc REAL NOT NULL DEFAULT 0,email_subject TEXT NOT NULL DEFAULT '',start_date TEXT NOT NULL DEFAULT '',completion_date TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX IF NOT EXISTS idx_task_ip ON tasks(ip_no);
`);
const opened=new Map<string,Database.Database>();
export function userDb(userId:string):Database.Database {
  const id=safeSlug(userId);if(id!==userId)throw new Error('Invalid user identifier');
  if(!central.prepare('SELECT 1 FROM users WHERE id=?').get(id))throw new Error('Unknown engineer');
  let db=opened.get(id);if(db)return db;
  const folder=join(DATA_ROOT,'users',id);
  mkdirSync(folder,{recursive:true});mkdirSync(join(folder,'imports'),{recursive:true});mkdirSync(join(folder,'exports'),{recursive:true});
  db=new Database(join(folder,'effort.sqlite'));
  db.pragma('journal_mode = WAL');db.pragma('busy_timeout = 5000');
  db.exec(`CREATE TABLE IF NOT EXISTS entries(
    id TEXT PRIMARY KEY,date TEXT NOT NULL,task_id TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL,role TEXT NOT NULL,
    hours REAL NOT NULL CHECK(hours > 0 AND hours <= 24),note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date,task_id,kind,role,note)
  );CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date); CREATE INDEX IF NOT EXISTS idx_entries_task ON entries(task_id);`);
  opened.set(id,db);return db;
}
export function passwordHash(pass:string):string {
  const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(pass,salt,64).toString('hex')}`;
}
export function verifyPassword(pass:string,hashed:string):boolean {
  const [salt,hash]=hashed.split(':');if(!salt||!hash||hash.length!==128)return false;
  const actual=scryptSync(pass,salt,64),expected=Buffer.from(hash,'hex');
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}
export function createUser(input:{id:string;name:string;password:string;is_admin?:boolean}):User {
  const id=safeSlug(input.id);if(id!==input.id||input.password.length<12)throw new Error('Username must be a safe slug and password at least 12 characters');
  central.prepare('INSERT INTO users(id,name,password_hash,is_admin) VALUES(?,?,?,?)').run(id,input.name.trim(),passwordHash(input.password),input.is_admin?1:0);
  userDb(id);return central.prepare('SELECT id,name,is_admin,active,created_at FROM users WHERE id=?').get(id) as User;
}
export function bootstrap():void {
  const c=central.prepare('SELECT COUNT(*) n FROM users').get() as {n:number};
  if(c.n) return;
  const admin=process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin';const password=process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if(!password || password.length<12 || password.startsWith('REPLACE_')) throw new Error('Set BOOTSTRAP_ADMIN_PASSWORD (minimum 12 characters) to initialize first admin');
  createUser({id:safeSlug(admin),name:'Administrator',password,is_admin:true});
}
export function newSession(userId:string):string {
  const token=randomBytes(32).toString('hex');central.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  central.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hashToken(token),userId,Date.now()+8*60*60*1000);
  return token;
}
export function hashToken(token:string):string{return createHash('sha256').update(token).digest('hex');}
export function userForSession(token?:string):User|null {
  if(!token)return null;
  return (central.prepare(`SELECT u.id,u.name,u.is_admin,u.active,u.created_at FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(hashToken(token),Date.now()) as User|undefined)??null;
}
export function listUsers():User[]{return central.prepare('SELECT id,name,is_admin,active,created_at FROM users ORDER BY name').all() as User[];}
export function listTasks():Task[]{return central.prepare('SELECT * FROM tasks ORDER BY CAST(NULLIF(serial_no,\'\') AS INTEGER) DESC,id DESC').all() as Task[];}
export function listEntries(userId:string,start:string,end:string):Entry[]{return userDb(userId).prepare('SELECT * FROM entries WHERE date BETWEEN ? AND ? ORDER BY date DESC,created_at DESC').all(start,end) as Entry[];}
export interface TaskEffortRow {user_id:string;task_id:string;role:'EX'|'QC';hours:number}
export function taskEffortBreakdown():TaskEffortRow[] {
  const results:TaskEffortRow[]=[];
  for(const user of listUsers()) {
    const grouped=userDb(user.id).prepare("SELECT task_id,role,SUM(hours) hours FROM entries WHERE kind='Task' AND role IN ('EX','QC') AND task_id != '' GROUP BY task_id,role").all() as Array<{task_id:string;role:'EX'|'QC';hours:number}>;
    results.push(...grouped.map(e=>({...e,user_id:user.id})));
  }
  return results;
}
export function aggregateTaskActuals(userIds:string[]):Record<string,{ex:number;qc:number}> {
  const result:Record<string,{ex:number;qc:number}>={};
  for(const id of userIds){
    const rows=userDb(id).prepare("SELECT task_id,role,SUM(hours) total FROM entries WHERE kind='Task' AND role IN ('EX','QC') AND task_id != '' GROUP BY task_id,role").all() as Array<{task_id:string;role:string;total:number}>;
    for(const row of rows){
      const key=row.task_id;
      if(!result[key])result[key]={ex:0,qc:0};
      if(row.role==='EX')result[key].ex+=row.total; else if(row.role==='QC')result[key].qc+=row.total;
    }
  }
  return result;
}
export function allEntries(start:string,end:string):Array<Entry&{user_id:string}> {
  return listUsers().flatMap(u=>listEntries(u.id,start,end).map(e=>({...e,user_id:u.id}))); 
}
export function addEntry(userId:string,input:Pick<Entry,'date'|'task_id'|'kind'|'role'|'hours'|'note'>):Entry {
  const db=userDb(userId),id=randomUUID();
  db.prepare(`INSERT INTO entries(id,date,task_id,kind,role,hours,note) VALUES(?,?,?,?,?,?,?)
  ON CONFLICT(date,task_id,kind,role,note) DO UPDATE SET hours=excluded.hours,updated_at=CURRENT_TIMESTAMP`)
  .run(id,input.date,input.task_id,input.kind,input.role,input.hours,input.note);
  return db.prepare('SELECT * FROM entries WHERE date=? AND task_id=? AND kind=? AND role=? AND note=?').get(input.date,input.task_id,input.kind,input.role,input.note) as Entry;
}
export function upsertTask(t:Omit<Task,'updated_at'>):void {
  central.prepare(`INSERT INTO tasks(id,serial_no,ip_no,name,status,estimated_ex,estimated_qc,email_subject,start_date,completion_date)
  VALUES(@id,@serial_no,@ip_no,@name,@status,@estimated_ex,@estimated_qc,@email_subject,@start_date,@completion_date)
  ON CONFLICT(id) DO UPDATE SET serial_no=excluded.serial_no,ip_no=excluded.ip_no,name=excluded.name,status=excluded.status,estimated_ex=excluded.estimated_ex,estimated_qc=excluded.estimated_qc,email_subject=excluded.email_subject,start_date=excluded.start_date,completion_date=excluded.completion_date,updated_at=CURRENT_TIMESTAMP`).run(t);
}
export function removeEntry(userId:string,id:string):boolean {return userDb(userId).prepare('DELETE FROM entries WHERE id=?').run(id).changes>0;}
export function closeDbs(){for(const db of opened.values())db.close();central.close();}
