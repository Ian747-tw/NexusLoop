export interface MiniMaxMessageRequest {
  model: string
  max_tokens: number
  temperature?: number
  system?: string
  messages: Array<{
    role: "user"
    content: string
  }>
}

export interface MiniMaxTextBlock {
  type?: string
  text?: string
}

export interface MiniMaxMessageResponse {
  id?: string
  content?: Array<MiniMaxTextBlock | string>
}
