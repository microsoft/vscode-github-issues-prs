import * as path from 'path';

import * as GitHub from 'github';
import open = require('open');
import { copy } from 'copy-paste';
import { fill } from 'git-credential-node';

import { EventEmitter, TreeDataProvider, TreeItem, ExtensionContext, QuickPickItem, Uri, TreeItemCollapsibleState, WorkspaceFolder, window, workspace, commands } from 'vscode';

import { exec, allMatches, compareDateStrings } from './utils';

interface GitRemote {
	url: string;
	owner: string;
	repo: string;
	username: string | null;
	password: string | null;
	folders: WorkspaceFolder[];
}

class Milestone extends TreeItem {

	public issues: Issue[] = [];

	constructor(label: string) {
		super(label, TreeItemCollapsibleState.Expanded);
		this.contextValue = 'milestone';
	}
}

class Issue extends TreeItem {
	constructor(label: string, public query: { remote: GitRemote; assignee: string | undefined; }, public item: any) {
		super(label);
	}
}

interface RemoteQuickPickItem extends QuickPickItem {
	remote: GitRemote;
}

export class GitHubIssuesPrsProvider implements TreeDataProvider<TreeItem> {

	private _onDidChangeTreeData = new EventEmitter<TreeItem | undefined>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private fetching = false;
	private lastFetch: number;
	private children: Promise<TreeItem[]> | undefined;

	private username: string | undefined;
	private repositories: string[];

	constructor(private context: ExtensionContext) {
		const subscriptions = context.subscriptions;
		subscriptions.push(commands.registerCommand('githubIssuesPrs.refresh', this.refresh, this));
		subscriptions.push(commands.registerCommand('githubIssuesPrs.createIssue', this.createIssue, this));
		subscriptions.push(commands.registerCommand('githubIssuesPrs.openMilestone', this.openMilestone, this));
		subscriptions.push(commands.registerCommand('githubIssuesPrs.openIssue', this.openIssue, this));
		subscriptions.push(commands.registerCommand('githubIssuesPrs.openPullRequest', this.openIssue, this));
		subscriptions.push(commands.registerCommand('githubIssuesPrs.checkoutPullRequest', this.checkoutPullRequest, this));
		subscriptions.push(commands.registerCommand('githubIssuesPrs.copyNumber', this.copyNumber, this));
		subscriptions.push(commands.registerCommand('githubIssuesPrs.copyText', this.copyText, this));
		subscriptions.push(commands.registerCommand('githubIssuesPrs.copyMarkdown', this.copyMarkdown, this));
		subscriptions.push(commands.registerCommand('githubIssuesPrs.copyUrl', this.copyUrl, this));

		subscriptions.push(window.onDidChangeActiveTextEditor(this.poll, this));

		const config = workspace.getConfiguration('github');
		this.username = config.get<string>('username');
		this.repositories = config.get<string[]>('repositories') || [];
		subscriptions.push(workspace.onDidChangeConfiguration(() => {
			const config = workspace.getConfiguration('github');
			const newUsername = config.get<string>('username');
			const newRepositories = config.get<string[]>('repositories') || [];
			if (newUsername !== this.username || JSON.stringify(newRepositories) !== JSON.stringify(this.repositories)) {
				this.username = newUsername;
				this.repositories = newRepositories;
				this.refresh();
			}
		}));

		subscriptions.push(workspace.onDidChangeWorkspaceFolders(this.refresh, this));
	}

	getTreeItem(element: TreeItem): TreeItem {
		return element;
	}

	async getChildren(element?: TreeItem): Promise<TreeItem[]> {
		if (element instanceof Milestone) {
			return element.issues;
		}

		if (!this.children) {
			try {
				this.fetching = true;
				this.lastFetch = Date.now();
				await (this.children = this.fetchChildren());
			} finally {
				this.fetching = false;
			}
		}

		return this.children;
	}

	private async refresh() {
		if (!this.fetching) {
			this.children = undefined;
			await this.getChildren();
			this._onDidChangeTreeData.fire();
		}
	}

	private async createIssue() {

		const remotes = await this.getGitHubRemotes();
		if (!remotes.length) {
			return false;
		}

		let urls: RemoteQuickPickItem[] = remotes.map(remote => {
			let remoteItem: RemoteQuickPickItem = {
				label: remote.owner + '/' + remote.repo,
				description: '',
				remote: remote
			};

			return remoteItem;
		});

		if (!urls.length) {
			window.showInformationMessage('There is no remote to get data from!');
			return;
		}

		const callback = async (selectedRemote: RemoteQuickPickItem | undefined) => {
			if (!selectedRemote) {
				return;
			}

			const github = new GitHub();

			if (selectedRemote.remote.username && selectedRemote.remote.password) {
				github.authenticate({
					type: 'basic',
					username: selectedRemote.remote.username,
					password: selectedRemote.remote.password
				});
			}

			const data = await github.repos.get({
				owner: selectedRemote.remote.owner,
				repo: selectedRemote.remote.repo
			});
			// TODO: Store in cache
			open(data.data.html_url + '/issues/new');

		};

		// shortcut when there is just one remote
		if (urls.length === 1) {
			callback(urls[0]);
			return;
		}

		const pick = await window.showQuickPick(
			urls,
			{
				placeHolder: 'Select the remote you want to create an issue on'
			}
		);
		callback(pick);
	}

