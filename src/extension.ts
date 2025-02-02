import * as vscode from 'vscode';
import { runBuildAndTest } from './script-runner';
import { editFile, getDocument, getFilePathList } from './vscode-util';
import { test_code_generate } from './test-code-generator';
import { get } from 'http';

// AIがコードを生成するためのプロンプト
const GENERATION_PROMPT = `あなたは優秀なプログラマです。
あなたの仕事はユーザーから与えられたテストコードが全て成功する完全なコードを提案することです。
レスポンスはMarkdownのコードブロック形式でしてください。
ただし、テストを満たすことが論理的に不可能な場合はImpossibleから始めて、以降にその理由を返してください。
以下にレスポンスの例を示します。

### テストを満たすことが論理的に可能な場合
\`\`\`js: fooBar.js
const great = () => {
	console.log("Awesome")
}
\`\`\`

### テストを満たすことが論理的に不可能な場合
Impossible
テストを満たすことが不可能な理由をここに書いてください。
`;

// AIが生成したコードを修正するためのプロンプト
const FIX_PROMPT = `あなたは優秀なプログラマです。
あなたの仕事は与えられたテストの実行結果から、テストを満たすように修正した完全なコードを提案することです。
レスポンスはMarkdownのコードブロック形式でしてください。
以下にレスポンスの例を示します。
\`\`\`js: fooBar.js
const great = () => {
	console.log("Awesome")
}
\`\`\`
`;

// AIが生成するコードを書き込む先のファイルパス
const SRC_FILE_PATH = 'src/index.ts';

// コードの最大生成回数
const MAX_RETRY_COUNT = 5;

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "test-driven-coding" is now active!');

	const disposable = vscode.commands.registerTextEditorCommand(
		'test-driven-ai.coding',
		async () => {
			const fullMessage: string[] = [];

			let [model] = await vscode.lm.selectChatModels({
				vendor: 'copilot',
				family: 'gpt-4o'
			});

			try {
				await generateCode(model, fullMessage);
			} catch (error: any) {
				vscode.window.showErrorMessage('error: ' + error.message);
			}

			let result = await runBuildAndTest();
			let count = 0;

			while (result.exitCode !== 0 && count < MAX_RETRY_COUNT) {

				try {
					await fixCode(model, result.consoleLog, fullMessage);
					result = await runBuildAndTest();
					count += 1;
				} catch (error: any) {
					vscode.window.showErrorMessage('error: ' + error.message);
					count = MAX_RETRY_COUNT;
				}
			}

			if (result.exitCode === 0) {
				vscode.window.showInformationMessage('Tests passed successfully.');
			} else {
				vscode.window.showErrorMessage('Code Generation is impossible.');
			}
		}
	);

	context.subscriptions.push(disposable);

	const testCaseDisposable = vscode.commands.registerTextEditorCommand(
		'test-driven-ai.test-coding',
		async () => {
			try {
				await test_code_generate();
				vscode.window.showInformationMessage('Test case generated!!');
			} catch (error: any) {
				vscode.window.showErrorMessage('error: ' + error.message);
			}
		}
	);
	context.subscriptions.push(testCaseDisposable);
}

async function generateCode(model: vscode.LanguageModelChat, messageHistory: string[]) {
	const testCode = await getAllTestCode();

	let chatResponse = await sendGenerateRequest(model, testCode, messageHistory);

	if (chatResponse) {
		const response = await parseChatResponse(chatResponse, messageHistory);
		if (response.possible) {
			await editFile(SRC_FILE_PATH, response.contents);
		} else {
			throw new Error('Code Generation is impossible.' + response.contents);
		}
	} else {
		throw new Error('Failed to generate code.');
	}
}

async function sendGenerateRequest(model: vscode.LanguageModelChat, testCode: string, messageHistory: string[]) {
	const messages = [
		vscode.LanguageModelChatMessage.User(GENERATION_PROMPT),
		vscode.LanguageModelChatMessage.User(testCode)
	];
	messageHistory.push(GENERATION_PROMPT);
	messageHistory.push(testCode);

	if (model) {
		let chatResponse = await model.sendRequest(
			messages,
			{},
			new vscode.CancellationTokenSource().token
		);
		return chatResponse;
	}
}

async function fixCode(model: vscode.LanguageModelChat, buildAndTestResult: string, messageHistory: string[]) {
	const document = await getDocument(SRC_FILE_PATH);
	let chatResponse = await sendFixRequest(model, buildAndTestResult, document.getText(), messageHistory);

	const response = await parseChatResponse(chatResponse, messageHistory);

	if (response.possible) {
		await editFile(SRC_FILE_PATH, response.contents);
	} else {
		throw new Error('Code Generation is impossible.' + response.contents);
	}
}

async function sendFixRequest(model: vscode.LanguageModelChat, buildAndTestResult: string, generatedCode: string, messageHistory: string[]) {
	const messages = [
		vscode.LanguageModelChatMessage.Assistant(messageHistory.join('\n')),
		vscode.LanguageModelChatMessage.User(FIX_PROMPT),
		vscode.LanguageModelChatMessage.User(buildAndTestResult),
		vscode.LanguageModelChatMessage.User(generatedCode)
	];
	messageHistory.push(FIX_PROMPT);
	messageHistory.push(buildAndTestResult);
	messageHistory.push(generatedCode);

	let chatResponse = await model.sendRequest(
		messages,
		{},
		new vscode.CancellationTokenSource().token
	);
	return chatResponse;
}

async function getAllTestCode() {
	const testFileList = await getFilePathList('src/test');
	let allTestCode = '';
	for (const testFilePath of testFileList) {
		const testDocument = await getDocument(testFilePath);
		allTestCode += testDocument.getText();
	}
	return allTestCode;
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

// This method is called when your extension is deactivated
export function deactivate() { }
