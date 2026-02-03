import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config({ path: '.env', override: true });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// 1. USE 2.5 FLASH
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash", 
    generationConfig: {
        temperature: 0, 
        maxOutputTokens: 2048,
    } 
});

export async function identifyChangedSymbols(diff: string): Promise<string[]> {
    const prompt = `
    You are a senior software engineer.
    Analyze the following git diff and identify the names of EXPORTED functions, classes, or top-level constants that were modified, added, or removed.
    Ignore internal variables or locals within function bodies.
    Return ONLY a comma-separated list of names. No explanation, no markdown.
    
    DIFF:
    ${diff.substring(0, 5000)}
    `;

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();
        if (!text || text.toLowerCase().includes("none")) return [];
        return text.split(',').map(s => s.trim().replace(/['"`]/g, '').replace(/```/g, '')).filter(s => s.length > 0);
    } catch (e: any) {
        console.error("⚠️ AI Error (Symbols):", e.message);
        return [];
    }
}

export async function analyzeTestImpact(fileContent: string, diff: string | null, symbols?: string[]): Promise<string> {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
    const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        generationConfig: {
            temperature: 0,
            maxOutputTokens: 2048,
        }
    });
    if (!fileContent || fileContent.trim().length === 0) {
        return "File content is empty.";
    }

    let prompt = "";

    if (diff) {
        prompt = `
        You are a QA Engineer specializing in Playwright.
        Analyze the git diff of this test file and identify which test cases were Impacted (Added, Removed, or Modified).
        
        Label each impacted test as:
        - [Added] if the test is new.
        - [Removed] if the test was deleted.
        - [Modified] if the test body or title was changed.
        
        Important: For each change in the diff, find the nearest wrapping test('Name', ...) call to identify the test name.
        
        Format: - "Test Name" [Status]
        
        DIFF:
        ${diff.substring(0, 20000)}
        
        FULL FILE CONTENT (for context):
        ${fileContent.substring(0, 100000)}
        `;
    } else {
        // Indirect modification (dependency change)
        prompt = `
        You are a QA Engineer specializing in Playwright.
        The following helper symbols used in this test file have changed: ${symbols?.join(', ') || 'unknown symbols'}.
        Analyze the file content and identify ONLY the test cases (test('name', ...)) that actually call or use one of these modified symbols.
        
        Do NOT list tests that do not use these symbols.
        
        Format: - "Test Name" [Modified]
        
        FILE CONTENT:
        ${fileContent.substring(0, 100000)}
        `;
    }

    try {
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (e: any) {
        console.error(`\n❌ API Error: ${e.message}`);
        return "Error analyzing impact.";
    }
}