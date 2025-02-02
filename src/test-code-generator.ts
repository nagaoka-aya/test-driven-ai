import * as vscode from 'vscode';
import { createFile, editFile, getDocument } from "./vscode-util";
import { runBuild } from './script-runner';

// AIがコードを生成するためのプロンプト
const GENERATION_PROMPT = `あなたは優秀なプログラマです。
あなたの仕事はユーザーから与えられたテストケースを実装することです。
テスティングフレームワークにはjestを使用してください。
モジュールの読み込みはimportを使用してください。
テストデータが必要な場合はヒットしないデータを3件程度含むようにしてください。
引数やテストデータが指定されている場合は正確に実装に反映してください。
テストケースは日本語で記述してください。
レスポンスはMarkdownのコードブロック形式でしてください。
以下にレスポンスの例を示します。

\`\`\`ts: sum.test.ts
const sum = require('./sum');

test('adds 1 + 2 to equal 3', () => {
  expect(sum(1, 2)).toBe(3);
});
\`\`\`
`;

// AIが生成したコードを修正するためのプロンプト
const FIX_PROMPT = `あなたは優秀なプログラマです。
あなたの仕事は与えられたビルドエラーから、エラーを修正した完全なコードを提案することです。
レスポンスはMarkdownのコードブロック形式でしてください。
以下にレスポンスの例を示します。
\`\`\`js: fooBar.js
const sum = require('./sum');

test('adds 1 + 2 to equal 3', () => {
  expect(sum(1, 2)).toBe(3);
});
\`\`\`
`;

// テストケースが記載されているMDファイルへのパス
const TEST_CASE_FILE_PATH = './test-case.md';

// コードの最大生成回数
const MAX_RETRY_COUNT = 5;

export async function test_code_generate() {
    // MDファイルを読み込む
    const document = await getDocument(TEST_CASE_FILE_PATH);
    const editor = await vscode.window.showTextDocument(document);
    const testCases = editor.document.getText().split('---');

    const fullMessage: string[] = [];
    let [model] = await vscode.lm.selectChatModels({
        vendor: 'copilot',
        family: 'gpt-4o'
    });

    let testCaseCount = 1;
    for (const testCase of testCases) {
        let chatResponse = await sendTestCaseGenerateRequest(model, testCase, fullMessage);
        if (chatResponse) {
            const response = await parseChatResponse(chatResponse, fullMessage);
            if (response.possible) {
                const testFilePath = "src/test/test-case-" + testCaseCount + ".test.ts";
                await createFile(testFilePath);
                await editFile(testFilePath, response.contents);

                let result = await runBuild();
                let count = 0;

                while (result.exitCode !== 0 && count < MAX_RETRY_COUNT) {

                    try {
                        await fixCode(model, testFilePath, result.consoleLog, fullMessage);
                        result = await runBuild();
                        count += 1;
                    } catch (error: any) {
                        vscode.window.showErrorMessage('error: ' + error.message);
                        count = MAX_RETRY_COUNT;
                    }
                }
            } else {
                throw new Error('Code Generation is impossible.' + response.contents);
            }
        } else {
            throw new Error('Failed to generate code.');
        }

        testCaseCount++;
    }
}

async function sendTestCaseGenerateRequest(model: vscode.LanguageModelChat, testCase: string, messageHistory: string[]) {
    const messages = [
        vscode.LanguageModelChatMessage.User(GENERATION_PROMPT),
        vscode.LanguageModelChatMessage.User(testCase)
    ];
    messageHistory.push(GENERATION_PROMPT);
    messageHistory.push(testCase);

    if (model) {
        let chatResponse = await model.sendRequest(
            messages,
            {},
            new vscode.CancellationTokenSource().token
        );
        return chatResponse;
    }
}

async function fixCode(model: vscode.LanguageModelChat, filePath: string, buildResult: string, messageHistory: string[]) {
    const document = await getDocument(filePath);
    const testCode = document.getText();

    let chatResponse = await sendFixRequest(model, buildResult, testCode, messageHistory);

    const response = await parseChatResponse(chatResponse, messageHistory);

    if (response.possible) {
        await editFile(filePath, response.contents);
    } else {
        throw new Error('Code Generation is impossible.' + response.contents);
    }
}

async function sendFixRequest(model: vscode.LanguageModelChat, buildResult: string, generatedCode: string, messageHistory: string[]) {
    const messages = [
        vscode.LanguageModelChatMessage.Assistant(messageHistory.join('\n')),
        vscode.LanguageModelChatMessage.User(FIX_PROMPT),
        vscode.LanguageModelChatMessage.User(buildResult),
        vscode.LanguageModelChatMessage.User(generatedCode)
    ];
    messageHistory.push(FIX_PROMPT);
    messageHistory.push(buildResult);
    messageHistory.push(generatedCode);

    let chatResponse = await model.sendRequest(
        messages,
        {},
        new vscode.CancellationTokenSource().token
    );
    return chatResponse;
}

async function parseChatResponse(
    chatResponse: vscode.LanguageModelChatResponse,
    fullMessage: string[]
): Promise<{ possible: boolean, contents: string }> {
    let accumulatedResponse = '';

    for await (const fragment of chatResponse.text) {
        accumulatedResponse += fragment;
    }

    fullMessage.push(accumulatedResponse);
    if (accumulatedResponse.includes('Impossible')) {
        return {
            contents: accumulatedResponse,
            possible: false
        };
    }

    // 最初と最後の行を除外する
    const lines = accumulatedResponse.split('\n');
    const code = lines.slice(1, lines.length - 1).join('\n');
    return {
        contents: code.split('```')[0], // AIが複数のコードブロックを返すことがあるため、最初のコードブロックのみを取得する
        possible: true
    };
}