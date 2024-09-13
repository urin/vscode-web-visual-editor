import * as vscode from 'vscode';
import { VisualEditorProvider } from './visualEditor';

export function activate(context: vscode.ExtensionContext) {
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
