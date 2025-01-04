import * as vscode from 'vscode';
import * as path from 'path';

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
		async (textEditor: vscode.TextEditor) => {
			const fullMessage: string[] = [];

			let [model] = await vscode.lm.selectChatModels({
				vendor: 'copilot',
				family: 'gpt-4o'
			});

			try {
				await generateCode(model, textEditor, fullMessage);
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
}

async function generateCode(model: vscode.LanguageModelChat, textEditor: vscode.TextEditor, messageHistory: string[]) {
	const codeWithLineNumbers = getVisibleCodeWithLineNumbers(textEditor);

	let chatResponse = await sendGenerateRequest(model, codeWithLineNumbers, messageHistory);

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
	const editor = await vscode.window.showTextDocument(document);
	const codeWithLineNumbers = getVisibleCodeWithLineNumbers(editor);

	let chatResponse = await sendFixRequest(model, buildAndTestResult, codeWithLineNumbers, messageHistory);

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

function getVisibleCodeWithLineNumbers(textEditor: vscode.TextEditor) {
	let currentLine = textEditor.visibleRanges[0].start.line;
	const endLine = textEditor.visibleRanges[0].end.line;

	let code = '';

	while (currentLine < endLine) {
		code += `${currentLine + 1}: ${textEditor.document.lineAt(currentLine).text} \n`;
		currentLine++;
	}
	return code;
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

async function editFile(filePath: string, code: string): Promise<void> {
	const document = await getDocument(filePath);
	const editor = await vscode.window.showTextDocument(document);

	const editCallback = (editBuilder: vscode.TextEditorEdit) => {
		// ファイルの内容をすべて削除する
		const lastLine = editor.document.lineCount;
		const lastChar = editor.document.lineAt(lastLine - 1).range.end;
		editBuilder.delete(new vscode.Range(new vscode.Position(0, 0), lastChar));
		editBuilder.insert(new vscode.Position(0, 0), code);
	};

	const editSuccess = await editor.edit(editCallback);
	if (editSuccess) {
		await document.save();
	} else {
		throw new Error(`Failed to edit file: ${filePath}`);
	}
}

async function runBuildAndTest(): Promise<{ exitCode: number | undefined, consoleLog: string }> {
	try {
		const testRunTerminal = vscode.window.createTerminal('Test-Driven Terminal');
		testRunTerminal.show();

		return new Promise((resolve, reject) => {
			const dispose = vscode.window.onDidChangeTerminalShellIntegration(async ({ terminal }) => {
				if (terminal === testRunTerminal) {
					dispose.dispose();
					if (terminal.shellIntegration) {
						const buildResult = await runScript(terminal.shellIntegration, 'npx tsc');
						if (buildResult.exitCode === 0) {
							const testResult = await runScript(terminal.shellIntegration, 'npm run test');
							resolve(testResult);
						} else {
							resolve(buildResult);
						}
					} else {
						vscode.window.showErrorMessage('Shell integration is not available.');
					}
				}
			});
		});

	} catch (error: any) {
		vscode.window.showErrorMessage(`Failed to run tests: ${error.message}`);
	}

	return {
		exitCode: undefined,
		consoleLog: ''
	};
}

async function runScript(terminal: vscode.TerminalShellIntegration, command: string): Promise<{ exitCode: number | undefined, consoleLog: string }> {

	try {
		return new Promise((resolve, reject) => {
			const execution = terminal.executeCommand(command);
			const stream = execution.read();
			let consoleLog = '';

			const didEndDispose = vscode.window.onDidEndTerminalShellExecution(async event => {
				if (event.execution === execution) {
					didEndDispose.dispose();
					for await (const data of stream) {
						consoleLog += decodeANSICode(data);
					}
					resolve({
						exitCode: event.exitCode,
						consoleLog
					});
				}
			});

		});

	} catch (error: any) {
		vscode.window.showErrorMessage(`Failed to run ${command}: ${error.message}`);
	}

	return {
		exitCode: undefined,
		consoleLog: ''
	};
}


async function getDocument(filePath: string): Promise<vscode.TextDocument> {
	let workspacePath: string;
	if (vscode.workspace.workspaceFolders) {
		workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
	} else {
		throw new Error('No workspace is opened.');
	}
	return await vscode.workspace.openTextDocument(path.join(workspacePath, filePath));
}

// 参考：https://github.com/chalk/ansi-regex
function decodeANSICode(text: string): string {
	const ST = '(?:\\u0007|\\u001B\\u005C|\\u009C)';
	const pattern = [
		`[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?${ST})`,
		'(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))',
	].join('|');

	const reg = new RegExp(pattern, 'g');
	const decodedText = text.replace(reg, '');
	return decodedText;
}

// This method is called when your extension is deactivated
export function deactivate() { }
