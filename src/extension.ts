import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

type FolderItem = vscode.QuickPickItem&{
  fullPath: string;
};

type FolderPickerSession = {
  quickPick: vscode.QuickPick<FolderItem>;
  refresh: (value: string) => Promise<void>;
};

let activeFolderPicker: FolderPickerSession|undefined;

export function activate(context: vscode.ExtensionContext) {
  const openFolderDisposable = vscode.commands.registerCommand(
      'open-folder-by-path.openFolder', async () => {
        const initialDir = getInitialFolderPath();

        const qp = vscode.window.createQuickPick<FolderItem>();
        qp.title = 'Open Folder';
        qp.placeholder = 'Type folder name or absolute path';
        qp.matchOnDescription = true;

        async function refresh(value: string) {
          const expanded = resolveInputPath(value, initialDir);

          let baseDir: string;
          let typedName: string;

          if (value === '') {
            baseDir = initialDir;
            typedName = '';
          } else if (hasTrailingSeparator(value)) {
            baseDir = expanded;
            typedName = '';
          } else {
            baseDir = path.dirname(expanded);
            typedName = path.basename(expanded);
          }

          let entries: FolderItem[] = [];

          try {
            const dirents = await fs.readdir(baseDir, {withFileTypes: true});

            entries =
                dirents.filter(d => d.isDirectory())
                    .filter(
                        d => d.name.toLowerCase().startsWith(
                            typedName.toLowerCase()))
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(d => {
                      const fullPath = path.join(baseDir, d.name);
                      return {label: d.name, description: fullPath, fullPath};
                    });
          } catch {
            entries = [];
          }

          qp.items = entries;

          if (entries.length === 1) {
            qp.activeItems = [entries[0]];
          }
        }

        qp.onDidChangeValue(refresh);

        activeFolderPicker = {quickPick: qp, refresh};
        await vscode.commands.executeCommand(
            'setContext', 'openFolderByPath.quickPickFocus', true);

        qp.onDidAccept(async () => {
          const selected = qp.activeItems[0];

          let folderPath: string;

          if (qp.value === '' || isSamePath(qp.value, initialDir)) {
            folderPath = initialDir;
          } else if (selected && !hasTrailingSeparator(qp.value)) {
            folderPath = selected.fullPath;
          } else {
            folderPath = resolveInputPath(qp.value, initialDir);
          }

          qp.hide();

          await vscode.commands.executeCommand(
              'vscode.openFolder', vscode.Uri.file(folderPath), false);
        });

        qp.onDidHide(async () => {
          if (activeFolderPicker?.quickPick === qp) {
            activeFolderPicker = undefined;
          }

          await vscode.commands.executeCommand(
              'setContext', 'openFolderByPath.quickPickFocus', false);
          qp.dispose();
        });

        await refresh(initialDir);
        qp.show();
        qp.value = initialDir;
      });

  const completeFolderDisposable = vscode.commands.registerCommand(
      'open-folder-by-path.completeActiveFolder', async () => {
        const session = activeFolderPicker;

        if (!session) {
          return;
        }

        const qp = session.quickPick;
        const selected = qp.activeItems[0] ?? qp.items[0];

        if (!selected) {
          return;
        }

        qp.value = ensureTrailingSeparator(selected.fullPath);
        qp.activeItems = [];
        await session.refresh(qp.value);
      });

  context.subscriptions.push(openFolderDisposable, completeFolderDisposable);
}

function getInitialFolderPath(): string {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  if (workspaceFolder) {
    return workspaceFolder.uri.fsPath;
  }

  return os.homedir();
}

function resolveInputPath(input: string, relativeBaseDir: string): string {
  const expanded = expandHome(input);

  if (path.isAbsolute(expanded)) {
    return expanded;
  }

  return path.join(relativeBaseDir, expanded);
}

function isSamePath(input: string, target: string): boolean {
  return path.normalize(expandHome(input)) === path.normalize(target);
}

function expandHome(input: string): string {
  if (input === '~') {
    return os.homedir();
  }

  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }

  return input;
}

function ensureTrailingSeparator(input: string): string {
  return hasTrailingSeparator(input) ? input : input + path.sep;
}

function hasTrailingSeparator(input: string): boolean {
  return input.endsWith('/') || input.endsWith(path.sep);
}

export function deactivate() {}
