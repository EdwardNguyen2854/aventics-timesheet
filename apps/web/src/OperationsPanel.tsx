import {useEffect, useState} from 'react';
import {Database, ShieldCheck, History, RefreshCw, Plus} from 'lucide-react';
import {api, type Task} from './api';

type Backup = {id: string; manifest?: {created_at: string; files: Array<{path: string; bytes: number; sha256: string}>}; error?: string};
type ImportJob = {id: string; actor: string; mode: string; status: string; task_count: number; entry_count: number; processed_users_json: string; error_text: string; created_at: string};
type Audit = {id: string; actor: string; entity_type?: string; entity_id: string; action: string; created_at: string};
interface AuditResult {taskEvents: Audit[]; entryEvents: Audit[]}
interface Alias {alias: string; task_id: string}

/** Administrator tooling; backups are created using the SQLite online backup API. */
export function OperationsPanel({tasks, flash}: {tasks: Task[]; flash: (message: string) => void}) {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [imports, setImports] = useState<ImportJob[]>([]);
  const [history, setHistory] = useState<AuditResult>({taskEvents: [], entryEvents: []});
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [alias, setAlias] = useState(''), [taskId, setTaskId] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function reload() {
    try {
      const [b, i, h, a] = await Promise.all([
        api<Backup[]>('/admin/backups'), api<ImportJob[]>('/admin/imports'), api<AuditResult>('/audit'), api<Alias[]>('/task-aliases')
      ]);
      setBackups(b); setImports(i); setHistory(h); setAliases(a); setError('');
    } catch (e) {setError((e as Error).message);}
  }
  useEffect(() => {void reload();}, []);
  async function backup() {
    if (!window.confirm('Create a coordinated SQLite backup of the shared catalog and all engineer databases?')) return;
    setBusy(true);
    try {
      const result = await api<{id: string}>('/admin/backups', {method: 'POST'});
      flash('Backup ' + result.id + ' created and verified'); await reload();
    } catch (e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  async function addAlias() {
    if (!alias.trim() || !taskId) return;
    setBusy(true);
    try {
      await api('/task-aliases', {method: 'POST', body: JSON.stringify({alias, task_id: taskId})});
      flash('Approved task alias saved'); setAlias(''); await reload();
    } catch (e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  return <section className="wt-operations" aria-label="Data operations and history">
    {error && <div className="error-msg" role="alert">{error}</div>}
    <section className="panel">
      <div className="panel-header"><h2><Database size={16}/> Database backups</h2><button className="btn small" disabled={busy} onClick={() => void backup()}><ShieldCheck size={14}/>Create and verify backup</button></div>
      <div className="panel-body"><p className="muted">Each backup includes the shared catalog and all engineer SQLite files. Restore is a controlled offline operation, not a destructive web button.</p>
        <div className="table-scroll"><table><thead><tr><th>Backup ID</th><th>Created</th><th>Databases</th><th>Status</th></tr></thead><tbody>
          {backups.slice(-20).reverse().map(item => <tr key={item.id}><td className="mono">{item.id}</td><td>{item.manifest?.created_at || '—'}</td><td>{item.manifest?.files.length ?? '—'}</td><td>{item.error || 'Integrity verified'}</td></tr>)}
          {!backups.length && <tr><td colSpan={4} className="empty">No backups recorded.</td></tr>}
        </tbody></table></div>
      </div>
    </section>
    <section className="panel"><div className="panel-header"><h2><History size={16}/> Import journal</h2><button className="btn small" onClick={() => void reload()}><RefreshCw size={14}/>Refresh</button></div>
      <div className="table-scroll"><table><thead><tr><th>Job</th><th>Submitted by</th><th>Mode</th><th>Tasks</th><th>Entries</th><th>Status</th><th>Timestamp</th></tr></thead><tbody>
        {imports.map(item => <tr key={item.id} title={item.error_text}><td className="mono">{item.id.slice(0,8)}</td><td>{item.actor}</td><td>{item.mode}</td><td className="num">{item.task_count}</td><td className="num">{item.entry_count}</td><td>{item.status}</td><td>{item.created_at}</td></tr>)}
        {!imports.length && <tr><td colSpan={7} className="empty">No import jobs.</td></tr>}
      </tbody></table></div>
    </section>
    <section className="panel"><div className="panel-header"><h2>Approved legacy Task ID aliases</h2><span className="subtle">Exact, audited mappings</span></div>
      <div className="panel-body"><div className="wt-alias-form"><label>Legacy identifier<input className="input" value={alias} maxLength={200} onChange={e => setAlias(e.target.value)} placeholder="3792-ip1614_series: nl4"/></label>
        <label>Canonical Task ID<select className="input" value={taskId} onChange={e => setTaskId(e.target.value)}><option value="">Choose task</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.id}</option>)}</select></label>
        <button className="btn primary" disabled={busy || !alias.trim() || !taskId} onClick={() => void addAlias()}><Plus size={14}/>Approve alias</button></div>
        <div className="table-scroll"><table><thead><tr><th>Legacy Task ID</th><th>Canonical Task ID</th></tr></thead><tbody>{aliases.map(item => <tr key={item.alias}><td>{item.alias}</td><td>{item.task_id}</td></tr>)}
          {!aliases.length && <tr><td colSpan={2} className="empty">No approved aliases yet.</td></tr>}
        </tbody></table></div>
      </div>
    </section>
    <section className="panel"><div className="panel-header"><h2><History size={16}/> Recent audited changes</h2><span className="subtle">Shared tasks and engineer logs</span></div>
      <div className="table-scroll"><table><thead><tr><th>When</th><th>Actor</th><th>Entity</th><th>Action</th></tr></thead><tbody>
        {[...history.taskEvents, ...history.entryEvents].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0,100).map(a => <tr key={a.id}><td>{a.created_at}</td><td>{a.actor}</td><td>{a.entity_id}</td><td>{a.action}</td></tr>)}
        {!history.taskEvents.length && !history.entryEvents.length && <tr><td colSpan={4} className="empty">No audited edits yet.</td></tr>}
      </tbody></table></div>
    </section>
  </section>;
}