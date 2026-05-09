"""Durable project spec backend.

The extractor boundary is injected. This module validates, versions, approves,
and emits events for structured spec state; it does not call an LLM.
"""
from __future__ import annotations

import tempfile
import hashlib
import os
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from nxl_core.events.log import EventLog
from nxl_core.events.schema import (
    SpecApprovalRequested,
    SpecApproved,
    SpecChangeIntentDetected,
    SpecClarificationAnswered,
    SpecClarificationRequested,
    SpecDraftCreated,
    SpecDraftUpdated,
    SpecSuperseded,
    UserPlainSpecReceived,
)
from nxl_core.security.redaction import redact_text

SpecExtractor = Callable[[str], dict[str, Any]]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _atomic_write(path: Path, text: str, *, mode: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        if mode is not None:
            os.chmod(tmp, mode)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


class ComputePolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    gpu_allowed: bool = False
    gpu_memory_limit_gb: float | None = None
    cpu_worker_limit: int = Field(default=1, ge=1)
    max_parallel_training_runs: int = Field(default=1, ge=1)
    checkpoint_disk_limit_gb: float = Field(default=1, ge=0)


class WakeHookPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = True
    user_min_period_minutes: int = Field(default=15, ge=1)
    user_max_period_minutes: int = Field(default=240, ge=1)
    default_training_period_minutes: int = Field(default=60, ge=1)
    allow_agent_suggested_hooks: bool = False
    require_approval_below_minutes: int = Field(default=30, ge=1)

    @model_validator(mode="after")
    def validate_period_order(self) -> "WakeHookPolicy":
        if not (
            self.user_min_period_minutes
            <= self.default_training_period_minutes
            <= self.user_max_period_minutes
        ):
            raise ValueError("wake hook policy requires min <= default <= max")
        return self


class TrainingPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    labels_allowed: list[
        Literal["probe", "smoke_test", "full_training", "evaluation", "ablation", "debug_run"]
    ] = Field(
        default_factory=lambda: [
            "probe",
            "smoke_test",
            "full_training",
            "evaluation",
            "ablation",
            "debug_run",
        ]
    )
    full_training_requires_repro_recipe: bool = True
    probe_can_update_best_model: bool = False

    @field_validator("labels_allowed")
    @classmethod
    def labels_must_not_be_empty(cls, value: list[str]) -> list[str]:
        if not value:
            raise ValueError("training policy requires at least one allowed label")
        return value


class ClarificationRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question_id: str
    question: str
    field: str
    answer: str | None = None
    asked_at: datetime = Field(default_factory=_now)
    answered_at: datetime | None = None

    @field_validator("question", "field")
    @classmethod
    def redact_record_text(cls, value: str) -> str:
        return redact_text(value.strip())

    @field_validator("answer")
    @classmethod
    def redact_optional_answer(cls, value: str | None) -> str | None:
        return None if value is None else redact_text(value.strip())


class ProjectSpecV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    spec_id: str
    version: int = 1
    status: Literal["draft", "approved", "superseded"] = "draft"
    objective: str
    project_mode: Literal["build", "improve", "test"]
    domain: str = "unspecified"
    environment: str = "unspecified"
    success_metrics: list[str]
    evaluation_protocol: str
    compute_policy: ComputePolicy = Field(default_factory=ComputePolicy)
    wake_hook_policy: WakeHookPolicy = Field(default_factory=WakeHookPolicy)
    training_policy: TrainingPolicy = Field(default_factory=TrainingPolicy)
    user_rules: list[str] = Field(default_factory=list)
    forbidden_actions: list[str] = Field(default_factory=list)
    clarification_history: list[ClarificationRecord] = Field(default_factory=list)
    approved_by: str | None = None
    approved_at: datetime | None = None
    created_at: datetime = Field(default_factory=_now)

    @field_validator("objective", "evaluation_protocol")
    @classmethod
    def required_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("required text field cannot be blank")
        return redact_text(value.strip())

    @field_validator("domain", "environment")
    @classmethod
    def redact_short_text(cls, value: str) -> str:
        return redact_text(value.strip())

    @field_validator("success_metrics")
    @classmethod
    def success_metrics_required(cls, value: list[str]) -> list[str]:
        cleaned = [redact_text(item.strip()) for item in value if item.strip()]
        if not cleaned:
            raise ValueError("at least one success metric is required")
        return cleaned

    @field_validator("user_rules", "forbidden_actions")
    @classmethod
    def redact_text_list(cls, value: list[str]) -> list[str]:
        return [redact_text(item.strip()) for item in value if item.strip()]


class SpecDraftResult(BaseModel):
    spec: ProjectSpecV1
    clarifications: list[ClarificationRecord] = Field(default_factory=list)

    @property
    def requires_clarification(self) -> bool:
        return bool(self.clarifications)


def _default_extractor(text: str) -> dict[str, Any]:
    return {
        "objective": text.strip(),
        "project_mode": "build",
        "success_metrics": [],
        "evaluation_protocol": "",
    }


def _deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    result = dict(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


class SpecStore:
    """Versioned spec store under ``.nxl/spec``."""

    def __init__(
        self,
        project_dir: Path,
        *,
        event_log: EventLog | None = None,
        extractor: SpecExtractor | None = None,
    ) -> None:
        self.project_dir = Path(project_dir)
        self.spec_dir = self.project_dir / ".nxl" / "spec"
        self.versions_dir = self.spec_dir / "versions"
        self.current_json = self.spec_dir / "current.json"
        self.current_md = self.spec_dir / "current.md"
        self.event_log = event_log or EventLog(self.project_dir / ".nxl" / "events.jsonl")
        self.extractor = extractor or _default_extractor

    def createDraftFromPlainText(self, plain_text: str) -> SpecDraftResult:
        text = plain_text.strip()
        if not text:
            raise ValueError("plain text spec cannot be empty")
        self.event_log.append(UserPlainSpecReceived(source="message_box", text_hash=_stable_hash(text)))
        data = _redact_extracted_data(self.extractor(text))
        result = self._build_draft(data)
        self._write_version(result.spec)
        self.event_log.append(
            SpecDraftCreated(
                spec_id=result.spec.spec_id,
                version=result.spec.version,
                requires_clarification=result.requires_clarification,
            )
        )
        for item in result.clarifications:
            self.event_log.append(
                SpecClarificationRequested(
                    spec_id=result.spec.spec_id,
                    question_id=item.question_id,
                    field=item.field,
                    question=item.question,
                )
            )
        return result

    def requestClarification(self, spec_id: str, *, question_id: str, answer: str) -> ProjectSpecV1:
        spec = self._load_version(spec_id)
        answer = redact_text(answer.strip())
        if not answer:
            raise ValueError("clarification answer cannot be empty")
        records = []
        found = False
        matched_field: str | None = None
        patch: dict[str, Any] = {}
        for item in spec.clarification_history:
            if item.question_id == question_id:
                records.append(item.model_copy(update={"answer": answer, "answered_at": _now()}))
                found = True
                matched_field = item.field
                patch = _clarification_patch(item.field, answer)
            else:
                records.append(item)
        if not found:
            raise KeyError(f"unknown clarification question: {question_id}")
        spec_data = spec.model_dump(mode="json")
        spec_data.update(patch)
        spec_data["clarification_history"] = [record.model_dump() for record in records]
        spec = ProjectSpecV1.model_validate(spec_data)
        self._write_version(spec)
        self.event_log.append(
            SpecClarificationAnswered(spec_id=spec_id, question_id=question_id, field=matched_field or "")
        )
        self.event_log.append(SpecDraftUpdated(spec_id=spec_id, version=spec.version, reason="clarification_answered"))
        return spec

    def updateDraft(self, spec_id: str, patch: dict[str, Any], *, reason: str = "manual_update") -> ProjectSpecV1:
        spec = self._load_version(spec_id)
        if spec.status != "draft":
            raise ValueError("only draft specs can be updated")
        merged = _deep_merge(spec.model_dump(mode="json"), patch)
        updated = ProjectSpecV1.model_validate(merged)
        self._write_version(updated)
        self.event_log.append(SpecDraftUpdated(spec_id=spec_id, version=updated.version, reason=reason))
        return updated

    def approveDraft(self, spec_id: str, *, approved_by: str) -> ProjectSpecV1:
        spec = self._load_version(spec_id)
        if spec.status != "draft":
            raise ValueError("only draft specs can be approved")
        if any(item.answer is None for item in spec.clarification_history):
            raise ValueError("cannot approve spec with unanswered clarifications")
        self.event_log.append(SpecApprovalRequested(spec_id=spec.spec_id, version=spec.version))
        current = self.getCurrentSpec()
        if current is not None:
            superseded = current.model_copy(update={"status": "superseded"})
            self._write_version(superseded)
            self.event_log.append(
                SpecSuperseded(spec_id=current.spec_id, superseded_by=spec.spec_id, version=current.version)
            )
        approved = spec.model_copy(
            update={"status": "approved", "approved_by": approved_by, "approved_at": _now()}
        )
        self._write_version(approved)
        _atomic_write(self.current_json, approved.model_dump_json(indent=2))
        _atomic_write(self.current_md, self._markdown(approved))
        self.event_log.append(SpecApproved(spec_id=approved.spec_id, version=approved.version, approved_by=approved_by))
        return approved

    def getCurrentSpec(self) -> ProjectSpecV1 | None:
        if not self.current_json.exists():
            return None
        return ProjectSpecV1.model_validate_json(self.current_json.read_text(encoding="utf-8"))

    def proposeSpecChange(self, plain_text: str) -> ProjectSpecV1:
        current = self.getCurrentSpec()
        if current is None:
            raise ValueError("cannot propose a spec change without an approved current spec")
        self.event_log.append(SpecChangeIntentDetected(message_hash=_stable_hash(plain_text.strip())))
        patch = _redact_extracted_data(self.extractor(plain_text))
        base = current.model_dump(mode="json")
        base.update(
            {
                "spec_id": f"spec_{uuid4().hex}",
                "version": current.version + 1,
                "status": "draft",
                "approved_by": None,
                "approved_at": None,
                "created_at": _now().isoformat(),
            }
        )
        updated = ProjectSpecV1.model_validate(_deep_merge(base, patch))
        self._write_version(updated)
        self.event_log.append(SpecDraftUpdated(spec_id=updated.spec_id, version=updated.version, reason="spec_change_intent"))
        return updated

    def runtimeReady(self) -> bool:
        current = self.getCurrentSpec()
        return current is not None and current.status == "approved"

    def _build_draft(self, data: dict[str, Any]) -> SpecDraftResult:
        raw = {
            "spec_id": f"spec_{uuid4().hex}",
            "version": 1,
            "status": "draft",
            "objective": data.get("objective") or "Clarification required",
            "project_mode": data.get("project_mode") or "build",
            "domain": data.get("domain") or "unspecified",
            "environment": data.get("environment") or "unspecified",
            "success_metrics": data.get("success_metrics") or ["Clarification required"],
            "evaluation_protocol": data.get("evaluation_protocol") or "Clarification required",
            "compute_policy": data.get("compute_policy") or {},
            "wake_hook_policy": data.get("wake_hook_policy") or {},
            "training_policy": data.get("training_policy") or {},
            "user_rules": data.get("user_rules") or [],
            "forbidden_actions": data.get("forbidden_actions") or [],
            "clarification_history": [],
        }
        clarifications = self._clarifications_for(data)
        raw["clarification_history"] = [item.model_dump() for item in clarifications]
        try:
            spec = ProjectSpecV1.model_validate(raw)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc
        return SpecDraftResult(spec=spec, clarifications=clarifications)

    def _clarifications_for(self, data: dict[str, Any]) -> list[ClarificationRecord]:
        checks = [
            ("objective", data.get("objective"), "What is the project objective?"),
            ("success_metrics", data.get("success_metrics"), "Which success metrics should approve progress?"),
            ("evaluation_protocol", data.get("evaluation_protocol"), "What evaluation protocol should be authoritative?"),
        ]
        out = []
        for field, value, question in checks:
            missing = value is None or value == "" or value == []
            if missing:
                out.append(
                    ClarificationRecord(
                        question_id=f"clar_{uuid4().hex}",
                        field=field,
                        question=question,
                    )
                )
        return out

    def _load_version(self, spec_id: str) -> ProjectSpecV1:
        path = self.versions_dir / f"{spec_id}.json"
        if not path.exists():
            raise KeyError(f"unknown spec id: {spec_id}")
        return ProjectSpecV1.model_validate_json(path.read_text(encoding="utf-8"))

    def _write_version(self, spec: ProjectSpecV1) -> None:
        _atomic_write(self.versions_dir / f"{spec.spec_id}.json", spec.model_dump_json(indent=2))

    def _markdown(self, spec: ProjectSpecV1) -> str:
        lines = [
            f"# Approved Spec {spec.spec_id}",
            "",
            f"Objective: {spec.objective}",
            f"Mode: {spec.project_mode}",
            f"Domain: {spec.domain}",
            f"Environment: {spec.environment}",
            "",
            "Success metrics:",
            *[f"- {metric}" for metric in spec.success_metrics],
            "",
            f"Evaluation protocol: {spec.evaluation_protocol}",
        ]
        return "\n".join(lines) + "\n"


def _stable_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def _redact_extracted_data(value: Any) -> Any:
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, list):
        return [_redact_extracted_data(item) for item in value]
    if isinstance(value, dict):
        return {key: _redact_extracted_data(item) for key, item in value.items()}
    return value


def _clarification_patch(field: str, answer: str) -> dict[str, Any]:
    if field == "objective":
        return {"objective": answer}
    if field == "success_metrics":
        metrics = [part.strip() for part in answer.replace("\n", ",").split(",") if part.strip()]
        return {"success_metrics": metrics or [answer]}
    if field == "evaluation_protocol":
        return {"evaluation_protocol": answer}
    return {}
