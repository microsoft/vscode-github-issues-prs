import * as fs from 'fs';
import * as tmp from 'tmp';

export async function writeTmpFile(content: string, ext: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        tmp.file({ postfix: ext }, async (err: any, tmpFilePath: string) => {
            if (err) {
                reject(err);
                return;
            }

            try {
                fs.appendFileSync(tmpFilePath, content);
                resolve(tmpFilePath);
            } catch (ex) {
                reject(ex);
            }
        });
    })
}