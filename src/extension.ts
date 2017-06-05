'use strict';

import { ExtensionContext, window } from 'vscode';

import { GitHubIssuesProvider } from './githubIssues'

export function activate(context: ExtensionContext) {
	window.registerTreeDataProvider('githubIssues', new GitHubIssuesProvider(context));
}
