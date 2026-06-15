import type { RuntimeCheckpointService } from "../checkpoints/runtime-checkpoint-service"
import type { RuntimeCheckpoint, RuntimeCheckpointInput, RuntimeCheckpointPreview, RuntimeCheckpointScope } from "../checkpoints/runtime-checkpoint-types"

export interface WakeSchedulerNavigationCheckpointWriteExecutionInput {
  scope: RuntimeCheckpointScope
  reason?: string
  requested_by: string
}

export class WakeSchedulerNavigationCheckpointWriteExecutor {
  constructor(private readonly checkpointService: RuntimeCheckpointService) {}

  preview(input: WakeSchedulerNavigationCheckpointWriteExecutionInput): Promise<RuntimeCheckpointPreview> {
    return this.checkpointService.preview(checkpointInput(input))
  }

  execute(input: WakeSchedulerNavigationCheckpointWriteExecutionInput): Promise<RuntimeCheckpoint> {
    return this.checkpointService.create(checkpointInput(input))
  }
}

function checkpointInput(input: WakeSchedulerNavigationCheckpointWriteExecutionInput): RuntimeCheckpointInput {
  return {
    scope: input.scope,
    reason: input.reason,
    requested_by: input.requested_by,
    created_by: input.requested_by,
  }
}
