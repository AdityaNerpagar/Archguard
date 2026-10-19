import { placeOrder } from '../orders/orders'
// Deliberate violation: the web app reads the database directly instead of going through Orders.
import { allOrders } from '../db/store'

export function checkoutPage(item: string) {
  placeOrder(item)
  return `You have ${allOrders().length} orders`
}
