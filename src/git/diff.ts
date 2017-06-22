import { SlimFileChange, GitChangeType} from './models/file';

const MOIDFY_DIFF_INFO = /diff --git a\/(\S+) b\/(\S+).*\n*index.*\n*-{3}.*\n*\+{3}.*\n*((.*\n*)+)/;
const ADD_DIFF_INFO = /diff --git a\/(\S+) b\/(\S+).*\n*new file mode .*\nindex.*\n*-{3}.*\n*\+{3}.*\n*((.*\n*)+)/;
const DELETE_DIFF_INFO = /diff --git a\/(\S+) b\/(\S+).*\n*deleted file mode .*\nindex.*\n*-{3}.*\n*\+{3}.*\n*((.*\n*)+)/;
const HUNK_HEADER = /@@ \-(\d+)(,(\d+))?( \+(\d+)(,(\d+)?))? @@$/;
const HUNK_HEADER_INLINE = /@@ \-(\d+)(,(\d+))?( \+(\d+)(,(\d+)?))? @@ /;

export async function parseDiff(text: string) {
    let reg = /diff((?!diff).*\n*)*/g
    let match = reg.exec(text);
    let slimFileChanges: SlimFileChange[] = [];

    while(match) {
        let singleFileDiff = match[0];
        let modifyDiffInfo = MOIDFY_DIFF_INFO.exec(singleFileDiff);
        if (modifyDiffInfo) {
            let originalFileName = modifyDiffInfo[1];
            let fileName = modifyDiffInfo[2];
            let diffHunks = modifyDiffInfo[3].split('\n');
            let left = [];
            let right = [];
            for (let i = 0; i < diffHunks.length; i++) {
                let line = diffHunks[i];
                if (HUNK_HEADER.test(line)) {
                    left.push(line);
                    right.push(line);
                } else if (/^\-/.test(line)) {
                    left.push(line.substr(1));
                } else if (/^\+/.test(line)) {
                    right.push(line.substr(1));
                } else {
                    let codeInFirstLine = line.substr(1);
                    left.push(codeInFirstLine);
                    right.push(codeInFirstLine);
                }
            }

            let slimFileChange = new SlimFileChange(GitChangeType.MODIFY, originalFileName, left.join('\n'), fileName, right.join('\n'));
            slimFileChanges.push(slimFileChange);

            match = reg.exec(text);
            continue;
        }

        let newDiffInfo =  ADD_DIFF_INFO.exec(singleFileDiff);
        if (newDiffInfo) {
            let fileName = newDiffInfo[1];
            let diffHunks = newDiffInfo[3].split('\n');
            let contentArray = [];
            for (let i = 0; i < diffHunks.length; i++) {
                if (HUNK_HEADER.test(diffHunks[i])) {
                    continue;
                } else if (HUNK_HEADER_INLINE.test(diffHunks[i])) {
                    contentArray.push(diffHunks[i].replace(HUNK_HEADER_INLINE, ''));
                } else if (/^\+/.test(diffHunks[i])) {
                    contentArray.push(diffHunks[i].substr(1));
                }
            }

            let slimFileChange = new SlimFileChange(GitChangeType.ADD, null, null, fileName, contentArray.join('\n'));

            slimFileChanges.push(slimFileChange);
            match = reg.exec(text);
            continue;
        }

        let deleteDiffInfo = DELETE_DIFF_INFO.exec(singleFileDiff);
        if (deleteDiffInfo) {
            let fileName = deleteDiffInfo[1];
            let diffHunks = deleteDiffInfo[3].split('\n');
            let contentArray = [];
            for (let i = 0; i < diffHunks.length; i++) {
                if (HUNK_HEADER.test(diffHunks[i])) {
                    continue;
                } else if (HUNK_HEADER_INLINE.test(diffHunks[i])) {
                    contentArray.push(diffHunks[i].replace(HUNK_HEADER_INLINE, ''));
                } else if (/^\-/.test(diffHunks[i])) {
                    contentArray.push(diffHunks[i].substr(1));
                }
            }
            let slimFileChange = new SlimFileChange(GitChangeType.DELETE, fileName, contentArray.join('\n'), null, null);

            slimFileChanges.push(slimFileChange);
            match = reg.exec(text);
            continue;
        }
        match = reg.exec(text);
    }

    return slimFileChanges;
}