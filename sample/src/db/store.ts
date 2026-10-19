const rows: { id: number; item: string }[] = []

export function insertOrder(item: string) {
  const row = { id: rows.length + 1, item }
  rows.push(row)
  return row
}

export function allOrders() {
  return [...rows]
}
