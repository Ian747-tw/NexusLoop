import type { CommanderGithubReadToolId } from "./commander-github-read-types"
import type { CommanderToolJsonSchema, CommanderToolJsonSchemaProperty } from "./commander-tool-types"

// Output schemas are authority contracts, not provider prompt material. Keep them
// structural so deferred GitHub tools remain within the existing schema budget.
const string = (_description: string, maxLength = 500, values?: string[]): CommanderToolJsonSchemaProperty => ({ type: "string", maxLength, ...values ? { enum: values } : {} })
const integer = (_description: string, maximum = 1_000_000_000): CommanderToolJsonSchemaProperty => ({ type: "integer", minimum: 0, maximum })
const boolean = (_description: string): CommanderToolJsonSchemaProperty => ({ type: "boolean" })
const array = (_description: string, items: CommanderToolJsonSchemaProperty): CommanderToolJsonSchemaProperty => ({ type: "array", items })
const object = (_description: string, properties: Record<string, CommanderToolJsonSchemaProperty>, required: string[] = []): CommanderToolJsonSchemaProperty => ({ type: "object", properties, required, additionalProperties: false })

const sourceRef = object("Pointer-only evidence source", {
  source_kind: string("Source kind", 80), source_id: string("Source identity", 240), label: string("Optional label", 240), status: string("Optional status", 80), summary_preview: string("Bounded summary", 500), pointer_only: boolean("Always true"),
}, ["source_kind", "source_id", "pointer_only"])

const evidenceCard = object("Bounded untrusted GitHub evidence card", {
  evidence_id: string("Evidence ID", 160), tool_id: string("Tool ID", 120), source_kind: string("Source kind", 80), source_id: string("Source identity", 320), title: string("Evidence title", 240), summary_preview: string("Bounded summary", 500), trust_class: string("Evidence trust class", 80, ["github_content_untrusted"]), instruction_semantics: string("Instruction semantics", 32, ["none"]), content_hash: string("Content hash", 128), commit_sha: string("Exact commit SHA", 40), source_refs: array("Pointer-only sources", sourceRef), content_included: boolean("Whether bounded content is included"), content_truncated: boolean("Whether content is truncated"), observed_at: string("Observation timestamp", 64), warnings: array("Bounded warnings", string("Warning", 500)), evidence_hash: string("Evidence hash", 128),
}, ["evidence_id", "tool_id", "source_kind", "source_id", "title", "summary_preview", "trust_class", "instruction_semantics", "source_refs", "content_included", "content_truncated", "observed_at", "warnings", "evidence_hash"])

const provenance = object("Repository-bound untrusted evidence provenance", {
  repository: string("Canonical repository", 201), operation: string("GitHub operation", 120), requested_ref: string("Exact requested reference", 240), observed_commit_sha: string("Observed exact commit SHA", 40), source_class: string("Source trust class", 80, ["github_content_untrusted"]), retrieved_at: string("Retrieval timestamp", 64), truncated: boolean("Whether evidence is truncated"), evidence_hash: string("Evidence hash", 128), web_url: string("Derived safe GitHub web URL", 500),
}, ["repository", "operation", "source_class", "retrieved_at", "truncated", "evidence_hash"])

const file = object("Bounded changed-file summary", {
  filename: string("Repository-relative filename", 240), status: string("Change status", 64), additions: integer("Added lines"), deletions: integer("Deleted lines"), changes: integer("Changed lines"), sha: string("File blob SHA", 40),
})
const checkSuite = object("Bounded check-suite identity", {
  id: integer("Check-suite ID", Number.MAX_SAFE_INTEGER), head_sha: string("Exact head SHA", 40), status: string("Check-suite status", 64), conclusion: string("Check-suite conclusion", 64),
})
const check = object("Bounded check-run summary", {
  name: string("Check name", 240), status: string("Check status", 64), conclusion: string("Check conclusion", 64), started_at: string("Start timestamp", 64), completed_at: string("Completion timestamp", 64), check_suite: checkSuite,
})
const review = object("Bounded pull-request review summary", {
  id: integer("Review ID", Number.MAX_SAFE_INTEGER), state: string("Review state", 64), user_login: string("Reviewer login", 120), submitted_at: string("Submission timestamp", 64), body_preview: string("Bounded review body", 240), commit_id: string("Reviewed commit SHA", 40),
})
const reviewThread = object("Bounded thread-aware review summary", {
  thread_id: string("Review-thread ID", 160), resolved: boolean("Whether thread is resolved"), outdated: boolean("Whether thread is outdated"), author_login: string("Comment author login", 120), body_preview: string("Bounded comment body", 240), created_at: string("Comment timestamp", 64),
}, ["thread_id", "resolved", "outdated"])
const threadState = object("Thread-aware review completeness", {
  observed_commit_sha: string("Observed exact pull-request head SHA", 40), thread_count: integer("Returned thread count", 100), unresolved_current_count: integer("Current unresolved thread count", 100), items: array("Bounded review threads", reviewThread), completeness: string("Evidence completeness", 32, ["bounded_complete", "unknown_truncated"]), truncated: boolean("Whether thread evidence is truncated"),
}, ["observed_commit_sha", "thread_count", "unresolved_current_count", "items", "completeness", "truncated"])

