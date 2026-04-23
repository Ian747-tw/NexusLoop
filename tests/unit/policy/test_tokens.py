"""
M0.3 Step 3: CapabilityToken machinery.

mint(scope, ttl_seconds, postcondition) creates a token.
consume(token) validates postcondition and marks token used.
expire(token) marks token expired if TTL exceeded.
"""
from __future__ import annotations

import time

import pytest

from nxl_core.policy.tokens import CapabilityToken, mint, consume, expire


class TestCapabilityToken:
    def test_mint_returns_token(self) -> None:
        token = mint(scope="train:gpu", ttl_seconds=300)
        assert token is not None
        assert token.scope == "train:gpu"
        assert token.used is False
        assert token.expired is False

    def test_token_serialization(self) -> None:
        token = mint(scope="eval:cpu", ttl_seconds=60)
        blob = token.model_dump_json()
        parsed = CapabilityToken.model_validate_json(blob)
        assert parsed.scope == token.scope
        assert parsed.token_id == token.token_id


class TestConsume:
    def test_consume_validates_postcondition_true(self) -> None:
        token = mint(scope="deploy", ttl_seconds=300, postcondition=lambda ctx: ctx.get("approved") is True)
        ctx = {"approved": True}
        result = consume(token, ctx)
        assert result is True
        assert token.used is True

    def test_consume_validates_postcondition_false(self) -> None:
        token = mint(scope="deploy", ttl_seconds=300, postcondition=lambda ctx: ctx.get("approved") is True)
        ctx = {"approved": False}
        result = consume(token, ctx)
        assert result is False
        assert token.used is False

    def test_consume_no_postcondition(self) -> None:
        token = mint(scope="read", ttl_seconds=300)
        result = consume(token, {})
        assert result is True
        assert token.used is True

    def test_consume_already_used(self) -> None:
        token = mint(scope="deploy", ttl_seconds=300)
        consume(token, {})
        result = consume(token, {})
        assert result is False  # already used
        assert token.used is True


class TestExpire:
    def test_expire_within_ttl(self) -> None:
        token = mint(scope="train", ttl_seconds=300)
        time.sleep(0.1)
        result = expire(token)
        assert result is False
        assert token.expired is False

    def test_expire_after_ttl(self) -> None:
        token = mint(scope="train", ttl_seconds=1)
        time.sleep(1.1)
        result = expire(token)
        assert result is True
        assert token.expired is True

    def test_expire_already_used(self) -> None:
        token = mint(scope="train", ttl_seconds=1)
        consume(token, {})
        time.sleep(1.1)
        result = expire(token)
        assert result is False  # used tokens don't expire until TTL + grace


class TestTokenId:
    def test_token_id_is_unique(self) -> None:
        tokens = [mint(scope="test", ttl_seconds=300) for _ in range(100)]
        ids = [t.token_id for t in tokens]
        assert len(set(ids)) == 100
