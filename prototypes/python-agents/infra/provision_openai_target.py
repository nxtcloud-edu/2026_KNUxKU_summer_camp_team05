from __future__ import annotations

import argparse
import importlib
import json
import os
from typing import Any


DEFAULT_MODELS = ("gpt-5.4-mini", "gpt-5.4", "gpt-5.3-codex")


def target_request(
    gateway_id: str,
    target_name: str,
    provider_arn: str,
    models: tuple[str, ...],
) -> dict[str, Any]:
    return {
        "gatewayIdentifier": gateway_id,
        "name": target_name,
        "description": "OpenAI Responses API for MOA Python agents",
        "targetConfiguration": {
            "inference": {
                "provider": {
                    "endpoint": "https://api.openai.com",
                    "operations": [
                        {
                            "path": "/v1/responses",
                            "models": [{"model": model} for model in models],
                        }
                    ],
                }
            }
        },
        "credentialProviderConfigurations": [
            {
                "credentialProviderType": "API_KEY",
                "credentialProvider": {
                    "apiKeyCredentialProvider": {
                        "providerArn": provider_arn,
                        "credentialLocation": "HEADER",
                        "credentialParameterName": "Authorization",
                        "credentialPrefix": "Bearer ",
                    }
                },
            }
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gateway-id", required=True)
    parser.add_argument("--region", required=True)
    parser.add_argument("--target-name", default="openai")
    parser.add_argument("--credential-name", default="moa-openai")
    parser.add_argument("--credential-provider-arn")
    parser.add_argument("--models", nargs="+", default=list(DEFAULT_MODELS))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    models = tuple(dict.fromkeys(args.models))
    if args.dry_run:
        provider = args.credential_provider_arn or "<CREATED_PROVIDER_ARN>"
        print(
            json.dumps(
                target_request(args.gateway_id, args.target_name, provider, models),
                indent=2,
            )
        )
        return

    boto3 = importlib.import_module("boto3")
    client = boto3.client("bedrock-agentcore-control", region_name=args.region)
    provider_arn = args.credential_provider_arn
    if provider_arn is None:
        api_key = os.environ.get("OPENAI_API_KEY", "")
        if not api_key:
            raise SystemExit("OPENAI_API_KEY is required when creating a credential provider")
        credential = client.create_api_key_credential_provider(
            name=args.credential_name,
            apiKey=api_key,
            tags={"application": "moa", "purpose": "openai-inference"},
        )
        provider_arn = credential["credentialProviderArn"]
    response = client.create_gateway_target(
        **target_request(args.gateway_id, args.target_name, provider_arn, models)
    )
    print(
        json.dumps(
            {
                "gatewayIdentifier": response.get("gatewayIdentifier", args.gateway_id),
                "targetId": response.get("targetId"),
                "status": response.get("status"),
                "models": models,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
