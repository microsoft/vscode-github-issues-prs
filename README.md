# GitHub Issues

View the issues assigned to you in the Explorer viewlet. Currently the username and repository are taken from the Git configuration and only issues assigned to that user and to the next two milestones are shown.

![GitHub Issues in Action](images/in_action.gif)

## Release Notes

### 0.9.3

- Ignore folder casing for owner and repo (#44).
- Update username and host settings to application scope.
- Update to use @types/vscode.

### 0.9.2

- Update https-proxy-agent (https://www.npmjs.com/advisories/1184).

### 0.9.1

- Avoid naming overlap with PR extension.

### 0.9.0

- Support for GitHub Enterprise with the `"github.host"` setting (@Ikuyadeu)

### 0.8.0

- Show all milestones and improve sorting
- Open single page for Open Milestone

### 0.7.0

- Checkout Pull Request: Improve finding existing remote and branch
- 'Multi-root ready' keyword

### 0.6.0

- Add Copy Url command (@Ikuyadeu)
- Fix tslint semicolon setting (@Ikuyadeu)
- Add Open Milestone command
- Add Checkout Pull Request command

### 0.5.0

- Add multiple workspace folder support
- Add setting for additional GitHub repositories

### 0.4.0

- Add action for creating issues (@jens1o)
- Fix parsing of repository names with dots (@wraith13)

### 0.3.x

- Bugfixes

### 0.2.0

- Support for private repositories (using Git credentials manager).
- Add `github.username` setting.

### 0.1.0

Initial release.

## Contributing

File bugs and feature requests in [GitHub Issues](https://github.com/Microsoft/vscode-github-issues-prs/issues).

Checkout the source code in the [GitHub Repository](https://github.com/Microsoft/vscode-github-issues-prs).

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## License
[MIT](LICENSE)
