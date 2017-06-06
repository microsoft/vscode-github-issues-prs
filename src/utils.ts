import * as cp from 'child_process';

export interface ExecResult {
    error: Error;
    stdout: string;
    stderr: string;
}

export function exec(command: string, options?: cp.ExecOptions) {
    return new Promise<ExecResult>((resolve, reject) => {
        cp.exec(command, options, (error, stdout, stderr) => {
            (error || stderr ? reject : resolve)({ error, stdout, stderr });
        });
    });
}

export function allMatches(regex: RegExp, string: string, group: number) {
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
