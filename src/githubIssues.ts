import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

import { TreeDataProvider, TreeItem, ExtensionContext, Uri, workspace, commands } from 'vscode';

import * as GitHub from 'github';
import { copy } from 'copy-paste';

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

	async getChildren(element?: Issue): Promise<Issue[]> {
		const section = workspace.getConfiguration('github');

		let owner = section && section.get<string>('owner');
		let repo = section && section.get<string>('repository');
		if (!owner || !repo) {
			const ownerAndRepo = await this.getOwnerAndRepo();
			owner = owner || ownerAndRepo.owner;
			repo = repo || ownerAndRepo.repo;
		}

		let q = `repo:${owner}/${repo} is:open is:issue`;

		const user = section && section.get<string>('username');
		if (user) {
			q += ` assignee:${user}`;
		}
		const milestone = section && section.get<string>('currentMilestone') || await this.getCurrentMilestone(owner, repo);
		if (milestone) {
			q += ` milestone:"${milestone}"`;
		}

		const params = { q, sort: 'created', order: 'asc', per_page: 100 };
		const res = await this.github.search.issues(<any>params);
		return res.data.items.map(item => {
			const issue = new Issue(`${item.title} (#${item.number})`, item);
			issue.iconPath = {
				light: this.context.asAbsolutePath(path.join('thirdparty', 'octicons', 'light', 'bug.svg')),
				dark: this.context.asAbsolutePath(path.join('thirdparty', 'octicons', 'dark', 'bug.svg'))
			};
			issue.contextValue = 'issue';
			return issue;
		});
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

	private async getCurrentMilestone(owner: string, repo: string) {
		const res = await this.github.issues.getMilestones({ owner, repo, per_page: 1 })
		const milestone = res.data[0]
		return milestone && milestone.title;
	}

	private getOwnerAndRepo() {
		return new Promise<{ owner: string; repo: string; }>((resolve, reject) => {
			exec('git remote -v', { cwd: workspace.rootPath }, (err, stdout, stderr) => {
				if (err || stderr) {
					reject(err || stderr);
				} else {
					const m = /github\.com\/([^/]+)\/([^ \.]+)/.exec(stdout);
					if (!m) {
						reject('Not a GitHub repository.');
					} else {
						resolve({ owner: m[1], repo: m[2] });
					}
				}
			});
		});
	}
}

class Issue extends TreeItem {
	constructor(label: string, public item: any) {
		super(label);
	}
}
