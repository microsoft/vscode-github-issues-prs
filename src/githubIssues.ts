import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';

import { Event, EventEmitter, TreeDataProvider, TreeItem, ExtensionContext, Uri, TreeItemCollapsibleState, workspace, commands } from 'vscode';

import * as GitHub from 'github';
import { copy } from 'copy-paste';
import { fill } from 'git-credential-node';

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
	private children: Promise<TreeItem[]>;

	constructor(private context: ExtensionContext) {
		context.subscriptions.push(commands.registerCommand('githubIssues.refresh', this.refresh, this));
		context.subscriptions.push(commands.registerCommand('githubIssues.openIssue', this.openIssue, this));
		context.subscriptions.push(commands.registerCommand('githubIssues.copyNumber', this.copyNumber, this));
		context.subscriptions.push(commands.registerCommand('githubIssues.copyText', this.copyText, this));
		context.subscriptions.push(commands.registerCommand('githubIssues.copyMarkdown', this.copyMarkdown, this));
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
		const res = await this.github.issues.getMilestones({ owner, repo, per_page: 2 })
		return res.data.map(milestone => milestone.title);
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

interface ExecResult {
	error: Error;
	stdout: string;
	stderr: string;
}

function exec(command: string, options?: cp.ExecOptions) {
	return new Promise<ExecResult>((resolve, reject) => {
		cp.exec(command, options, (error, stdout, stderr) => {
			(error || stderr ? reject : resolve)({ error, stdout, stderr });
		});
	});
}

function allMatches(regex: RegExp, string: string, group: number) {
	return {
		[Symbol.iterator]: function* () {
			let m: RegExpExecArray;
			while (m = regex.exec(string)) {
				yield m[group];
				if (regex.lastIndex === m.index) {
					regex.lastIndex++;
				}
			}
		}
	}
}
