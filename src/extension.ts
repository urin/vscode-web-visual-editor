import * as vscode from 'vscode';
import * as path from 'path';
import { VisualEditorProvider } from './visualEditor';

function validateRootPath(outputChannel: vscode.OutputChannel) {
  const config = vscode.workspace.getConfiguration('webVisualEditor');
  const rootPath = config.get<string>('rootPath')?.trim();
  if (!rootPath) { return; }
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) { return; }
  // Validate against each workspace folder
  const valid = workspaceFolders.some(folder => {
    const workspaceRoot = folder.uri.fsPath;
    const resolved = path.resolve(workspaceRoot, rootPath);
    const relative = path.relative(workspaceRoot, resolved);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  });
  if (!valid) {
    outputChannel.appendLine(
      `[Web Visual Editor] Warning: "webVisualEditor.rootPath" value "${rootPath}" is outside the workspace and will be ignored.`
    );
  }
}

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Web Visual Editor');
  context.subscriptions.push(outputChannel);
  validateRootPath(outputChannel);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('webVisualEditor.rootPath')) {
        validateRootPath(outputChannel);
      }
    })
  );
  const provider = new VisualEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider('web-visual-editor.customEditor', provider),
    vscode.commands.registerCommand('web-visual-editor.open', (uri: vscode.Uri) => {
      const activeEditor = vscode.window.activeTextEditor;
      if (uri) {
        vscode.commands.executeCommand('vscode.openWith', uri, 'web-visual-editor.customEditor');
      } else if (activeEditor?.document.languageId === 'html') {
        vscode.commands.executeCommand(
          'vscode.openWith', activeEditor.document.uri, 'web-visual-editor.customEditor'
        );
      }
    }),
    vscode.commands.registerCommand('web-visual-editor.openBeside', () => {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor?.document.languageId === 'html') {
        vscode.commands.executeCommand(
          'vscode.openWith',
          activeEditor.document.uri,
          'web-visual-editor.customEditor',
          {
            viewColumn: vscode.ViewColumn.Beside,
            preserveFocus: true
          }
        );
      }
    }),
    vscode.commands.registerCommand('web-visual-editor.showSource', () => {
      const activeCode = provider.activeCode;
      if (activeCode) {
        vscode.window.visibleTextEditors.some(editor => {
          if (editor.document === activeCode) {
            vscode.window.showTextDocument(editor.document, editor.viewColumn);
            return true;
          }
        }) || vscode.commands.executeCommand('vscode.open', activeCode.uri);
      }
    })
  );
}

export function deactivate() { }
