import {useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode} from 'react';
import {fmtHours, type Entry} from './api';

export interface WorkGridRow {
  key: string;
  userId: string;
  status: string;
  taskId: string;
  kind: string;
  role: string;
  entries: Entry[];
}
export interface GridCoordinate {row: number; day: number}
export interface GridSelection {start: GridCoordinate; end: GridCoordinate}
interface WorkGridProps {
  days: string[];
  rows: WorkGridRow[];
  userNames: Map<string, string>;
  dailyTotals: Map<string, number>;
  valueAt: (row: WorkGridRow, date: string) => number;
  editable: boolean;
  renderCell: (row: WorkGridRow, date: string) => ReactNode;
  onTaskOpen?: (taskId: string) => void;
  onPasteRange?: (start: GridCoordinate, text: string) => void;
}

const META_WIDTHS = [112, 128, 230, 54, 66];
const META_OFFSETS = [0, 112, 240, 470, 524];
const META_WIDTH = 590;
const DAY_WIDTH = 40;
const ROW_HEIGHT = 33;
const HEADER_HEIGHT = 96;
const heat = (n: number) => n <= 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n <= 6 ? 3 : n <= 8 ? 4 : 5;
const between = (n: number, a: number, b: number) => n >= Math.min(a, b) && n <= Math.max(a, b);
const weekday = (day: string) => new Date(day + 'T00:00:00').toLocaleString('en', {weekday: 'short'});

