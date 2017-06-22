import * as vscode from 'vscode';
import * as path from 'path';
import * as request from 'request';
import * as GitHub from 'github';
import { parseDiff } from './git/diff';
import { getGitHubRemotes } from './git/remote';
import { writeTmpFile } from './git/file';
import { GitChangeType, SlimFileChange } from './git/models/file';
import { GitRemote } from './git/models/remote';

export class PullRequest {
    constructor(public title: string, public url: string) { };
}

export class PullRequestProvider implements vscode.TreeDataProvider<PullRequest | SlimFileChange> {
    private context: vscode.ExtensionContext;
    private workspaceRoot: string;
    private icons: any;
    private github = new GitHub();

    constructor() {
    }

    activate(context: vscode.ExtensionContext) {
        this.context = context;
        this.workspaceRoot = vscode.workspace.rootPath;
        vscode.window.registerTreeDataProvider<PullRequest | SlimFileChange>('pullRequest', this);
        this.icons = {
            light: {
                Modified: context.asAbsolutePath(path.join('resources', 'light', 'status-modified.svg')),
                Added: context.asAbsolutePath(path.join('resources', 'light', 'status-added.svg')),
                Deleted: context.asAbsolutePath(path.join('resources', 'light', 'status-deleted.svg')),
                Renamed: context.asAbsolutePath(path.join('resources', 'light', 'status-renamed.svg')),
                Copied: context.asAbsolutePath(path.join('resources', 'light', 'status-copied.svg')),
                Untracked: context.asAbsolutePath(path.join('resources', 'light', 'status-untrackedt.svg')),
                Ignored: context.asAbsolutePath(path.join('resources', 'light', 'status-ignored.svg')),
                Conflict: context.asAbsolutePath(path.join('resources', 'light', 'status-conflict.svg')),
            },
            dark: {
                Modified: context.asAbsolutePath(path.join('resources', 'dark', 'status-modified.svg')),
                Added: context.asAbsolutePath(path.join('resources', 'dark', 'status-added.svg')),
                Deleted: context.asAbsolutePath(path.join('resources', 'dark', 'status-deleted.svg')),
                Renamed: context.asAbsolutePath(path.join('resources', 'dark', 'status-renamed.svg')),
                Copied: context.asAbsolutePath(path.join('resources', 'dark', 'status-copied.svg')),
                Untracked: context.asAbsolutePath(path.join('resources', 'dark', 'status-untracked.svg')),
                Ignored: context.asAbsolutePath(path.join('resources', 'dark', 'status-ignored.svg')),
                Conflict: context.asAbsolutePath(path.join('resources', 'dark', 'status-conflict.svg'))
            }
        };

        vscode.commands.registerCommand('pullRequest.diff', async (element: SlimFileChange) => {
            if (element.status === GitChangeType.MODIFY) {
                let left = await writeTmpFile(element.originalContent, path.extname(element.originalFileName));
                let right = await writeTmpFile(element.content, path.extname(element.fileName));

                vscode.commands.executeCommand('vscode.diff', 
                    vscode.Uri.file(path.resolve(this.workspaceRoot, left)),
                    vscode.Uri.file(path.resolve(this.workspaceRoot, right)),
                    `${element.fileName}`);
            } else if (element.status === GitChangeType.DELETE) {
                let left = await writeTmpFile(element.originalContent, path.extname(element.originalFileName));
                vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.resolve(this.workspaceRoot, left)));
            } else {
                let right = await writeTmpFile(element.content, path.extname(element.fileName));
                vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.resolve(this.workspaceRoot, right)));
            }
        });
    }

    getTreeItem(element: PullRequest | SlimFileChange): vscode.TreeItem {
        if (element instanceof PullRequest) {
            return {
                label: element.title,
                collapsibleState: 1
            };
        } else {
            let iconUri: string;
            let iconDarkUri: string;
            let newElement: vscode.TreeItem = {
                label: element.status === GitChangeType.RENAME ? `${element.originalFileName} -> ${element.fileName}` : element.fileName,
                command: {
                    title: 'show pull request diff',
                    command: 'pullRequest.diff',
                    arguments: [
                        element
                    ]
                },
                iconPath: {
                    light: iconUri,
                    dark: iconDarkUri
                }
            };

            switch (element.status) {
                case GitChangeType.ADD:
                    iconUri = this.icons.light.Added;
                    iconDarkUri = this.icons.dark.Added;
                    break;
                case GitChangeType.COPY:
                    iconUri = this.icons.light.Copied;
                    iconDarkUri = this.icons.dark.Copied;
                    break;
                case GitChangeType.DELETE:
                    iconUri = this.icons.light.Deleted;
                    iconDarkUri = this.icons.dark.Deleted;
                    break;
                case GitChangeType.MODIFY:
                    iconUri = this.icons.light.Modified;
                    iconDarkUri = this.icons.dark.Modified;
                    break;
                case GitChangeType.RENAME:
                    iconUri = this.icons.light.Renamed;
                    iconDarkUri = this.icons.dark.Renamed;
                    break;
            }
            newElement.iconPath = {
                light: iconUri,
                dark: iconDarkUri
            };

            return newElement;
        }
    }

    getChildren(element?: PullRequest): PullRequest[] | Thenable<PullRequest[]> | SlimFileChange[] | Thenable<SlimFileChange[]> {
        if (element) {
            return new Promise<SlimFileChange[]>((resolve, reject) => {
                request({
                    followAllRedirects: true,
                    url: element.url
                }, async (error, response, body) => {
                    let slimContentChanges = await parseDiff(body);
                    resolve(slimContentChanges);
                });
            });
        } else {
            return new Promise<PullRequest[]>(async (resolve, reject) => {
                let remotes: GitRemote[];
                try {
                    remotes = await getGitHubRemotes(this.workspaceRoot);
                } catch (err) {
                    // return [new TreeItem('Not a GitHub repository')];
                }
                if (!remotes.length) {
                    // return [new TreeItem('No GitHub remotes found')];
                }

                const pullRequests: PullRequest[] = [];
                for (const remote of remotes) {
                    let q = `repo:${remote.owner}/${remote.repo} is:open is:pr`;
                    const params = { q, sort: 'created', order: 'asc', per_page: 100 };
                    const res = await this.github.search.issues(<any>params);
                    pullRequests.push(...res.data.items.map((item: any) => {
                        const pr = new PullRequest(item.title, item.html_url + '.diff');
                        return pr;
                    }));
                }
                resolve(pullRequests);
            });
        }
    }
}