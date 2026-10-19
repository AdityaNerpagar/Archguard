import { insertOrder, allOrders } from '../db/store'

export function placeOrder(item: string) {
  return insertOrder(item)
}

export function listOrders() {
  return allOrders()
}
