# Pipelines Credentials

> [!IMPORTANT]
> Use of this action requires a valid Gruntwork subscription.

This action allows for optional integration with the [Gruntwork.io app](https://github.com/apps/gruntwork-io).

When installed on a repository or organization, it allows for usage of [Gruntwork Pipelines](https://www.gruntwork.io/products/pipelines) without the need to utilize static tokens for accessing resources in GitHub.

## Usage

Direct installation of this action by third parties isn't recommended. The Gruntwork maintainers will set up the integration in the [Pipelines Workflows](https://github.com/gruntwork-io/pipelines-workflows) repository.

### Inputs

| Name | Required | Description |
|------|----------|-------------|
| `token_requests` | Yes | JSON array of token requests (see format below) |
| `api_base_url` | No | API base URL (defaults to production) |

### Token Request Format

Each token request in the JSON array must have:
- `name`: Output name for the token (e.g., `gruntwork_read`)
- `path`: Token path on the API (e.g., `pipelines-read/gruntwork-io`)
- `fallback_env`: Environment variable name containing the fallback token

### Outputs

- `tokens_json`: JSON object with all tokens keyed by name

### Example

```yaml
- name: Fetch all credentials
  id: creds
  uses: gruntwork-io/pipelines-credentials@main
  env:
    PIPELINES_READ_TOKEN: ${{ secrets.PIPELINES_READ_TOKEN }}
    INFRA_ROOT_WRITE_TOKEN: ${{ secrets.INFRA_ROOT_WRITE_TOKEN }}
  with:
    token_requests: |
      [
        {"name": "gruntwork_read", "path": "pipelines-read/gruntwork-io", "fallback_env": "PIPELINES_READ_TOKEN"},
        {"name": "org_read", "path": "pipelines-read/${{ github.repository_owner }}", "fallback_env": "PIPELINES_READ_TOKEN"},
        {"name": "infra_write", "path": "propose-infra-change/${{ github.repository_owner }}", "fallback_env": "INFRA_ROOT_WRITE_TOKEN"}
      ]

- name: Use tokens
  run: |
    echo "Tokens are available via fromJson"
  env:
    GRUNTWORK_READ_TOKEN: ${{ fromJson(steps.creds.outputs.tokens_json).gruntwork_read }}
    ORG_READ_TOKEN: ${{ fromJson(steps.creds.outputs.tokens_json).org_read }}
    INFRA_WRITE_TOKEN: ${{ fromJson(steps.creds.outputs.tokens_json).infra_write }}
```

## How it Works

1. Fetches a GitHub OIDC JWT to authenticate the workflow.
2. Exchanges the JWT for a Gruntwork provider token.
3. Fetches all requested PAT tokens in parallel.
4. Falls back to the specified environment variable if a token fetch fails.
5. Fails the workflow if no fallback is available.
