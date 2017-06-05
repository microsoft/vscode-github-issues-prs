import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';

import { TreeDataProvider, TreeItem, ExtensionContext, Uri, workspace, commands } from 'vscode';

import * as GitHub from 'github';
import { copy } from 'copy-paste';
import { fill } from 'git-credential-node';

export class GitHubIssuesProvider implements TreeDataProvider<Issue> {

	private github = new GitHub();

	constructor(private context: ExtensionContext) {
		context.subscriptions.push(commands.registerCommand('github.openIssue', this.openIssue, this));
		context.subscriptions.push(commands.registerCommand('github.copyNumber', this.copyNumber, this));
		context.subscriptions.push(commands.registerCommand('github.copyText', this.copyText, this));
		context.subscriptions.push(commands.registerCommand('github.copyMarkdown', this.copyMarkdown, this));
	}

	getTreeItem(element: Issue): TreeItem {
		return element;
	}

	async getChildren(element?: Issue): Promise<TreeItem[]> {
		let remotes: GitRemote[];
		try {
			remotes = await this.getGitHubRemotes();
		} catch (err) {
			return [new TreeItem('Not a GitHub repository.')];
		}
		if (!remotes.length) {
			return [new TreeItem('No GitHub remotes found.')];
		}

		const issues: Issue[] = [];
		for (const remote of remotes) {
			let q = `repo:${remote.owner}/${remote.repo} is:open is:issue`;
			if (remote.username) {
				q += ` assignee:${remote.username}`;
			}
			const milestone = await this.getCurrentMilestone(remote);
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
		if (!issues.length) {
			return [new TreeItem('No assigned issues found.')];
		}
		return issues;
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

	private async getCurrentMilestone({ owner, repo }: GitRemote) {
		const res = await this.github.issues.getMilestones({ owner, repo, per_page: 1 })
		const milestone = res.data[0]
		return milestone && milestone.title;
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

interface GitRemote {
	url: string;
	owner: string;
	repo: string;
	username: string;
}

class Issue extends TreeItem {
	constructor(label: string, public item: any) {
		super(label);
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
