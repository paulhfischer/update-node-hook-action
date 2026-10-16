import { endGroup, info, setFailed, startGroup } from '@actions/core';
import { exec, getExecOutput } from '@actions/exec';
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { mkdtemp } from 'fs/promises';
import yaml from 'js-yaml';
import { tmpdir } from 'os';
import path from 'path';
import { argv, cwd } from 'process';
import { simpleGit } from 'simple-git';

type DependenciesType = Record<string, string>;

interface PackageJsonType {
    name: string;
    version: string;
    peerDependencies?: DependenciesType;
    dependencies?: DependenciesType;
}

type HooksType = [
    {
        additional_dependencies: string[];
    },
];

type ChangesType = {
    name: string;
    oldVersion: string;
    newVersion: string;
}[];

const prettyJson = (value: unknown): string => {
    return JSON.stringify(value, null, 4);
};

const installPackages = async (
    packages: string[],
    save: boolean,
    nodeenv: string,
): Promise<void> => {
    const args = [
        'install',
        ...packages,
        '--strict-peer-deps',
        '--ignore-scripts',
        '--no-fund',
        '--no-audit',
    ];
    if (save) args.push('--save-prod', '--save-exact');

    await exec('npm', args, { cwd: nodeenv });
};

const isPublished = async (name: string, version: string): Promise<boolean> => {
    const { exitCode, stdout, stderr } = await getExecOutput(
        'npm',
        ['view', `${name}@${version}`, 'version'],
        { ignoreReturnCode: true, silent: true },
    );
    if (exitCode === 0) return stdout.trim() === version;
    if (stderr.includes('E404')) return false;

    throw new Error(`Could not check whether ${name}@${version} is published:\n${stderr}`);
};

const isInstalled = (pkg: string, nodeenv: string): boolean => {
    return (
        existsSync(path.join(nodeenv, 'node_modules', pkg)) &&
        statSync(path.join(nodeenv, 'node_modules', pkg)).isDirectory()
    );
};

const getPackageJson = (directory: string, pkg?: string): PackageJsonType => {
    const file = pkg
        ? path.join(directory, 'node_modules', pkg, 'package.json')
        : path.join(directory, 'package.json');

    return JSON.parse(readFileSync(file, 'utf-8')) as PackageJsonType;
};

const getPeerDependencies = (pkg: string, nodeenv: string): DependenciesType => {
    if (!isInstalled(pkg, nodeenv)) {
        info(`Skipping peer-dependencies of ${pkg}, as it is not installed.`);
        return {};
    }

    return Object.keys(getPackageJson(nodeenv, pkg).peerDependencies ?? {}).reduce(
        (peerDependencies, peerDependency) => {
            if (!isInstalled(peerDependency, nodeenv)) {
                info(
                    `Skipping peer-dependency ${peerDependency} of ${pkg}, as it is not installed.`,
                );
                return peerDependencies;
            }

            return {
                ...peerDependencies,
                [peerDependency]: getPackageJson(nodeenv, peerDependency).version,
                ...getPeerDependencies(peerDependency, nodeenv),
            };
        },
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
    info(prettyJson({ noCommit }));
    endGroup();

    startGroup('create temporary environment for package installation');
    const nodeenv = await mkdtemp(path.join(tmpdir(), 'autoupdate-'));
    info(nodeenv);
    endGroup();

    startGroup('get current peer dependencies from package.json');
    const oldPeerDependencies = getPackageJson(cwd()).peerDependencies ?? {};
    info(prettyJson(oldPeerDependencies));
    endGroup();

    startGroup('install latest version of peer dependencies listed in package.json');
    await installPackages(Object.keys(oldPeerDependencies), true, nodeenv);
    const newPeerDependencies = getPackageJson(nodeenv).dependencies ?? {};
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

    const git = simpleGit();

    startGroup('check for file changes');
    const fileChanges = Boolean(await git.diff(['.pre-commit-hooks.yaml', 'package.json']));
    info(fileChanges.toString());
    endGroup();

    startGroup('check whether current version is released');
    const { name, version: currentVersion } = getPackageJson(cwd());
    const published = await isPublished(name, currentVersion);
    const tagged = (await git.tags()).all.includes(`v${currentVersion}`);
    info(prettyJson({ version: currentVersion, published, tagged }));
    endGroup();

    if (!fileChanges && published) {
        info('Everything up to date.');
        return;
    }

    if (noCommit) {
        info(fileChanges ? 'Updated files.' : `Version ${currentVersion} is not published yet.`);
        return;
    }

    await git
        .addConfig('user.name', 'github-actions[bot]')
        .addConfig('user.email', '41898282+github-actions[bot]@users.noreply.github.com');

    let version = currentVersion;
    let tagExists = tagged;
    if (fileChanges) {
        // keep versions that were bumped manually or failed to publish
        if (published) {
            startGroup('bump version');
            await exec('npm', [
                'version',
                versionChanges.length ? 'minor' : 'patch',
                '--no-git-tag-version',
            ]);
            version = getPackageJson(cwd()).version;
            tagExists = false;
            info(version);
            endGroup();
        }

        info('commit changes');
        await git.add(['.pre-commit-hooks.yaml', 'package.json']).commit('autoupdate');
    }

    if (!tagExists) {
        info('tag version');
        await git.addAnnotatedTag(`v${version}`, `Version ${version}`);
    }

    info('push changes');
    await git.push().pushTags();

    startGroup('publish to npm');
    await exec('npm', ['publish']);
    endGroup();

    info(`Published version ${version}.`);
}

main().catch((error: unknown) => setFailed(error instanceof Error ? error.message : String(error)));
