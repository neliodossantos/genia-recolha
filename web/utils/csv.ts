type Cell = string | number | null

function escapeCell(value: Cell | undefined): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: Record<string, Cell>[], columns: string[]): string {
  const lines = rows.map((row) => columns.map((column) => escapeCell(row[column])).join(','))
  return [columns.join(','), ...lines].join('\n')
}
