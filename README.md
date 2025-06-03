# Pipelines Credentials

> [!IMPORTANT]
> Use of this action requires a valid Gruntwork subscription.

This action allows for optional integration with the [Gruntwork.io app](https://github.com/apps/gruntwork-io).

When installed on a repository or organization, it allows for usage of [Gruntwork Pipelines](https://www.gruntwork.io/products/pipelines) without the need to utilize static tokens for accessing resources in GitHub.

## Usage

Direct installation of this action by third parties isn't recommended. The Gruntwork maintainers will set up the integration in the [Pipelines Workflows](https://github.com/gruntwork-io/pipelines-workflows) repository.

This action can fetch multiple tokens in parallel, improving workflow performance. You can provide multiple token requests as a JSON array, and each token request can have its own fallback token.

This allows customers to opt-out of using the Gruntwork.io app for specific tokens, and instead use static PATs that they provision using the guidance [here](https://docs.gruntwork.io/pipelines/security/machine-users).

## How it Works

At a high level, this action does the following:

1. Uses the GitHub `@actions/core` library to fetch a JWT authenticating a workflow as being run within the context of a particular repository using GitHub servers.
2. Uses that JWT to attempt to fetch tokens from Gruntwork servers that authenticate the workflow as being allowed to access resources Gruntwork allows, and resources that the Gruntwork.io app has been granted access to.
    1. If the tokens are successfully fetched, they are set as output variables for the workflow to use in subsequent steps.
    2. If a token cannot be fetched, the action will attempt to use the `fallback_secret` provided for that specific token.
    3. If a `fallback_secret` is not provided for a required token, the action will fail the workflow.
3. All token requests are processed in parallel for improved performance.

As a consequence of running this action, the workflow will have tokens that can be used to access relevant resources in GitHub, scoped to the permissions required for particular steps in the workflow.

## Retry Logic and Resilience

This action includes robust retry logic to handle transient network issues:

- **Network Errors**: Automatically retries on `TypeError` exceptions thrown by `fetch()` due to network connectivity issues
- **Server Errors**: Retries on HTTP 5xx server errors and 429 rate limiting responses  
- **Retry Strategy**: Up to 3 attempts with random backoff (0-3 seconds) between retries
- **Parallel Resilience**: Each token fetch has independent retry logic, so one token's network issues don't affect others
- **Graceful Fallback**: If all retries fail, the action falls back to the provided `fallback_secret` for that specific token

This ensures workflows remain stable even in environments with intermittent network connectivity or temporary service disruptions.

## Examples

### Single Token (Legacy Compatible)
```yml
      - name: Fetch Multiple Tokens
        id: pipelines-tokens
        uses: gruntwork-io/pipelines-credentials@main
        with:
          PIPELINES_TOKEN_PATHS: |
            [
              {
                "name": "gruntwork_read",
                "path": "pipelines-read/gruntwork-io",
                "fallback_secret": "${{ secrets.PIPELINES_READ_TOKEN }}"
              }
            ]
```

### Multiple Tokens
```yml
      - name: Fetch Multiple Tokens
        id: pipelines-tokens
        uses: gruntwork-io/pipelines-credentials@main
        with:
          PIPELINES_TOKEN_PATHS: |
            [
              {
                "name": "gruntwork_read",
                "path": "pipelines-read/gruntwork-io",
                "fallback_secret": "${{ secrets.PIPELINES_READ_TOKEN }}"
              },
              {
                "name": "customer_org_read",
                "path": "pipelines-read/${{ github.repository_owner }}",
                "fallback_secret": "${{ secrets.PIPELINES_READ_TOKEN }}"
              },
              {
                "name": "pr_create",
                "path": "propose-infra-change/${{ github.repository_owner }}",
                "fallback_secret": "${{ secrets.PR_CREATE_TOKEN }}"
              }
            ]
```

### Using the Tokens
```yml
      - name: Use tokens
        env:
          GRUNTWORK_TOKEN: ${{ fromJSON(steps.pipelines-tokens.outputs.PIPELINES_TOKENS).gruntwork_read }}
          CUSTOMER_TOKEN: ${{ fromJSON(steps.pipelines-tokens.outputs.PIPELINES_TOKENS).customer_org_read }}
          PR_TOKEN: ${{ fromJSON(steps.pipelines-tokens.outputs.PIPELINES_TOKENS).pr_create }}
        run: |
          echo "Using tokens for various operations"
```

The workflow will have access to tokens at `${{ fromJSON(steps.pipelines-tokens.outputs.PIPELINES_TOKENS).token_name }}` where `token_name` corresponds to the `name` field in the token request configuration.

