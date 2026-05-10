import type { RuntimeMode } from "../events/event-types"

export function modeRequiresApprovedSpec(mode: RuntimeMode): boolean {
  return mode === "active"
}

export function modeAllowsMissingSpec(mode: RuntimeMode): boolean {
  return mode === "status" || mode === "view-records"
}
