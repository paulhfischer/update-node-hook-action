"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@actions/core");
const exec_1 = require("@actions/exec");
const npm_publish_1 = require("@jsdevtools/npm-publish");
const fs_1 = require("fs");
const promises_1 = require("fs/promises");
const js_yaml_1 = __importDefault(require("js-yaml"));
const os_1 = require("os");
const path_1 = __importDefault(require("path"));
const process_1 = require("process");
const simple_git_1 = __importDefault(require("simple-git"));
const prettyJson = (value) => {
    return JSON.stringify(value, null, 4);
};
const installPackages = (packages, save, nodeenv) => __awaiter(void 0, void 0, void 0, function* () {
    const args = ['install', ...packages, '--strict-peer-deps', '--no-fund', '--no-audit'];
    if (save)
        args.push('--save-prod', '--save-exact');
    yield (0, exec_1.exec)('npm', args, { cwd: nodeenv });
});
const isInstalled = (pkg, nodeenv) => {
    return ((0, fs_1.existsSync)(path_1.default.join(nodeenv, 'node_modules', pkg)) &&
        (0, fs_1.statSync)(path_1.default.join(nodeenv, 'node_modules', pkg)).isDirectory());
};
const getPackageJson = (directory, pkg) => {
    const file = pkg
        ? path_1.default.join(directory, 'node_modules', pkg, 'package.json')
        : path_1.default.join(directory, 'package.json');
    return JSON.parse((0, fs_1.readFileSync)(file, 'utf-8'));
};
const getPeerDependencies = (pkg, nodeenv) => {
    if (!isInstalled(pkg, nodeenv)) {
        (0, core_1.info)(`Skipping peer-dependencies of ${pkg}, as it is not installed.`);
        return {};
    }
    return Object.keys(getPackageJson(nodeenv, pkg).peerDependencies || {}).reduce((peerDependencies, peerDependency) => {
        if (!isInstalled(peerDependency, nodeenv)) {
            (0, core_1.info)(`Skipping peer-dependency ${peerDependency} of ${pkg}, as it is not installed.`);
            return peerDependencies;
        }
        return Object.assign(Object.assign(Object.assign({}, peerDependencies), { [peerDependency]: getPackageJson(nodeenv, peerDependency).version }), getPeerDependencies(peerDependency, nodeenv));
    }, {});
};
const getAdditionalDependencies = (peerDependencies, environment) => {
    return Object.entries(peerDependencies).reduce((additionalDependencies, [peerDependency, version]) => (Object.assign(Object.assign(Object.assign({}, additionalDependencies), { [peerDependency]: version }), getPeerDependencies(peerDependency, environment))), {});
};
const getVersionChanges = (oldDependencies, newDependencies) => {
    return Object.entries(oldDependencies)
        .filter(([name, oldVersion]) => oldVersion !== newDependencies[name])
        .map(([name, oldVersion]) => ({
        name,
        oldVersion,
        newVersion: newDependencies[name],
    }));
};
const createPackageJson = (peerDependencies) => {
    (0, core_1.info)(prettyJson(peerDependencies));
    const file = 'package.json';
    const packageJson = JSON.parse((0, fs_1.readFileSync)(file, 'utf-8'));
    packageJson.peerDependencies = peerDependencies;
    (0, fs_1.writeFileSync)(file, `${prettyJson(packageJson)}\n`);
};
const createHookFile = (peerDependencies, environment) => {
    const additionalDependencies = Object.entries(getAdditionalDependencies(peerDependencies, environment))
        .sort()
        .map(([name, version]) => `${name}@${version}`);
    (0, core_1.info)(prettyJson(additionalDependencies));
    const file = '.pre-commit-hooks.yaml';
    const hooks = js_yaml_1.default.load((0, fs_1.readFileSync)(file, 'utf-8'));
    hooks[0].additional_dependencies = additionalDependencies;
    (0, fs_1.writeFileSync)(file, js_yaml_1.default.dump(hooks, { lineWidth: 100 }));
};
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        (0, core_1.startGroup)('get setting');
        const noCommit = process_1.argv.includes('--no-commit');
        const npmToken = (0, core_1.getInput)('npm-token', { required: !noCommit });
        (0, core_1.info)(prettyJson({ npmToken: '***', noCommit }));
        (0, core_1.endGroup)();
        (0, core_1.startGroup)('create temporary environment for package installation');
        const nodeenv = yield (0, promises_1.mkdtemp)(path_1.default.join((0, os_1.tmpdir)(), 'autoupdate-'));
        (0, core_1.info)(nodeenv);
        (0, core_1.endGroup)();
        (0, core_1.startGroup)('get current peer dependencies from package.json');
        const oldPeerDependencies = getPackageJson((0, process_1.cwd)()).peerDependencies || {};
        (0, core_1.info)(prettyJson(oldPeerDependencies));
        (0, core_1.endGroup)();
        (0, core_1.startGroup)('install latest version of peer dependencies listed in package.json');
        yield installPackages(Object.keys(oldPeerDependencies), true, nodeenv);
        const newPeerDependencies = getPackageJson(nodeenv).dependencies || {};
        (0, core_1.info)(prettyJson(newPeerDependencies));
        (0, core_1.endGroup)();
        (0, core_1.startGroup)('get version changes');
        const versionChanges = getVersionChanges(oldPeerDependencies, newPeerDependencies);
        (0, core_1.info)(versionChanges
            .map(({ name, oldVersion, newVersion }) => `${name}: ${oldVersion} → ${newVersion}`)
            .join('\n'));
        (0, core_1.endGroup)();
        (0, core_1.startGroup)('update package.json');
        createPackageJson(newPeerDependencies);
        (0, core_1.endGroup)();
        (0, core_1.startGroup)('update hook');
        createHookFile(newPeerDependencies, nodeenv);
        (0, core_1.endGroup)();
        (0, core_1.startGroup)('check for file changes');
        const fileChanges = Boolean(yield (0, simple_git_1.default)().diff(['.pre-commit-hooks.yaml', 'package.json']));
        (0, core_1.info)(fileChanges.toString());
        (0, core_1.endGroup)();
        if (!fileChanges) {
            (0, core_1.info)('Everything up to date.');
            return;
        }
        if (noCommit) {
            (0, core_1.info)('Updated files.');
            return;
        }
        (0, core_1.startGroup)('get current package version');
        const oldVersion = getPackageJson((0, process_1.cwd)()).version;
        (0, core_1.info)(oldVersion);
        (0, core_1.endGroup)();
        (0, core_1.startGroup)('bump version');
        yield (0, exec_1.exec)('npm', [
            'version',
            versionChanges.length ? 'minor' : 'patch',
            '--no-git-tag-version',
        ]);
        const newVersion = getPackageJson((0, process_1.cwd)()).version;
        (0, core_1.info)(newVersion);
        (0, core_1.endGroup)();
        (0, core_1.info)('commit and push changes');
        yield (0, simple_git_1.default)()
            .addConfig('user.name', 'GitHub Actions')
            .addConfig('user.email', 'actions@github.com')
            .add(['.pre-commit-hooks.yaml', 'package.json'])
            .commit('autoupdate')
            .addAnnotatedTag(`v${newVersion}`, `Version ${newVersion}`)
            .push()
            .pushTags();
        (0, core_1.startGroup)('publish to npm');
        yield (0, npm_publish_1.npmPublish)({ token: npmToken });
        (0, core_1.endGroup)();
        (0, core_1.info)(`Bumped package version (${oldVersion} → ${newVersion}):`);
    });
}
main().catch((error) => (0, core_1.setFailed)(error.message));
