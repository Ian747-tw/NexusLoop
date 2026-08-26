export type ModelSetupCompletionCopy = Readonly<{
  headline: string
  instructions: string
}>

export function modelSetupCompletionCopy(pendingRestart: boolean): ModelSetupCompletionCopy {
  return pendingRestart
    ? {
        headline: "Selection recorded. Exit and restart NexusLoop to activate it.",
        instructions: "This runtime cannot enter the main shell until restart.",
      }
    : {
        headline: "Selection already active. No restart is required.",
        instructions: "Enter returns to the main shell.",
      }
}
