# Use the Web UI

English | [中文](index.zh.md)

Start the Web UI through the [root README](../../../README.en.md#run); the command prints its URL. This guide begins after that server is running. The `alpha` process uses its invoking directory as the default filesystem location, but a fresh Web UI has no selected workspace until you add one.

## Configure a model

Open **Settings → Models** and add a provider: pick one from the installed catalog, or declare a custom one for a gateway or a self-hosted server. Enter its API key, select a model, and save. The route becomes usable immediately without restarting the server, and the model you picked becomes the default for new sessions.

The [model configuration guide](./providers.md) covers the installed catalog, custom providers, model discovery, and request compatibility.

## Choose a workspace

Click **Choose workspace**, add the project directory where you started `alpha`, and select it. The session composer remains unavailable until a workspace is selected.

## Run a task

Start a session and send:

> Summarize this repository and identify its main packages.

The agent can read and edit workspace files, run commands, delegate work, and maintain a plan. The Web UI asks before operations that require approval under the active permission policy.

## Continue

- [Configure models](./providers.md)
- [Use the Python SDK](./python-sdk.md)
- [Use other CLI modes](../../../apps/cli/README.md)
- [Develop a plugin](../develop/basic/index.md)
