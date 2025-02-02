import * as vscode from 'vscode';


export async function runBuildAndTest(): Promise<{ exitCode: number | undefined, consoleLog: string }> {
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

export async function runBuild(): Promise<{ exitCode: number | undefined, consoleLog: string }> {
    try {
        const testRunTerminal = vscode.window.createTerminal('Test-Driven Terminal');
        testRunTerminal.show();

        return new Promise((resolve, reject) => {
            const dispose = vscode.window.onDidChangeTerminalShellIntegration(async ({ terminal }) => {
                if (terminal === testRunTerminal) {
                    dispose.dispose();
                    if (terminal.shellIntegration) {
                        const buildResult = await runScript(terminal.shellIntegration, 'npx tsc');
                        resolve(buildResult);
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
