'use strict';

import { ExtensionContext, window } from 'vscode';

import { GitHubIssuesPrsProvider } from './github-issues-prs'
import { PullRequestProvider } from './pullRequestProvider';

export function activate(context: ExtensionContext) {
	window.registerTreeDataProvider('githubIssuesPrs', new GitHubIssuesPrsProvider(context));
	new PullRequestProvider().activate(context);
}
