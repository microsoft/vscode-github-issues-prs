import * as fs from 'fs';
import * as path from 'path';

import * as GitHub from 'github';
import { copy } from 'copy-paste';
import { fill } from 'git-credential-node';

import { Event, EventEmitter, TreeDataProvider, TreeItem, ExtensionContext, Uri, TreeItemCollapsibleState, window, workspace, commands } from 'vscode';

import { exec, allMatches, compareDateStrings } from './utils';

interface GitRemote {
	url: string;
	owner: string;
	repo: string;
	username: string;
}

class Milestone extends TreeItem {

	public issues: Issue[] = [];

	constructor(label: string) {
		super(label, TreeItemCollapsibleState.Expanded);
	}
}

class Issue extends TreeItem {
	constructor(label: string, public item: any) {
		super(label);
	}
}

export class GitHubIssuesProvider implements TreeDataProvider<TreeItem> {

	private _onDidChangeTreeData = new EventEmitter<TreeItem | undefined>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private github = new GitHub();

	private fetching = false;
	private lastFetch: number;
	private children: Promise<TreeItem[]>;

	constructor(private context: ExtensionContext) {
		context.subscriptions.push(commands.registerCommand('githubIssues.refresh', this.refresh, this));
		context.subscriptions.push(commands.registerCommand('githubIssues.openIssue', this.openIssue, this));
		context.subscriptions.push(commands.registerCommand('githubIssues.copyNumber', this.copyNumber, this));
		context.subscriptions.push(commands.registerCommand('githubIssues.copyText', this.copyText, this));
		context.subscriptions.push(commands.registerCommand('githubIssues.copyMarkdown', this.copyMarkdown, this));

		context.subscriptions.push(window.onDidChangeActiveTextEditor(this.poll, this));
	}

	getTreeItem(element: TreeItem): TreeItem {
		return element;
	}

	async getChildren(element?: TreeItem): Promise<TreeItem[]> {
		if (element instanceof Milestone) {
			return element.issues;
		}

		if (!this.children) {
			this.fetching = true;
			this.lastFetch = Date.now();
			this.children = this.fetchChildren();
			this.children.then(() => this.fetching = false);
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

	private async poll() {
		if (!this.lastFetch || this.lastFetch + 30 * 60 * 1000 < Date.now()) {
			return this.refresh();
		}
	}

	private async fetchChildren(element?: TreeItem): Promise<TreeItem[]> {
		if (!workspace.rootPath) {
			return [new TreeItem('No folder opened')];
		}

		let remotes: GitRemote[];
		try {
			remotes = await this.getGitHubRemotes();
		} catch (err) {
			return [new TreeItem('Not a GitHub repository')];
		}
		if (!remotes.length) {
			return [new TreeItem('No GitHub remotes found')];
		}

		const issues: Issue[] = [];
		for (const remote of remotes) {
			const milestones = await this.getCurrentMilestones(remote);
			if (!milestones.length) {
				milestones.push(undefined);
			}

			for (const milestone of milestones) {
				let q = `repo:${remote.owner}/${remote.repo} is:open is:issue`;
				if (remote.username) {
					q += ` assignee:${remote.username}`;
				}
				if (milestone) {
					q += ` milestone:"${milestone}"`;
				}

				const params = { q, sort: 'created', order: 'asc', per_page: 100 };
				const res = await this.github.search.issues(<any>params);
				issues.push(...res.data.items.map(item => {
					const issue = new Issue(`${item.title} (#${item.number})`, item);
					issue.iconPath = {
						light: this.context.asAbsolutePath(path.join('thirdparty', 'octicons', 'light', 'bug.svg')),
						dark: this.context.asAbsolutePath(path.join('thirdparty', 'octicons', 'dark', 'bug.svg'))
					};
					issue.contextValue = 'issue';
					return issue;
				}));
			}
		}
		if (!issues.length) {
			return [new TreeItem('No issues found')];
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

	private openIssue(issue: Issue) {
		commands.executeCommand('vscode.open', Uri.parse(issue.item.html_url));
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

	private async getCurrentMilestones({ owner, repo }: GitRemote): Promise<string[]> {
		const res = await this.github.issues.getMilestones({ owner, repo, per_page: 10 })
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
		const { stdout } = await exec('git remote -v', { cwd: workspace.rootPath });
		const remotes: GitRemote[] = [];
		for (const url of new Set(allMatches(/^[^\s]+\s+([^\s]+)/gm, stdout, 1))) {
			const m = /([^\s]*github\.com\/([^/]+)\/([^ \.]+)[^\s]*)/.exec(url);
			if (m) {
				const url = m[1];
				const data = await fill(url);
				remotes.push({ url, owner: m[2], repo: m[3], username: data && data.username });
			}
		}
		return remotes;
	}
}
