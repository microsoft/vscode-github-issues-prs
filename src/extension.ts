'use strict';

import { ExtensionContext, window } from 'vscode';

import { GitHubIssuesPrsProvider } from './github-issues-prs';

export function activate(context: ExtensionContext) {
	window.registerTreeDataProvider('githubIssuesPrs', new GitHubIssuesPrsProvider(context));
}
