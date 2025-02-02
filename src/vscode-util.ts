import * as vscode from 'vscode';
import * as path from 'path';

/**
 * ワークスペース内の指定されたファイルパスからテキストドキュメントを取得します。
 *
 * @param filePath - ワークスペース内のファイルへの相対パス。
 * @returns 指定されたファイルの `vscode.TextDocument` を解決するPromise。
 * @throws ワークスペースが開かれていない場合はエラーをスローします。
 */
export async function getDocument(filePath: string): Promise<vscode.TextDocument> {
    let workspacePath: string;
    if (vscode.workspace.workspaceFolders) {
        workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    } else {
        throw new Error('No workspace is opened.');
    }
    return await vscode.workspace.openTextDocument(path.join(workspacePath, filePath));
}

/**
 * 指定されたファイルパスのファイルの内容を、提供されたコードで編集します。
 *
 * @param filePath - 編集するファイルへのパス。
 * @param code - ファイルに挿入する新しい内容。
 * @returns ファイルが正常に編集され保存されたときに解決されるPromise。
 * @throws ファイルを編集できなかった場合にエラーをスローします。
 */
export async function editFile(filePath: string, code: string): Promise<void> {
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

/**
 * ワークスペース内に新しいファイルを作成します。
 *
 * @param filePath - ワークスペース内で作成するファイルへの相対パス。
 * @throws ワークスペースが開かれていない場合はエラーをスローします。
 */
export async function createFile(filePath: string) {
    let workspacePath: string;
    if (vscode.workspace.workspaceFolders) {
        workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    } else {
        throw new Error('No workspace is opened.');
    }
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.createFile(vscode.Uri.file(path.join(workspacePath, filePath)), { ignoreIfExists: true });
    await vscode.workspace.applyEdit(workspaceEdit);
}

/**
 * ワークスペース内の指定されたフォルダー内のすべてのTypeScriptテストファイルのパスのリストを取得します。
 *
 * @param folderPath - テストファイルを検索するワークスペース内のフォルダーへの相対パス。
 * @returns ワークスペースのルートに対して相対的な、見つかったテストファイルのパスの配列を解決するPromise。
 * @throws ワークスペースが開かれていない場合はエラーをスローします。
 */
export async function getFilePathList(folderPath: string): Promise<string[]> {
    let workspacePath: string;
    if (vscode.workspace.workspaceFolders) {
        workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    } else {
        throw new Error('No workspace is opened.');
    }
    const folderUri = vscode.Uri.file(path.join(workspacePath, folderPath));
    const fileUriList = await vscode.workspace.findFiles(new vscode.RelativePattern(folderUri, '**/*.test.ts'));
    return fileUriList.map(uri => uri.fsPath.replace(workspacePath, ''));
}