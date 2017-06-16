import * as cp from 'child_process';

export interface ExecResult {
    error: Error;
    stdout: string;
    stderr: string;
}

export function exec(command: string, options: cp.ExecOptions) {
    return new Promise<ExecResult>((resolve, reject) => {
        cp.exec(command, options, (error, stdout, stderr) => {
            (error || stderr ? reject : resolve)({ error, stdout, stderr });
        });
    });
}

export function sleep(millis: number) {
    return new Promise<void>(resolve => {
        setTimeout(resolve, millis);
    });
}

export function allMatches(regex: RegExp, string: string, group: number) {
    return {
        [Symbol.iterator]: function* () {
            let m: RegExpExecArray | null;
            while (m = regex.exec(string)) {
                yield m[group];
                if (regex.lastIndex === m.index) {
                    regex.lastIndex++;
                }
            }
        }
    }
}

export function compareDateStrings(left: string, right: string) {
    if (!left && !right) {
        return 0;
    }
    if (!left) {
        return 1;
    }
    if (!right) {
        return -1;
    }
    return Date.parse(left).valueOf() - Date.parse(right).valueOf()
}