	private async poll() {
		if (!this.lastFetch || this.lastFetch + 30 * 60 * 1000 < Date.now()) {
			return this.refresh();
		}
	}

	private async fetchChildren(element?: TreeItem): Promise<TreeItem[]> {
		const remotes = await this.getGitHubRemotes();
		if (!remotes.length) {
			return [new TreeItem('No GitHub repositories found')];
		}

		let assignee: string | undefined;
		const issues: Issue[] = [];
		const errors: TreeItem[] = [];
		for (const remote of remotes) {
			try {
				const github = new GitHub();
				if (remote.username && remote.password) {
					github.authenticate({
						type: 'basic',
						username: remote.username,
						password: remote.password
					});
				}
				const milestones: (string | undefined)[] = await this.getCurrentMilestones(github, remote);
				if (!milestones.length) {
					milestones.push(undefined);
				}

				for (const milestone of milestones) {
					let q = `repo:${remote.owner}/${remote.repo} is:open`;
					let username = this.username || remote.username || undefined;
					if (username) {
						try {
							if (remote.username && remote.password) { // check requires push access
								await github.repos.checkCollaborator({ owner: remote.owner, repo: remote.repo, username });
							}
							assignee = username;
							q += ` assignee:${username}`;
						} catch (err) {
							// ignore (not a collaborator)
							username = undefined;
						}
					}
					if (milestone) {
						q += ` milestone:"${milestone}"`;
					}

					const params = { q, sort: 'created', order: 'asc', per_page: 100 };
					const res = await github.search.issues(<any>params);
					issues.push(...res.data.items.map((item: any) => {
						const issue = new Issue(`${item.title} (#${item.number})`, { remote, assignee: username }, item);
						const icon = item.pull_request ? 'git-pull-request.svg' : 'bug.svg';
						issue.iconPath = {
							light: this.context.asAbsolutePath(path.join('thirdparty', 'octicons', 'light', icon)),
							dark: this.context.asAbsolutePath(path.join('thirdparty', 'octicons', 'dark', icon))
						};
						issue.command = {
							title: 'Open',
							command: item.pull_request ? 'githubIssuesPrs.openPullRequest' : 'githubIssuesPrs.openIssue',
							arguments: [issue]
						};
						issue.contextValue = item.pull_request ? 'pull_request' : 'issue';
						return issue;
					}));
				}
			} catch (err) {
				if (err.code === 401 && remote.password) {
					remotes.push({ ...remote, password: null });
				} else if (err.code === 404) {
					errors.push(new TreeItem(`Cannot access ${remote.owner}/${remote.repo}`));
				} else {
					throw err;
				}
			}
		}
		if (!issues.length) {
			return errors.length ? errors : [new TreeItem(`No issues found for ${assignee ? '@' + assignee : 'any user'}`)];
		}

		const milestoneIndex: { [title: string]: Milestone; } = {};
		const milestones: Milestone[] = [];
		for (const issue of issues) {
			const m = issue.item.milestone;
			const milestoneLabel = m && m.title || 'No Milestone';
			let milestone = milestoneIndex[milestoneLabel];
			if (!milestone) {
				milestone = new Milestone(milestoneLabel);
				milestoneIndex[milestoneLabel] = milestone;
				milestones.push(milestone);
			}
			milestone.issues.push(issue);
		}

		if (milestones.length === 1 && milestones[0].label === 'No Milestone') {
			return milestones[0].issues;
		}

		return milestones;
	}

	private openMilestone(milestone: Milestone) {
		const seen: Record<string, boolean> = {};
		for (const issue of milestone.issues) {
			const item = issue.item;
			const assignee = issue.query.assignee;
			const url = `https://github.com/${issue.query.remote.owner}/${issue.query.remote.repo}/issues?q=is%3Aopen+milestone%3A%22${item.milestone.title}%22${assignee ? '+assignee%3A' + assignee : ''}`;
			if (!seen[url]) {
				seen[url] = true;
				commands.executeCommand('vscode.open', Uri.parse(url));
			}
		}
	}

	private openIssue(issue: Issue) {
		commands.executeCommand('vscode.open', Uri.parse(issue.item.html_url));
	}

