import { GitRemote } from './models/remote';
import { exec, allMatches } from '../utils';
import { fill } from 'git-credential-node';

export async function getGitHubRemotes(rootPath: string) {
    const { stdout } = await exec('git remote -v', { cwd: rootPath });
    const remotes: GitRemote[] = [];
    for (const url of new Set(allMatches(/^[^\s]+\s+([^\s]+)/gm, stdout, 1))) {
        const m = /([^\s]*github\.com\/([^/]+)\/([^ \.]+)[^\s]*)/.exec(url);
        if (m) {
            const url = m[1];
            const data = await fill(url);
            if (data) {
                remotes.push({ url, owner: m[2], repo: m[3], username: data.username });
            }
        }
    }
    return remotes;
}