/** Two-axis virtualization with five frozen identifier columns. No empty cells are persisted. */
export function WorkGrid({days, rows, userNames, dailyTotals, valueAt, editable, renderCell, onTaskOpen, onPasteRange}: WorkGridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const [position, setPosition] = useState({top: 0, left: 0, width: 1280, height: 550});
  const [selection, setSelection] = useState<GridSelection | null>(null);
  useEffect(() => setSelection(null), [days, rows.length]);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const update = () => setPosition(p => ({...p, width: node.clientWidth, height: node.clientHeight}));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const stop = () => {dragging.current = false;};
    window.addEventListener('pointerup', stop);
    return () => window.removeEventListener('pointerup', stop);
  }, []);

  const firstDay = Math.max(0, Math.floor((position.left - META_WIDTH) / DAY_WIDTH) - 8);
  const lastDay = Math.min(days.length, Math.ceil((position.left + position.width - META_WIDTH) / DAY_WIDTH) + 8);
  const firstRow = Math.max(0, Math.floor((position.top - HEADER_HEIGHT) / ROW_HEIGHT) - 14);
  const lastRow = Math.min(rows.length, Math.ceil((position.top + position.height - HEADER_HEIGHT) / ROW_HEIGHT) + 14);
  const visibleDays = useMemo(() => days.slice(firstDay, lastDay).map((date, offset) => ({date, dayIndex: firstDay + offset})), [days, firstDay, lastDay]);
  const visibleRows = useMemo(() => rows.slice(firstRow, lastRow).map((item, offset) => ({item, rowIndex: firstRow + offset})), [rows, firstRow, lastRow]);
  const gridWidth = META_WIDTH + DAY_WIDTH * days.length;
  const gridHeight = HEADER_HEIGHT + ROW_HEIGHT * rows.length;
  const positionOf = (dateIndex: number) => META_WIDTH + dateIndex * DAY_WIDTH;
  const meta = (contents: ReactNode[], className = '') => contents.map((content, i) => (
    <div key={i} className={'wt-meta-col ' + className} style={{width: META_WIDTHS[i], left: META_OFFSETS[i], height: ROW_HEIGHT}}>{content}</div>
  ));
  function focusCell(cell: GridCoordinate) {
    const node = scrollRef.current;
    if (!node) return;
    const x = positionOf(cell.day), y = HEADER_HEIGHT + cell.row * ROW_HEIGHT;
    if (x < node.scrollLeft + META_WIDTH) node.scrollLeft = Math.max(0, x - META_WIDTH);
    else if (x + DAY_WIDTH > node.scrollLeft + node.clientWidth) node.scrollLeft = x + DAY_WIDTH - node.clientWidth;
    if (y < node.scrollTop + HEADER_HEIGHT) node.scrollTop = Math.max(0, y - HEADER_HEIGHT);
    else if (y + ROW_HEIGHT > node.scrollTop + node.clientHeight) node.scrollTop = y + ROW_HEIGHT - node.clientHeight;
  }
  function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || !selection) return;
    const direction: Record<string, [number, number]> = {ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0]};
    if (event.key === 'Tab') direction.Tab = [0, event.shiftKey ? -1 : 1];
    const step = direction[event.key];
    if (step) {
      event.preventDefault();
      const next = {row: Math.max(0, Math.min(rows.length - 1, selection.end.row + step[0])), day: Math.max(0, Math.min(days.length - 1, selection.end.day + step[1]))};
      setSelection({start: event.shiftKey ? selection.start : next, end: next});
      focusCell(next);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && editable && onPasteRange) {
      event.preventDefault();
      const a = selection.start, b = selection.end, height = Math.abs(a.row - b.row) + 1, width = Math.abs(a.day - b.day) + 1;
      if (height * width <= 1000) onPasteRange({row: Math.min(a.row, b.row), day: Math.min(a.day, b.day)}, Array.from({length: height}, () => Array(width).fill('').join('\t')).join('\n'));
    }
  }
  function onCopy(event: ClipboardEvent<HTMLDivElement>) {
    if (!selection) return;
    const a = selection.start, b = selection.end;
    const lines: string[] = [];
    for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
      const values: string[] = [];
      for (let d = Math.min(a.day, b.day); d <= Math.max(a.day, b.day); d++) {
        const row = rows[r], date = days[d];
        values.push(row && date ? (valueAt(row, date) || '').toString() : '');
      }
      lines.push(values.join('\t'));
    }
    event.preventDefault();
    event.clipboardData.setData('text/plain', lines.join('\n'));
  }
  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    if (!editable || !selection || !onPasteRange) return;
    const text = event.clipboardData.getData('text/plain');
    if (text) {event.preventDefault(); onPasteRange({row: Math.min(selection.start.row, selection.end.row), day: Math.min(selection.start.day, selection.end.day)}, text);}
  }
  return <div className="wt-grid-scroll" ref={scrollRef} role="grid" tabIndex={0}
    aria-label="Virtualized effort sheet. Select cells with the mouse, arrow keys to move, Ctrl+C and Ctrl+V to copy and paste"
    onScroll={event => {const node = event.currentTarget; setPosition({top: node.scrollTop, left: node.scrollLeft, width: node.clientWidth, height: node.clientHeight});}}
    onKeyDown={onGridKeyDown} onCopy={onCopy} onPaste={onPaste}>
    <div className="wt-grid-space" style={{width: gridWidth, height: gridHeight}}>
      <div className="wt-grid-sticky" style={{width: gridWidth}}>
        <div className="wt-grid-header-row">
          {meta(['Engineer', 'Status', 'Task ID', 'Role', 'Total'], 'wt-meta-header')}
          {visibleDays.map(({date, dayIndex}) => <div key={date} className={'wt-day-header ' + ((dailyTotals.get(date) || 0) > 0 ? 'has-hours' : '')}
            style={{left: positionOf(dayIndex), width: DAY_WIDTH}}><span>{weekday(date)}</span><strong>{date.slice(-2)}</strong>{date.endsWith('-01') && <small>{new Date(date + 'T00:00:00').toLocaleString('en', {month: 'short'})}</small>}</div>)}
        </div>
        <div className="wt-grid-total-row">
          {meta(['TOTAL', '', '', '', fmtHours(rows.reduce((sum, row) => sum + row.entries.reduce((n, e) => n + e.hours, 0), 0))], 'wt-meta-total')}
          {visibleDays.map(({date, dayIndex}) => {const hours = dailyTotals.get(date) || 0; return <div key={date} className={'wt-grid-data-cell wt-total-cell ' + (hours > 0 ? 'heat-' + heat(hours) : '')}
            style={{left: positionOf(dayIndex), width: DAY_WIDTH}}>{hours ? fmtHours(hours) : '·'}</div>;})}
        </div>
      </div>
      {visibleRows.map(({item, rowIndex}) => <div role="row" key={item.key} className="wt-grid-body-row" style={{top: HEADER_HEIGHT + rowIndex * ROW_HEIGHT, width: gridWidth, height: ROW_HEIGHT}}>
        {meta([<strong>{userNames.get(item.userId) || item.userId}</strong>, <span title={item.status}>{item.status}</span>, item.taskId ? <button className="wt-task-link" title="Open Task Workspace" onClick={() => onTaskOpen?.(item.taskId)}>{item.taskId}</button> : item.kind, item.role, <strong>{fmtHours(item.entries.reduce((n, e) => n + e.hours, 0))}</strong>], 'wt-meta-body')}
        {visibleDays.map(({date, dayIndex}) => {const hours = valueAt(item, date); const selected = selection && between(rowIndex, selection.start.row, selection.end.row) && between(dayIndex, selection.start.day, selection.end.day);
          return <div key={date} className={'wt-grid-data-cell ' + (hours > 0 ? 'heat-' + heat(hours) : '') + (selected ? ' is-selected' : '')}
            style={{left: positionOf(dayIndex), width: DAY_WIDTH}} role="gridcell" aria-rowindex={rowIndex + 1} aria-colindex={dayIndex + 6}
            onPointerDown={event => {if (event.button !== 0) return; dragging.current = true; setSelection({start: {row: rowIndex, day: dayIndex}, end: {row: rowIndex, day: dayIndex}});}}
            onPointerEnter={() => {if (dragging.current) setSelection(s => s ? {...s, end: {row: rowIndex, day: dayIndex}} : s);}}>{renderCell(item, date)}</div>;
        })}
      </div>)}
    </div>
  </div>;
}