# Pipelines Credentials

> [!IMPORTANT]
> Use of this action requires a valid Gruntwork subscription.

This action allows for optional integration with the [Grunty app](https://github.com/apps/grunty-app). 

When installed on a repository or organization, it allows for usage of [Gruntwork Pipelines](https://www.gruntwork.io/products/pipelines) without the need to utilize static tokens for accessing resources in GitHub.

## Usage

Direct installation of this action by third parties isn't recommended. The Gruntwork maintainers will set up the integration in the [Pipelines Workflows](https://github.com/gruntwork-io/pipelines-workflows) repository.

To understand how this action can be customized, know that an optional `FALLBACK_TOKEN` can be provided to the action to replace integration with the Grunty app.

This allows customers to opt-out of using the Grunty app, and instead use a static PAT that they provision using the guidance [here](https://docs.gruntwork.io/pipelines/security/machine-users).

## How it Works

At a high level, this action does the following:

1. Uses the GitHub `@actions/core` library to fetch a JWT authenticating a workflow as being run within the context of a particular repository using GitHub servers.
2. Uses that JWT to attempt to fetch a token from Gruntwork servers that authenticates the workflow as being allowed to access resources Gruntwork allows, and resources that the Grunty app has been granted access to.
    1. If the token is successfully fetched, it is set as an output variable for the workflow to use in subsequent steps.
    2. If the token cannot be fetched, the action will attempt to use the `FALLBACK_TOKEN` provided as an input to the action.
    3. If the `FALLBACK_TOKEN` is not provided, the action will fail the workflow.

As a consequence of running this action, the workflow will have a token that can be used to access relevant resources in GitHub, scoped to the permissions required for particular steps in the workflow.

e.g.

```yml
      - name: Fetch Gruntwork Read Token
        id: pipelines-gruntwork-read-token
        uses: gruntwork-io/pipelines-credentials@main
        with:
          PIPELINES_TOKEN_PATH: "pipelines-read/gruntwork-io"
          FALLBACK_TOKEN: ${{ secrets.PIPELINES_READ_TOKEN }}
```

Will result in the workflow being able to access a token at `${{ steps.pipelines-gruntwork-read-token.outputs.PIPELINES_TOKEN }}` that can be used to read relevant resources in the `gruntwork-io` organization, scoped to the ability to clone select repositories and fetch the [pipelines-cli](https://github.com/gruntwork-io/pipelines-cli) binary.

