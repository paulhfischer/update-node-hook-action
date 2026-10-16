# update-node-hook-action

Action to automatically update node-based pre-commit hooks.

Once a week, it installs the latest versions of all `peerDependencies` listed in the `package.json`
of a hook repository and writes them (and their peer-dependencies) to the `package.json` and the
`additional_dependencies` of the `.pre-commit-hooks.yaml`. If anything changed, it bumps the version
(minor for updated peer-dependencies, patch otherwise), commits, tags and publishes the package to
npm. Versions that were bumped manually or failed to publish are published on the next run.

It also updates the revisions in the repository's `.pre-commit-config.yaml` (disable with
`pre-commit-autoupdate: false`).

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

Packages are published with [trusted publishing](https://docs.npmjs.com/trusted-publishers), so
the workflow has to be configured as trusted publisher of the package on npm.

#### Local

You can also update the `package.json` and `.pre-commit-hooks.yaml` files locally without pushing
changes by running the following commands in your hook repository:

```
npm install --prefix path/to/this/repo
node /path/to/this/repo/dist/index.js --no-commit
```