const operationEvidence: Record<CommanderGithubReadToolId, CommanderToolJsonSchemaProperty> = {
  "github.repository_get": object("Repository metadata evidence", { full_name: string("Canonical repository", 201), name: string("Repository name", 120), description_preview: string("Bounded repository description", 500), default_branch: string("Default branch", 120), visibility: string("Visibility", 32), archived: boolean("Archived state"), private: boolean("Private state"), truncated: boolean("Truncation state") }, ["full_name", "truncated"]),
  "github.commit_get": object("Exact commit metadata evidence", { sha: string("Exact commit SHA", 40), observed_commit_sha: string("Observed exact commit SHA", 40), message_preview: string("Bounded commit message", 500), author_login: string("Author login", 120), authored_at: string("Authored timestamp", 64), parent_shas: array("Parent SHAs", string("Exact parent SHA", 40)), omitted_parent_count: integer("Omitted parent count", 100), truncated: boolean("Truncation state") }, ["sha", "observed_commit_sha", "parent_shas", "omitted_parent_count", "truncated"]),
  "github.pull_request_get": object("Pull-request and changed-file evidence", { number: integer("Pull-request number"), title_preview: string("Bounded title", 500), state: string("Pull-request state", 32), draft: boolean("Draft state"), updated_at: string("Update timestamp", 64), head_sha: string("Head SHA", 40), base_sha: string("Base SHA", 40), changed_files: integer("Changed-file count"), labels: array("Labels", string("Label", 100)), omitted_label_count: integer("Omitted label count", 100), files: array("Changed-file summaries", file), truncated: boolean("Truncation state") }, ["number", "draft", "labels", "omitted_label_count", "files", "truncated"]),
  "github.issue_get": object("Issue metadata evidence", { number: integer("Issue number"), title_preview: string("Bounded title", 500), body_preview: string("Bounded issue body", 1200), state: string("Issue state", 32), updated_at: string("Update timestamp", 64), author_login: string("Author login", 120), labels: array("Labels", string("Label", 100)), omitted_label_count: integer("Omitted label count", 100), truncated: boolean("Truncation state") }, ["number", "labels", "omitted_label_count", "truncated"]),
  "github.commit_checks": object("Exact-SHA check-run evidence", { commit_sha: string("Observed commit SHA", 40), observed_commit_sha: string("Observed exact commit SHA", 40), total_count: integer("Reported check count", 100_000), items: array("Check-run summaries", check), truncated: boolean("Truncation state") }, ["items", "truncated"]),
  "github.pull_request_reviews": object("Exact-head review and thread evidence", { observed_commit_sha: string("Observed exact pull-request head SHA", 40), items: array("Review summaries", review), thread_state: threadState, truncated: boolean("Truncation state") }, ["observed_commit_sha", "items", "thread_state", "truncated"]),
}

export function commanderGithubOutputSchema(toolId: CommanderGithubReadToolId): CommanderToolJsonSchema {
  const result = object("Operation-specific bounded GitHub result", {
    repository: string("Canonical repository", 201), operation: string("Exact GitHub tool", 120, [toolId]), requested_ref: string("Exact requested resource reference", 240), evidence: operationEvidence[toolId],
  }, ["repository", "operation", "evidence"])
  result.nullable = true
  return {
    schema_version: "nxl-commander-tool-v1",
    type: "object",
    properties: {
      status: string("Gateway result status", 32, ["ready", "empty", "blocked", "failed", "cancelled"]), tool_id: string("Exact GitHub tool", 120, [toolId]), repository: string("Canonical repository", 201), result, evidence: array("Bounded evidence cards", evidenceCard), provenance, request_count: integer("Audited request count", 4), page_count: integer("Response page count", 4), item_count: integer("Normalized item count", 50), normalized_bytes: integer("Normalized evidence bytes", 8000), truncated: boolean("Whether evidence is truncated"), external_api_audit_request_ids: array("External audit request IDs", string("Audit request ID", 240)), external_api_audit_event_kinds: array("External audit event kinds", string("Audit event kind", 80, ["external_api_request_executed", "external_api_request_failed"])), network_called: boolean("Whether transport dispatched"), blockers: array("Bounded blockers", string("Blocker", 500)), warnings: array("Bounded warnings", string("Warning", 500)), generated_at: string("Generation timestamp", 64), result_hash: string("Semantic result hash", 128),
    },
    required: ["status", "tool_id", "result", "evidence", "request_count", "page_count", "item_count", "normalized_bytes", "truncated", "external_api_audit_request_ids", "external_api_audit_event_kinds", "network_called", "blockers", "warnings", "generated_at", "result_hash"],
    additionalProperties: false,
  }
}
