'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, ArrowDown } from 'lucide-react';

export interface Column<T> {
  key: string;
  label: string;
  className?: string;
  headerClassName?: string;
  sortable?: boolean;
  sortValue?: (row: T) => number | string;
  render: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string;
  defaultSort?: { key: string; desc: boolean };
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  defaultSort,
}: DataTableProps<T>) {
  const router = useRouter();
  const [sort, setSort] = useState(defaultSort ?? null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  const sortedRows = (() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const fn = col.sortValue;
    return [...rows].sort((a, b) => {
      const va = fn(a);
      const vb = fn(b);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sort.desc ? -cmp : cmp;
    });
  })();

  const handleSort = useCallback(
    (key: string) => {
      setSort((prev) =>
        prev?.key === key
          ? { key, desc: !prev.desc }
          : { key, desc: true },
      );
    },
    [],
  );

  // Keyboard navigation: j/k/Enter
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!tbodyRef.current) return;
      const tbody = tbodyRef.current;
      if (!tbody.contains(document.activeElement) && document.activeElement !== tbody) return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, sortedRows.length - 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && focusedIndex >= 0 && rowHref) {
        e.preventDefault();
        const row = sortedRows[focusedIndex];
        if (row) router.push(rowHref(row));
      }
    }

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [focusedIndex, sortedRows, rowHref, router]);

  // Focus the row when focusedIndex changes
  useEffect(() => {
    if (focusedIndex >= 0 && tbodyRef.current) {
      const row = tbodyRef.current.children[focusedIndex] as HTMLElement;
      row?.focus();
    }
  }, [focusedIndex]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 font-medium text-muted-foreground sticky top-0 bg-muted/50 ${col.headerClassName ?? 'text-left'} ${col.sortable ? 'cursor-pointer select-none hover:text-foreground' : ''}`}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {col.sortable && sort?.key === col.key && (
                    sort.desc
                      ? <ArrowDown className="size-3" />
                      : <ArrowUp className="size-3" />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={tbodyRef}>
          {sortedRows.map((row, i) => (
            <tr
              key={rowKey(row)}
              tabIndex={rowHref ? 0 : undefined}
              className={`border-b last:border-0 transition-colors h-11 ${rowHref ? 'cursor-pointer hover:bg-muted/30' : 'hover:bg-muted/30'} ${focusedIndex === i ? 'bg-muted/50' : ''}`}
              onClick={rowHref ? () => router.push(rowHref(row)) : undefined}
              onFocus={() => setFocusedIndex(i)}
            >
              {columns.map((col) => (
                <td key={col.key} className={`px-4 py-2.5 ${col.className ?? ''}`}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
