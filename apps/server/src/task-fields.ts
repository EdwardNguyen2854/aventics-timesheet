/** Shared catalog column contract. Task ID is immutable; calculated totals are never stored. */
export const EXTRA_TASK_COLUMNS = {
  series: "TEXT NOT NULL DEFAULT ''",
  revision: "TEXT NOT NULL DEFAULT ''",
  engineer: "TEXT NOT NULL DEFAULT ''",
  qc_engineer: "TEXT NOT NULL DEFAULT ''",
  actual_ex_baseline: 'REAL NOT NULL DEFAULT 0',
  actual_qc_baseline: 'REAL NOT NULL DEFAULT 0',
  rework_effort: "TEXT NOT NULL DEFAULT ''",
  planned_start_date: "TEXT NOT NULL DEFAULT ''",
  planned_completion_date: "TEXT NOT NULL DEFAULT ''",
  activity_code: "TEXT NOT NULL DEFAULT ''",
  required_internal: "TEXT NOT NULL DEFAULT ''",
  self_qc_completion_date: "TEXT NOT NULL DEFAULT ''",
  internal_errors: 'REAL NOT NULL DEFAULT 0',
  flexibility: "TEXT NOT NULL DEFAULT ''",
  customer_approval_date: "TEXT NOT NULL DEFAULT ''",
  task_type: "TEXT NOT NULL DEFAULT ''",
  code_add: "TEXT NOT NULL DEFAULT ''",
  code_update: "TEXT NOT NULL DEFAULT ''",
  mu_execution: 'REAL NOT NULL DEFAULT 0',
  mu_qc: 'REAL NOT NULL DEFAULT 0',
} as const;
export const TASK_WRITABLE_COLUMNS = [
  'id','serial_no','ip_no','series','revision','name','email_subject','engineer','qc_engineer',
  'estimated_ex','actual_ex_baseline','estimated_qc','actual_qc_baseline','rework_effort','status',
  'planned_start_date','start_date','planned_completion_date','completion_date','activity_code',
  'required_internal','self_qc_completion_date','internal_errors','flexibility','customer_approval_date',
  'task_type','code_add','code_update','mu_execution','mu_qc'
] as const;
