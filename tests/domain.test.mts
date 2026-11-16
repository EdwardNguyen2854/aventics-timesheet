import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { monthBounds, dateRange, safeSlug, validHours, validIsoDate } from '../apps/server/src/domain.ts';
test('leap year month bounds',()=>assert.deepEqual(monthBounds('2028-02'),{start:'2028-02-01',end:'2028-02-29'}));
test('date range and invalid dates',()=>{assert.deepEqual(dateRange('2026-11-29','2026-12-02'),['2026-11-29','2026-11-30','2026-12-01','2026-12-02']);assert.equal(validIsoDate('2026-02-30'),false);});
test('quarter hours only',()=>{assert.equal(validHours(8),true);assert.equal(validHours(1.25),true);assert.equal(validHours(-1),false);assert.equal(validHours(1.1),false);});
test('safe user folder names',()=>{assert.equal(safeSlug('Duy NK'),'duy-nk');assert.throws(()=>safeSlug('../'));});
