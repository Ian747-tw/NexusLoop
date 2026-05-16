import { describe, expect, test } from "bun:test"
import { RuntimeEffectOrder } from "../src/runtime-effect-order"

describe("runtime effect ordering", () => {
  test("only the latest async runtime effect sequence is current", () => {
    const order = new RuntimeEffectOrder()

    const first = order.begin()
    const second = order.begin()

    expect(order.isCurrent(first)).toBe(false)
    expect(order.isCurrent(second)).toBe(true)
  })
})
