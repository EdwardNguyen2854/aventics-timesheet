import {test, expect} from '@playwright/test';

const taskId = '4901-ip1800';
const requestHeaders = {'X-Requested-With': 'aventics-worktrack'};

test('WorkTrack navigation, canonical task, effort, and performance', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', {name: 'Sign in'})).toBeVisible();
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('WorkTrack-E2E-Test-Only!234');
  await page.getByRole('button', {name: 'Sign in'}).click();
  await expect(page.getByRole('heading', {name: 'Overview'})).toBeVisible();

  const taskResponse = await page.request.post('/api/tasks', {headers: requestHeaders, data: {id: taskId, ip_no: 'ip1800', serial_no: '4901', name: 'Synthetic UI verification task', status: 'In progress', estimated_ex: 8, estimated_qc: 2}});
  expect(taskResponse.ok()).toBeTruthy();
  const effortResponse = await page.request.post('/api/entries', {headers: requestHeaders, data: {user_id: 'admin', date: '2026-01-05', task_id: taskId, kind: 'Task', role: 'EX', hours: 5, note: ''}});
  expect(effortResponse.ok()).toBeTruthy();

  const readResponse = await page.request.get('/api/tasks');
  const tasks = await readResponse.json();
  const task = tasks.find((t: {id: string}) => t.id === taskId);
  expect(task?.id).toBe(taskId);
  const rejected = await page.request.post('/api/tasks', {headers: requestHeaders, data: {id: taskId, ip_no: 'ip1800', expected_updated_at: 'stale-version'}});
  expect(rejected.status()).toBe(409);

  await page.reload();
  await page.getByRole('button', {name: 'Timesheet'}).click();
  await page.getByLabel('Timesheet year').selectOption('2026');
  await expect(page.getByLabel('Timesheet period')).toHaveValue('all');
  const grid = page.getByRole('grid');
  await expect(grid).toBeVisible();
  await expect(grid.locator('.wt-grid-data-cell.heat-3').first()).toBeVisible();
  await expect(grid.locator('.wt-task-link', {hasText: taskId}).first()).toBeVisible();

  await grid.locator('.wt-task-link', {hasText: taskId}).first().click();
  const dialog = page.getByRole('dialog', {name: `Task details ${taskId}`});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', {name: 'Effort'}).click();
  await expect(dialog.getByText('ACTUAL EX')).toBeVisible();
  await dialog.getByRole('button', {name: 'Close task details'}).click();

  await page.getByRole('button', {name: 'Performance Analytics'}).click();
  await expect(page.getByRole('heading', {name: 'Estimated vs actual effort'})).toBeVisible();
  await expect(page.getByText(taskId).first()).toBeVisible();

  await page.getByRole('button', {name: 'Task Tracking'}).click();
  await expect(page.getByRole('button', {name: 'Save my view'})).toBeVisible();
  await page.getByRole('button', {name: 'Save my view'}).click();
  await expect(page.getByText('Task Tracking view saved to your account')).toBeVisible();
});