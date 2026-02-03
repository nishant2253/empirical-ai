import { Command } from 'commander';
import { GitManager } from './gitUtils';
import { identifyChangedSymbols, analyzeTestImpact } from './aiUtils';

const program = new Command();

program
    .version('1.0.0')
    .requiredOption('-r, --repo <path>', 'Path to local repo')
    .requiredOption('-c, --commit <sha>', 'Commit SHA')
    .action(async (options) => {
        await runAnalysis(options.repo, options.commit);
    });

program.parse(process.argv);

async function runAnalysis(repoPath: string, commitSha: string) {
    console.log(`\n🔍 Analyzing commit ${commitSha} using Gemini 2.5 Flash...\n`);
    
    const git = new GitManager(repoPath);
    const changedFiles = await git.getChangedFiles(commitSha);
    
    // We use a Map now to store the file path AND the "Reason/Type" for the impact
    const impactedTests = new Map<string, string>();

    // 1. CLASSIFY CHANGES
    for (const change of changedFiles) {
        const file = change.file;
        const status = change.status;

        if (file.endsWith('.spec.ts') || file.endsWith('.test.ts')) {
            console.log(`⚡ Direct Change [Status: ${status}]: ${file}`);
            
            let content = "";
            let diff = "";

            if (status === 'D') {
                console.log(`🗑️ File Deleted. Finding previous tests...`);
                content = await git.getFileContentAtRev(file, `${commitSha}^`);
                // For deleted files, the impact is "Removed" for all tests in it
                // We'll pass null diff but we need the AI to know they are all removed
                // Let's adjust analyzeTestImpact call or just handle it here
            } else {
                diff = await git.getFileDiff(commitSha, file);
                content = git.getFileContent(file);
            }

            const impactRaw = await analyzeTestImpact(content, status === 'D' ? `ALL TESTS REMOVED in ${file}` : diff);
            
            impactRaw.split('\n').forEach(line => {
                const trimmed = line.trim();
                if (trimmed.startsWith('- ')) {
                    let impactMsg = `${trimmed.substring(2)}|||${file}`;
                    if (status === 'D' && !impactMsg.includes('[Removed]')) {
                        impactMsg = impactMsg.replace(/\[(Added|Modified)\]/g, '').trim() + " [Removed]";
                    }
                    impactedTests.set(impactMsg, 'Direct');
                }
            });
        } 
        else if (file.endsWith('.ts')) {
            console.log(`🧩 Helper Changed: ${file}. Tracing dependencies...`);
            
            const diff = await git.getFileDiff(commitSha, file);
            const symbols = await identifyChangedSymbols(diff);
            
            for (const symbol of symbols) {
                console.log(`   👉 Symbol Modified: "${symbol}"`);
                const dependentFiles = await git.findFilesContaining(symbol);
                
                for (const f of dependentFiles) {
                    if (f.endsWith('.spec.ts')) {
                        console.log(`   🔗 Dependency Impact: ${f}`);
                        const content = git.getFileContent(f);
                        const impactRaw = await analyzeTestImpact(content, null, symbols); // passing null diff means all tests using it are modified
                        
                        impactRaw.split('\n').forEach(line => {
                            if (line.startsWith('- ')) {
                                const impactMsg = `${line.substring(2)}|||${f}`;
                                if (!impactedTests.has(impactMsg)) {
                                    impactedTests.set(impactMsg, 'Indirect');
                                }
                            }
                        });
                    }
                }
            }
        }
    }

    // 2. GENERATE REPORT
    if (impactedTests.size === 0) {
        console.log("✅ No tests appear to be impacted.");
        return;
    }

    console.log(`\n📋 Final Impact Report:\n`);

    const summaryMap = new Map<string, string[]>();
    impactedTests.forEach((type, msg) => {
        const parts = msg.split('|||');
        const testInfo = parts[0]; // e.g. "Test Name" [Modified]
        const filePath = parts[1];
        
        let status = "modified";
        if (testInfo.includes('[Added]')) status = "added";
        if (testInfo.includes('[Removed]')) status = "removed";
        
        const cleanName = testInfo.replace(/\[(Added|Removed|Modified)\]/g, '').trim().replace(/"/g, '');
        const entry = `1 test ${status}: "${cleanName}" in ${filePath}`;
        console.log(entry);
    });
}