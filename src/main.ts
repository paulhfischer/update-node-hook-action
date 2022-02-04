import { endGroup, getInput, info, setFailed, startGroup } from '@actions/core';
import { exec } from '@actions/exec';
import npmPublish from '@jsdevtools/npm-publish';
import { readFileSync, writeFileSync } from 'fs';
import { mkdtemp } from 'fs/promises';
import yaml from 'js-yaml';
import { tmpdir } from 'os';
import path from 'path';
import { argv, cwd } from 'process';
import simpleGit from 'simple-git';

type DependenciesType = Record<string, string>;

type PackageJsonType = {
    version: string;
    peerDependencies?: DependenciesType;
    dependencies?: DependenciesType;
};
type HooksType = [
    {
        additional_dependencies: Array<string>;
    },
];

type ChangesType = Array<{
    name: string;
    oldVersion: string;
    newVersion: string;
}>;

const prettyJson = (value: any): string => {
    return JSON.stringify(value, null, 4);
};

const getPackageJson = (directory: string, pkg?: string): PackageJsonType => {
    const file = pkg
        ? path.join(directory, 'node_modules', pkg, 'package.json')
        : path.join(directory, 'package.json');

    return JSON.parse(readFileSync(file, 'utf-8'));
};

const getPeerDependencies = (pkg: string, environment: string): DependenciesType => {
    return Object.keys(getPackageJson(environment, pkg).peerDependencies || {}).reduce(
        (peerDependencies, peerDependency) => ({
            ...peerDependencies,
            [peerDependency]: getPackageJson(environment, peerDependency).version,
            ...getPeerDependencies(peerDependency, environment),
        }),
        {},
    );
};

const getAdditionalDependencies = (
    peerDependencies: DependenciesType,
    environment: string,
): DependenciesType => {
    return Object.entries(peerDependencies).reduce(
        (additionalDependencies, [peerDependency, version]) => ({
            ...additionalDependencies,
            [peerDependency]: version,
            ...getPeerDependencies(peerDependency, environment),
        }),
        {},
    );
};

const getVersionChanges = (
    oldDependencies: DependenciesType,
    newDependencies: DependenciesType,
): ChangesType => {
    return Object.entries(oldDependencies)
        .filter(([name, oldVersion]) => oldVersion !== newDependencies[name])
        .map(([name, oldVersion]) => ({
            name,
            oldVersion,
            newVersion: newDependencies[name],
        }));
};

const createPackageJson = (peerDependencies: DependenciesType): void => {
    info(prettyJson(peerDependencies));

    const file = 'package.json';

    const packageJson = JSON.parse(readFileSync(file, 'utf-8')) as PackageJsonType;
    packageJson.peerDependencies = peerDependencies;

    writeFileSync(file, `${prettyJson(packageJson)}\n`);
};

const createHookFile = (peerDependencies: DependenciesType, environment: string): void => {
    const additionalDependencies = Object.entries(
        getAdditionalDependencies(peerDependencies, environment),
    )
        .sort()
        .map(([name, version]) => `${name}@${version}`);
    info(prettyJson(additionalDependencies));

    const file = '.pre-commit-hooks.yaml';

    const hooks = yaml.load(readFileSync(file, 'utf-8')) as HooksType;
    hooks[0].additional_dependencies = additionalDependencies;
    writeFileSync(file, yaml.dump(hooks, { lineWidth: 100 }));
};

async function main() {
    startGroup('get setting');
    const noCommit = argv.includes('--no-commit');
    const npmToken = getInput('npm-token', { required: !noCommit });
    info(prettyJson({ npmToken: '***', noCommit }));
    endGroup();

    startGroup('create temporary environment for package installation');
    const nodeenv = await mkdtemp(path.join(tmpdir(), 'autoupdate-'));
    info(nodeenv);
    endGroup();

    startGroup('get current peer dependencies from package.json');
    const oldPeerDependencies = getPackageJson(cwd()).peerDependencies || {};
    info(prettyJson(oldPeerDependencies));
    endGroup();

    startGroup('install latest version of peer dependencies listed in package.json');
    await exec(
        'npm',
        [
            'install',
            ...Object.keys(oldPeerDependencies),
            '--save-prod',
            '--save-exact',
            '--strict-peer-deps',
        ],
        { cwd: nodeenv },
    );
    const newPeerDependencies = getPackageJson(nodeenv).dependencies || {};
    info(prettyJson(newPeerDependencies));
    endGroup();

    startGroup('get version changes');
    const versionChanges = getVersionChanges(oldPeerDependencies, newPeerDependencies);
    info(
        versionChanges
            .map(({ name, oldVersion, newVersion }) => `${name}: ${oldVersion} → ${newVersion}`)
            .join('\n'),
    );
    endGroup();

    startGroup('update package.json');
    createPackageJson(newPeerDependencies);
    endGroup();

    startGroup('update hook');
    createHookFile(newPeerDependencies, nodeenv);
    endGroup();

    startGroup('check for file changes');
    const fileChanges = Boolean(await simpleGit().diff(['.pre-commit-hooks.yaml', 'package.json']));
    info(fileChanges.toString());
    endGroup();

    if (!fileChanges) {
        info('Everything up to date.');
        return;
    }

    if (noCommit) {
        info('Updated files.');
        return;
    }

    startGroup('get current package version');
    const oldVersion = getPackageJson(cwd()).version;
    info(oldVersion);
    endGroup();

    startGroup('bump version');
    await exec('npm', [
        'version',
        versionChanges.length ? 'minor' : 'patch',
        '--no-git-tag-version',
    ]);
    const newVersion = getPackageJson(cwd()).version;
    info(newVersion);
    endGroup();

    info('commit and push changes');
    await simpleGit()
        .addConfig('user.name', 'GitHub Actions')
        .addConfig('user.email', 'actions@github.com')
        .add(['.pre-commit-hooks.yaml', 'package.json'])
        .commit('autoupdate')
        .addAnnotatedTag(`v${newVersion}`, `Version ${newVersion}`)
        .push()
        .pushTags();

    startGroup('publish to npm');
    await npmPublish({ token: npmToken });
    endGroup();

    info(`Bumped package version (${oldVersion} → ${newVersion}):`);
}

main().catch((error) => setFailed(error.message));
