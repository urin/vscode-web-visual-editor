import * as vscode from 'vscode';
import { VisualEditorProvider } from './visualEditor';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'web-visual-editor.customeEditor',
      new VisualEditorProvider(context)
    ),
    vscode.commands.registerCommand('web-visual-editor.open', () => {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor && activeEditor.document.languageId === 'html') {
        vscode.commands.executeCommand(
          'vscode.openWith',
          activeEditor.document.uri,
          'web-visual-editor.customeEditor'
        );
      }
    })
  );
}

export function deactivate() { }
