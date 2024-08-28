#!/usr/bin/env bash

set -euo pipefail

: "${PROVIDER_TOKEN:?"PROVIDER_TOKEN must be set"}"
: "${PIPELINES_TOKEN_PATH:?"PIPELINES_TOKEN_PATH must be set"}"

pipelines_token="$(curl -s -H "Authorization: Bearer $PROVIDER_TOKEN" -XPOST "https://aperture-dev-git-pipelines-api-gruntwork.vercel.app/api/v1/tokens/pat/$PIPELINES_TOKEN_PATH")"

echo "::add-mask::$pipelines_token"

echo "pipelines_token=$pipelines_token" >> "$GITHUB_OUTPUT"