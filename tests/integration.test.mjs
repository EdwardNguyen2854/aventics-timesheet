import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('full workbook template parses and task, estimate and effort persist separately',async()=>{
 const root=mkdtempSync(join(tmpdir(),'aventics-work-desk-'));
 process.env.DATA_ROOT=root;
 const db=await import('../apps/server/dist/db.js');
 const excel=await import('../apps/server/dist/excel.js');
 try{
   const wb=excel.templateWorkbook('2026-01');
   const bytes=Buffer.from(await wb.xlsx.writeBuffer());
   const parsed=await excel.parseWorkbook(bytes,'workbook','admin',true);
   assert.deepEqual(parsed.errors,[],parsed.errors.join('; '));
   assert.equal(parsed.tasks.length,1);
   assert.equal(parsed.entries.length,3);
   assert.equal(parsed.entries.reduce((n,e)=>n+e.hours,0),11);
   const task=parsed.tasks[0];
   assert.equal(task.id,'3614-ip1614');
   db.upsertTask(task);
   const duynk=db.createUser({id:'duynk',name:'DuyNK',password:'local-only-test-passphrase-123'});
   assert.equal(duynk.active,1);
   const entry=db.addEntry('duynk',{date:'2026-01-05',task_id:task.id,kind:'Task',role:'EX',hours:3,note:''});
   assert.equal(entry.hours,3);
   assert.equal(db.aggregateTaskActuals(['duynk'])[task.id].ex,3);
   db.central.prepare("INSERT INTO effort_rates(id,activity,difficulty,activity_code,execution_hours,qc_hours,criteria) VALUES(?,?,?,?,?,?,?)").run('symbol-simple','Symbol','Simple','Symbol-S',2,1,'Synthetic CI fixture');
   const estimate=db.addTaskEstimate({task_id:task.id,rate_id:'symbol-simple',quantity:2,experience:'Intermediate',created_by:'duynk'});
   assert.equal(estimate.ex_hours,3.6);
   assert.equal(estimate.qc_hours,1.8);
   assert.equal(db.aggregateTaskActuals(['duynk'])[task.id].ex,3,'estimate never changes actual');
   assert.equal(db.listEffortRates().length,1);
   assert.equal(db.listTaskEstimates().length,1);
   assert.ok(existsSync(join(root,'users','duynk','effort.sqlite')));
   assert.ok(existsSync(join(root,'shared','catalog.sqlite')));
   const operations=await import('../apps/server/dist/worktrack.js');
   operations.initializeWorktrack();
   const current=db.listTasks().find(t=>t.id===task.id);
   assert.ok(current?.updated_at);
   operations.writeTaskWithAudit({...task,status:'In progress'},'duynk',current.updated_at);
   assert.equal(db.listTasks().find(t=>t.id===task.id).status,'In progress');
   assert.throws(()=>operations.writeTaskWithAudit(task,'duynk','outdated-token'),/modified/);
   operations.auditEntry('duynk','duynk',entry.id,'create',null,entry);
   operations.setAlias('3614-ip1614_series: ug',task.id,'duynk');
   assert.equal(operations.listAliases()[0].task_id,task.id);
   operations.setSavedView('duynk','task-tracking',{density:'compact',hidden:['revision']});
   assert.equal(JSON.parse(operations.savedViews('duynk')[0].config_json).hidden[0],'revision');
   const report=operations.varianceReport('duynk',true).find(r=>r.task_id===task.id);
   assert.equal(report.actual_ex,3);
   assert.equal(report.estimated,task.estimated_ex+task.estimated_qc);
   const backup=await operations.backupAll();
   assert.equal(backup.manifest.files.length,2);
   for(const file of backup.manifest.files)assert.ok(existsSync(join(root,'backups',backup.id,file.path)));
   assert.equal(operations.listBackups().length,1);
   const importId=operations.beginImport('duynk','workbook',Buffer.from('fixture'),1,2,backup.id);
   operations.updateImport(importId,'completed',['duynk']);
   assert.equal(operations.listImports()[0].backup_id,backup.id);
   assert.ok(operations.getAudit('duynk',true).taskEvents.length>=2);

 } finally{
   db.closeDbs();
   rmSync(root,{recursive:true,force:true});
 }
});