	private async checkoutPullRequest(issue: Issue) {

		const remote = issue.query.remote;
		const folder = remote.folders[0];
		if (!folder) {
			return window.showInformationMessage(`The repository '${remote.owner}/${remote.repo}' is not checked out in any open workspace folder.`);
		}

		const status = await exec(`git status --short --porcelain`, { cwd: folder.uri.fsPath });
		if (status.stdout) {
			return window.showInformationMessage(`There are local changes in the workspace folder. Commit or stash them before checking out the pull request.`);
		}

		const github = new GitHub();
		const p = Uri.parse(issue.item.repository_url).path;
		const repo = path.basename(p);
		const owner = path.basename(path.dirname(p));
		const pr = await github.pullRequests.get({ owner, repo, number: issue.item.number });
		const repo_login = pr.data.head.repo.owner.login;
		const user_login = pr.data.user.login;
		const clone_url = pr.data.head.repo.clone_url;
		const remoteBranch = pr.data.head.ref;
		try {
			let remote: string | undefined = undefined;
			const remotes = await exec(`git remote -v`, { cwd: folder.uri.fsPath });
			let m: RegExpExecArray | null;
			const r = /^([^\s]+)\s+([^\s]+)\s+\(fetch\)/gm;
			while (m = r.exec(remotes.stdout)) {
				let fetch_url = m[2];
				if (!fetch_url.endsWith('.git')) {
					fetch_url += '.git';
				}
				if (fetch_url === clone_url) {
					remote = m[1];
					break;
				}
			}
			if (!remote) {
				remote = await window.showInputBox({
					prompt: 'Name for the remote to add',
					value: repo_login
				});
				if (!remote) {
					return;
				}
				await exec(`git remote add ${remote} ${clone_url}`, { cwd: folder.uri.fsPath });
			}
			try {
				await exec(`git fetch ${remote} ${remoteBranch}`, { cwd: folder.uri.fsPath });
			} catch (err) {
				console.error(err);
				// git fetch prints to stderr, continue
			}
			const localBranch = await window.showInputBox({
				prompt: 'Name for the local branch to checkout',
				value: remoteBranch.startsWith(`${user_login}/`) ? remoteBranch : `${user_login}/${remoteBranch}`
			});
			if (!localBranch) {
				return;
			}
			await exec(`git checkout -b ${localBranch} ${remote}/${remoteBranch}`, { cwd: folder.uri.fsPath });
		} catch (err) {
			console.error(err);
			// git checkout prints to stderr, continue
		}
	}

	private copyNumber(issue: Issue) {
		copy(`#${issue.item.number}`);
	}

	private copyText(issue: Issue) {
		copy(issue.label);
	}

	private copyMarkdown(issue: Issue) {
		copy(`[#${issue.item.number}](${issue.item.html_url})`);
	}

	private copyUrl(issue: Issue) {
		copy(issue.item.html_url);
	}


	private async getCurrentMilestones(github: GitHub, { owner, repo }: GitRemote): Promise<string[]> {
		const res = await github.issues.getMilestones({ owner, repo, per_page: 10 });
		let milestones: any[] = res.data;
		milestones.sort((a, b) => {
			const cmp = compareDateStrings(a.due_on, b.due_on);
			if (cmp) {
				return cmp;
			}
			return a.title.localeCompare(b.title);
		});
		if (milestones.length && milestones[0].due_on) {
			milestones = milestones.filter(milestone => milestone.due_on);
		}
		return milestones.slice(0, 2)
			.map(milestone => milestone.title);
	}

	private async getGitHubRemotes() {
		const remotes: Record<string, GitRemote> = {};
		for (const folder of workspace.workspaceFolders || []) {
			try {
				const { stdout } = await exec('git remote -v', { cwd: folder.uri.fsPath });
				for (const url of new Set(allMatches(/^[^\s]+\s+([^\s]+)/gm, stdout, 1))) {
					const m = /[^\s]*github\.com[/:]([^/]+)\/([^ ]+)[^\s]*/.exec(url);
					if (m) {
						const [url, owner, rawRepo] = m;
						const repo = rawRepo.replace(/\.git$/, '');
						let remote = remotes[`${owner}/${repo}`];
						if (!remote) {
							const data = await fill(url);
							remote = { url, owner, repo, username: data && data.username, password: data && data.password, folders: [] };
							remotes[`${owner}/${repo}`] = remote;
						}
						remote.folders.push(folder);
					}
				}
			} catch (e) {
				// ignore
			}
		}
		for (const rawRepo of this.repositories) {
			const m = /^\s*([^/\s]+)\/([^/\s]+)\s*$/.exec(rawRepo);
			if (m) {
				const [, owner, repo] = m;
				let remote = remotes[`${owner}/${repo}`];
				if (!remote) {
					const url = `https://github.com/${owner}/${repo}.git`;
					const data = await fill(url);
					remote = { url, owner, repo, username: data && data.username, password: data && data.password, folders: [] };
					remotes[`${owner}/${repo}`] = remote;
				}
			}
		}
		return Object.keys(remotes)
			.map(key => remotes[key]);
	}
}
