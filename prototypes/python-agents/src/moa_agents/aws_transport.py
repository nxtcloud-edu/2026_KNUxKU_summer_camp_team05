from __future__ import annotations

import json
from importlib import import_module
from typing import Protocol, cast
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from collections.abc import Mapping

from .backend import JsonObject, to_jsonable
from .contracts import AgentContractError


class _FrozenCredentials(Protocol):
    access_key: str
    secret_key: str
    token: str | None


class _Credentials(Protocol):
    def get_frozen_credentials(self) -> _FrozenCredentials:
        ...


class _Session(Protocol):
    def get_credentials(self) -> _Credentials | None:
        ...


class _SessionFactory(Protocol):
    def __call__(self) -> _Session:
        ...


class _AwsRequest(Protocol):
    headers: Mapping[str, str]


class _AwsRequestFactory(Protocol):
    def __call__(
        self,
        *,
        method: str,
        url: str,
        data: bytes,
        headers: Mapping[str, str],
    ) -> _AwsRequest:
        ...


class _SigV4Signer(Protocol):
    def add_auth(self, request: _AwsRequest) -> None:
        ...


class _SigV4SignerFactory(Protocol):
    def __call__(
        self,
        credentials: _FrozenCredentials,
        service_name: str,
        region_name: str,
    ) -> _SigV4Signer:
        ...


class AwsSigV4GatewayTransport:
    def __init__(self, region: str) -> None:
        if not region:
            raise AgentContractError("AWS region is required")
        self.region = region

    def post_json(
        self,
        url: str,
        body: JsonObject,
        timeout_seconds: float,
    ) -> JsonObject:
        session_factory, request_factory, signer_factory = self._botocore_types()
        credentials = session_factory().get_credentials()
        if credentials is None:
            raise AgentContractError("AWS credentials are unavailable to the ECS task")
        payload = to_jsonable(body)
        if not isinstance(payload, dict):
            raise AgentContractError("gateway body must be a JSON object")
        encoded = json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        aws_request = request_factory(
            method="POST",
            url=url,
            data=encoded,
            headers={"Content-Type": "application/json"},
        )
        signer_factory(
            credentials.get_frozen_credentials(),
            "bedrock-agentcore",
            self.region,
        ).add_auth(aws_request)
        request = Request(
            url,
            data=encoded,
            headers=dict(aws_request.headers),
            method="POST",
        )
        try:
            with urlopen(request, timeout=timeout_seconds) as response:
                raw = response.read()
        except HTTPError as exc:
            detail = exc.read(2048).decode("utf-8", errors="replace")
            raise AgentContractError(
                f"AgentCore Gateway returned HTTP {exc.code}: {detail}"
            ) from exc
        except URLError as exc:
            raise AgentContractError("AgentCore Gateway is unreachable") from exc
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise AgentContractError("AgentCore Gateway returned invalid JSON") from exc
        if not isinstance(parsed, Mapping) or not all(
            isinstance(key, str) for key in parsed
        ):
            raise AgentContractError("AgentCore Gateway response must be a JSON object")
        return cast(JsonObject, parsed)

    def _botocore_types(
        self,
    ) -> tuple[_SessionFactory, _AwsRequestFactory, _SigV4SignerFactory]:
        try:
            session_module = import_module("botocore.session")
            awsrequest_module = import_module("botocore.awsrequest")
            auth_module = import_module("botocore.auth")
        except ModuleNotFoundError as exc:
            raise AgentContractError("botocore is required for IAM-signed gateway calls") from exc
        return (
            cast(_SessionFactory, getattr(session_module, "get_session")),
            cast(_AwsRequestFactory, getattr(awsrequest_module, "AWSRequest")),
            cast(_SigV4SignerFactory, getattr(auth_module, "SigV4Auth")),
        )
