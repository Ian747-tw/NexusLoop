import type { RuntimeEvent, RuntimeResearchProjectionHealth, RuntimeStatus } from "../events/event-types"
import type { ListResearchEventsOptions, Note, ResearchEvent, SearchOptions, Topic, TopicSnapshot } from "../research-db/research-db"

export interface RuntimeClient {
  command(name: "runtime.status"): Promise<RuntimeStatus>
  command(name: "runtime.resume" | "runtime.start_new_session" | "runtime.view_records" | "runtime.shutdown"): Promise<unknown>
  command(name: "research.list_topics", payload?: { query?: string }): Promise<Topic[]>
  command(name: "research.get_topic_snapshot", payload: { topicId: string }): Promise<TopicSnapshot | null>
  command(name: "research.list_events", payload?: { options?: ListResearchEventsOptions }): Promise<ResearchEvent[]>
  command(name: "research.search_notes", payload: { topicId: string; query: string; options?: SearchOptions }): Promise<Note[]>
  command(name: "research.projection_status"): Promise<RuntimeResearchProjectionHealth>
  command(name: "research.rebuild_projection", payload?: { force?: boolean }): Promise<RuntimeResearchProjectionHealth>
  submitUserMessage(message: string): Promise<unknown>
  stream(): AsyncIterable<RuntimeEvent>
}

export interface RuntimeCommandEnvelope {
  command:
    | "runtime.status"
    | "runtime.resume"
    | "runtime.start_new_session"
    | "runtime.view_records"
    | "research.list_topics"
    | "research.get_topic_snapshot"
    | "research.list_events"
    | "research.search_notes"
    | "research.projection_status"
    | "research.rebuild_projection"
    | "runtime.submit_user_message"
    | "runtime.shutdown"
  payload?: Record<string, unknown>
}
