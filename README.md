# update-node-hook-action

Action to automatically update node-based pre-commit hooks.

### Usage

#### GitHub Action

Create a workflow-file (`.github/workflows/update.yml`)

```yaml
name: update

on:
    workflow_dispatch:
    schedule:
        - cron: '0 6 * * 1'

permissions:
    contents: write
    id-token: write

jobs:
    update:
        runs-on: ubuntu-latest
        steps:
            - uses: paulhfischer/update-node-hook-action@v2
```

#### Local

You can also update the `package.json` and `pre-commit-hooks.yaml` files locally without pushing changes by running the following commands in your hook repository:

```
npm install --prefix path/to/this/repo
node /path/to/this/repo/dist/index.js --no-commit
```
