"""Agent context의 개인정보·인증 경계."""

from __future__ import annotations

from typing import Any

FORBIDDEN_CONTEXT_KEYS = {
    "credentials", "credential", "auth", "access_token", "accessToken", "refresh_token", "refreshToken",
    "api_key", "apiKey", "provider_raw", "providerRaw", "raw_provider_response", "rawProviderResponse",
    "raw_survey", "rawSurvey", "allergies_raw", "allergiesRaw", "health_details", "healthDetails",
    "database_url", "databaseUrl",
}


class PrivacyBoundaryError(ValueError):
    pass


def assert_no_forbidden_context_keys(value: Any, path: str = "$") -> None:
    if isinstance(value, list | tuple):
        for index, item in enumerate(value):
            assert_no_forbidden_context_keys(item, f"{path}[{index}]")
        return
    if not isinstance(value, dict):
        return
    for key, child in value.items():
        child_path = f"{path}.{key}"
        if key in FORBIDDEN_CONTEXT_KEYS:
            raise PrivacyBoundaryError(f"Agent context에 금지된 필드가 포함되었습니다: {child_path}")
        assert_no_forbidden_context_keys(child, child_path)
