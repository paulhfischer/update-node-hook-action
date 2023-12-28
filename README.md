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

jobs:
    update:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
            - uses: paulhfischer/update-node-hook-action@v1
              with:
                  npm-token: ${{ secrets.NPM_TOKEN }}
```

#### Local

You can also update the `package.json` and `pre-commit-hooks.yaml` files locally without pushing changes by running the following commands in your hook repository:

```
npm install --prefix path/to/this/repo
node /path/to/this/repo/lib/main.js --no-commit
```
