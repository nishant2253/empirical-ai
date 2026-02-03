import simpleGit, { SimpleGit } from 'simple-git';
import path from 'path';
import fs from 'fs';
import { glob } from 'glob';

export class GitManager {
    private git: SimpleGit;
    private repoPath: string;

    constructor(repoPath: string) {
        this.repoPath = repoPath;
        this.git = simpleGit(repoPath);
    }

    async getChangedFiles(commitSha: string): Promise<{ file: string, status: string }[]> {
        const summary = await this.git.diffSummary([`${commitSha}^..${commitSha}`]);
        // simple-git's diffSummary doesn't explicitly give A/M/D in the 'files' list easily
        // We can use 'git show --name-status' for better precision
        const rawStatus = await this.git.show(['--name-status', '--format=', commitSha]);
        return rawStatus.trim().split('\n').map(line => {
            const [status, file] = line.split(/\s+/);
            return { file, status };
        });
    }

    async getFileDiff(commitSha: string, filePath: string): Promise<string> {
        return await this.git.diff([`${commitSha}^..${commitSha}`, '--', filePath]);
    }

    getFileContent(filePath: string): string {
        const fullPath = path.join(this.repoPath, filePath);
        if (fs.existsSync(fullPath)) return fs.readFileSync(fullPath, 'utf-8');
        return "";
    }

    async getFileContentAtRev(filePath: string, rev: string): Promise<string> {
        try {
            return await this.git.show([`${rev}:${filePath}`]);
        } catch (e) {
            return "";
        }
    }

    async findFilesContaining(searchTerm: string): Promise<string[]> {
        const files = await glob(`${this.repoPath}/**/*.ts`);
        const matches: string[] = [];
        for (const file of files) {
            const content = fs.readFileSync(file, 'utf-8');
            if (content.includes(searchTerm)) {
                matches.push(path.relative(this.repoPath, file));
            }
        }
        return matches;
    }
}