import * as path from 'path';

import * as GitHub from '@octokit/rest';
import { fill } from 'git-credential-node';
import * as moment from 'moment';

import { EventEmitter, TreeDataProvider, TreeItem, ExtensionContext, QuickPickItem, Uri, TreeItemCollapsibleState, WorkspaceFolder, window, workspace, commands, env } from 'vscode';

import { exec, allMatches, fetchAll } from './utils';

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

	constructor(label: string, public item: any | undefined) {
		super(label, TreeItemCollapsibleState.Collapsed);
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
	private lastFetch: number | undefined;
	private children: Promise<TreeItem[]> | undefined;

	private username: string | undefined;
	private host: string;
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
		this.host = config.get<string>('host') || 'github.com';
		subscriptions.push(workspace.onDidChangeConfiguration(() => {
			const config = workspace.getConfiguration('github');
			const newUsername = config.get<string>('username');
			const newRepositories = config.get<string[]>('repositories') || [];
			const newHost = config.get<string>('host');
			if (newUsername !== this.username || JSON.stringify(newRepositories) !== JSON.stringify(this.repositories) || newHost !== this.host) {
				this.username = newUsername;
				this.repositories = newRepositories;
				this.host = newHost || 'github.com';
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

			const github = new GitHub(this.getAPIOption());

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
			await env.openExternal(Uri.parse(data.data.html_url + '/issues/new'));

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

		const { username, password } = remotes[0];
		const assignee = this.username || username || undefined;
		if (!assignee) {
			const configure = new TreeItem('Configure "github.username" in settings');
			configure.command = {
				title: 'Open Settings',
				command: 'workbench.action.openGlobalSettings'
			};
			return [configure];
		}

		let issues: Issue[];
		try {
			issues = await this.fetchAllIssues(remotes, assignee, username || undefined, password || undefined);
		} catch (err) {
			if (err.code === 401 && password) {
				issues = await this.fetchAllIssues(remotes, assignee, username || undefined, undefined);
			} else {
				throw err;
			}
		}

		if (!issues.length) {
			return [new TreeItem(`No issues found for @${assignee}`)];
		}

		const milestoneIndex: { [title: string]: Milestone; } = {};
		const milestones: Milestone[] = [];
		for (const issue of issues) {
			const m = issue.item.milestone;
			const milestoneLabel = m && m.title || 'No Milestone';
			let milestone = milestoneIndex[milestoneLabel];
			if (!milestone) {
				milestone = new Milestone(milestoneLabel, m);
				milestoneIndex[milestoneLabel] = milestone;
				milestones.push(milestone);
			} else if (m && m.due_on && !(milestone.item && milestone.item.due_on)) {
				milestone.item = m;
			}
			milestone.issues.push(issue);
		}

		for (const milestone of milestones) {
			milestone.label = `${milestone.label} (${milestone.issues.length})`;
		}

		milestones.sort((a, b) => {
			// No Milestone
			if (!a.item) {
				return 1;
			} else if (!b.item) {
				return -1;
			}

			const t1 = this.parseDueOn(a);
			const t2 = this.parseDueOn(b);
			if (t1 && t2) {
				if (!t1.isSame(t2)) {
					return t1.isBefore(t2) ? -1 : 1;
				}
			} else if (t1) {
				return -1;
			} else if (t2) {
				return 1;
			}

			return a.item.title.localeCompare(b.item.title);
		});

		if (milestones.length) {
			milestones[0].collapsibleState = TreeItemCollapsibleState.Expanded;
		}

		return milestones;
	}

	private parseDueOn(m: Milestone) {
		if (!m.item) {
			return;
		}

		if (m.item.due_on) {
			const t = moment.utc(m.item.due_on, 'YYYY-MM-DDTHH:mm:ssZ');
			if (t.isValid()) {
				return t;
			}
		}

		if (m.item.title) {
			const t = moment.utc(m.item.title, 'MMMM YYYY');
			if (t.isValid()) {
				return t.add(14, 'days'); // "best guess"
			}
		}
	}

	private async fetchAllIssues(remotes: GitRemote[], assignee: string, username?: string, password?: string) {
		const github = new GitHub(this.getAPIOption());
		if (username && password) {
			github.authenticate({
				type: 'basic',
				username,
				password
			});
		}

		const params = {
			q: `is:open assignee:${assignee}`,
			sort: 'created',
			order: 'asc',
			per_page: 100
		};
		const items = await fetchAll(github, github.search.issues(<any>params));

		return items
			.map((item: any) => ({
				item,
				remote: remotes.find(remote => item.repository_url.toLowerCase().endsWith(`/${remote.owner.toLowerCase()}/${remote.repo.toLowerCase()}`))
			}))
			.filter(({ remote }) => !!remote)
			.map(({ item, remote }) => {
				const issue = new Issue(`${item.title} (#${item.number})`, { remote: remote!, assignee }, item);
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
			});
	}

	private async openMilestone(milestone: Milestone) {
		const issue = milestone.issues[0];
		const item = issue.item;
		const assignee = issue.query.assignee;
		const url = `https://github.com/issues?utf8=%E2%9C%93&q=is%3Aopen+${item.milestone ? `milestone%3A%22${item.milestone.title}%22` : 'no%3Amilestone'}${assignee ? '+assignee%3A' + assignee : ''}`;
		return env.openExternal(Uri.parse(url));
	}

	private async openIssue(issue: Issue) {
		return env.openExternal(Uri.parse(issue.item.html_url));
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

		const github = new GitHub(this.getAPIOption());
		const p = Uri.parse(issue.item.repository_url).path;
		const repo = path.basename(p);
		const owner = path.basename(path.dirname(p));
		const pr = await github.pullRequests.get({ owner, repo, number: issue.item.number });
		const repo_login = pr.data.head!.repo.owner.login;
		const user_login = pr.data.user!.login;
		const clone_url = pr.data.head!.repo.clone_url;
		const remoteBranch = pr.data.head!.ref;
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

	private async copyNumber(issue: Issue) {
		return env.clipboard.writeText(`#${issue.item.number}`);
	}

	private async copyText(issue: Issue) {
		return env.clipboard.writeText(issue.label!);
	}

	private async copyMarkdown(issue: Issue) {
		return env.clipboard.writeText(`[#${issue.item.number}](${issue.item.html_url})`);
	}

	private async copyUrl(issue: Issue) {
		return env.clipboard.writeText(issue.item.html_url);
	}

	private async getGitHubRemotes() {
		const remotes: Record<string, GitRemote> = {};
		for (const folder of workspace.workspaceFolders || []) {
			try {
				const { stdout } = await exec('git remote -v', { cwd: folder.uri.fsPath });
				for (const url of new Set(allMatches(/^[^\s]+\s+([^\s]+)/gm, stdout, 1))) {
					const m = new RegExp(`[^\\s]*${this.host.replace(/\./g, '\\.')}[/:]([^/]+)\/([^ ]+)[^\\s]*`).exec(url);

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
					const url = `https://${this.host}/${owner}/${repo}.git`;
					const data = await fill(url);
					remote = { url, owner, repo, username: data && data.username, password: data && data.password, folders: [] };
					remotes[`${owner}/${repo}`] = remote;
				}
			}
		}
		return Object.keys(remotes)
			.map(key => remotes[key]);
	}

	private getAPIOption() {
		if (this.host === 'github.com') {
			return { host: 'api.github.com' };
		} else {
			return { host: this.host, pathPrefix: '/api/v3' };
		}
	}
}
