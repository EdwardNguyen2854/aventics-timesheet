import test from 'node:test';
import assert from 'node:assert/strict';
import {EXTRA_TASK_COLUMNS,TASK_WRITABLE_COLUMNS} from '../apps/server/src/task-fields.ts';
import {monthBounds,dateRange} from '../apps/server/src/domain.ts';

test('task tracking has all persisted columns, with stable ID and no duplicate field names',()=>{
 assert.equal(TASK_WRITABLE_COLUMNS[0],'id');
 assert.equal(new Set(TASK_WRITABLE_COLUMNS).size,TASK_WRITABLE_COLUMNS.length);
 assert.equal(TASK_WRITABLE_COLUMNS.length,30); // 32 visible cols less 2 calculated totals
 assert.equal(Object.keys(EXTRA_TASK_COLUMNS).length,20);
 for(const extra of Object.keys(EXTRA_TASK_COLUMNS))assert.ok(TASK_WRITABLE_COLUMNS.includes(extra as any));
});

test('month-specific dated headers have full year and leap-year behavior',()=>{
 const {start,end}=monthBounds('2026-01');
 const days=dateRange(start,end);
 assert.equal(days.length,31);
 assert.equal(`${days[4]!.slice(8,10)}.${days[4]!.slice(5,7)}.${days[4]!.slice(0,4)}`,'05.01.2026');
 assert.equal(dateRange(...Object.values(monthBounds('2028-02')) as [string,string]).length,29);
});
