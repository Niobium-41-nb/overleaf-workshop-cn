'use strict';
/*
 * Minimal stand-in for the `vscode` module, sufficient to load and exercise the
 * extension's project-manager / global-state modules outside of a real
 * extension host. Unknown members resolve to inert callable+constructible
 * stubs so that top-level `require` of the extension modules cannot fail on
 * an unimplemented API.
 */

const touched = new Set();

function makeStub(name) {
  const fn = function () { return undefined; };
  Object.defineProperty(fn, 'name', { value: name });
  const proxy = new Proxy(fn, {
    get(target, key) {
      if (key === Symbol.toPrimitive) return () => name;
      if (key === 'prototype') return target.prototype;
      if (key in target) return target[key];
      return makeStub(name + '.' + String(key));
    },
    apply() { touched.add(name); return undefined; },
    construct(target, args, newTarget) {
      touched.add(name);
      return Reflect.construct(function () {}, args, newTarget);
    },
  });
  return proxy;
}

class EventEmitter {
  constructor() {
    this._listeners = [];
    this.event = (listener) => {
      this._listeners.push(listener);
      return { dispose: () => { } };
    };
  }
  fire(value) { this._listeners.forEach(l => l(value)); }
  dispose() { this._listeners.length = 0; }
}

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class Uri {
  constructor(scheme, authority, path, query, fragment) {
    this.scheme = scheme;
    this.authority = authority;
    this.path = path;
    this.query = query;
    this.fragment = fragment;
  }
  static file(p) { return new Uri('file', '', p.replace(/\\/g, '/'), '', ''); }
  static parse(s) {
    const m = /^([a-zA-Z][\w+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(s);
    if (!m) throw new Error('bad uri ' + s);
    return new Uri(m[1], m[2] || '', m[3] || '', m[4] || '', m[5] || '');
  }
  static joinPath(base, ...parts) {
    return Uri.parse(base.scheme + '://' + base.authority + [base.path, ...parts].join('/'));
  }
  toString() {
    return this.scheme + '://' + this.authority + this.path +
      (this.query ? '?' + this.query : '') + (this.fragment ? '#' + this.fragment : '');
  }
  with(change) {
    return new Uri(change.scheme ?? this.scheme, change.authority ?? this.authority,
      change.path ?? this.path, change.query ?? this.query, change.fragment ?? this.fragment);
  }
}

class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(start, end) { this.start = start; this.end = end; } }

const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };

const workspace = {
  getConfiguration: (section) => ({
    get: (key, defaultValue) => defaultValue,
    has: () => false,
    update: () => Promise.resolve(),
    inspect: () => undefined,
  }),
  onDidChangeConfiguration: () => ({ dispose: () => { } }),
  onDidChangeWorkspaceFolders: () => ({ dispose: () => { } }),
  onDidSaveTextDocument: () => ({ dispose: () => { } }),
  onDidOpenTextDocument: () => ({ dispose: () => { } }),
  onDidCloseTextDocument: () => ({ dispose: () => { } }),
  onDidChangeTextDocument: () => ({ dispose: () => { } }),
  workspaceFolders: [],
  fs: {
    stat: () => Promise.reject(new Error('stub')),
    readFile: () => Promise.reject(new Error('stub')),
    writeFile: () => Promise.resolve(),
    createDirectory: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    readDirectory: () => Promise.resolve([]),
    rename: () => Promise.resolve(),
  },
};

const recorded = { showInputBox: [], showQuickPick: [], showWarningMessage: [], showErrorMessage: [], showInformationMessage: [] };

const window = {
  showInputBox: (opts) => { recorded.showInputBox.push(opts); return Promise.resolve(undefined); },
  showQuickPick: (items, opts) => { recorded.showQuickPick.push({ items, opts }); return Promise.resolve(undefined); },
  showWarningMessage: (msg, ...rest) => { recorded.showWarningMessage.push({ msg, rest }); return Promise.resolve(undefined); },
  showErrorMessage: (msg, ...rest) => { recorded.showErrorMessage.push({ msg, rest }); return Promise.resolve(undefined); },
  showInformationMessage: (msg, ...rest) => { recorded.showInformationMessage.push({ msg, rest }); return Promise.resolve(undefined); },
  createTreeView: () => makeStub('TreeView'),
  createWebviewPanel: () => makeStub('WebviewPanel'),
  registerWebviewViewProvider: () => ({ dispose: () => { } }),
  createOutputChannel: () => makeStub('OutputChannel'),
  showTextDocument: () => Promise.resolve(undefined),
  withProgress: (opts, task) => task({ report: () => { } }, makeStub('CancellationToken')),
  createStatusBarItem: () => makeStub('StatusBarItem'),
  activeTextEditor: undefined,
  visibleTextEditors: [],
  tabGroups: makeStub('TabGroups'),
};

const modules = {};

const base = {
  EventEmitter,
  TreeItem,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class ThemeIcon { constructor(id, color) { this.id = id; this.color = color; } },
  ThemeColor: class ThemeColor { constructor(id) { this.id = id; } },
  Uri,
  Position,
  Range,
  Selection: class Selection extends Range { },
  Disposable: class Disposable { constructor(fn) { this.dispose = fn || (() => { }); } },
  ConfigurationTarget,
  workspace,
  window,
  env: { machineId: 'test-machine', language: 'en', appName: 'Visual Studio Code', clipboard: { writeText: () => Promise.resolve() }, openExternal: () => Promise.resolve(true) },
  l10n: { t: (message, ...args) => interpolate(message, args), bundle: {} },
  commands: {
    registerCommand: () => ({ dispose: () => { } }),
    registerTextEditorCommand: () => ({ dispose: () => { } }),
    executeCommand: () => Promise.resolve(undefined),
    getCommands: () => Promise.resolve([]),
  },
  languages: { registerX: () => ({ dispose: () => { } }) },
  extensions: { getExtension: () => undefined, all: [] },
  version: '1.99.0',
  ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2 },
  ProgressLocation: { Notification: 15, Window: 10, SourceControl: 1 },
  FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
  FileSystemProvider: class FileSystemProvider { },
  FileSystemError: class FileSystemError extends Error {
    constructor(message) { super(message); this.code = 'Unknown'; }
    static FileNotFound() { return new FileSystemError('FileNotFound'); }
    static FileExists() { return new FileSystemError('FileExists'); }
    static NoPermissions() { return new FileSystemError('NoPermissions'); }
  },
  FileChangeType: { Changed: 1, Created: 2, Deleted: 3 },
  EventEmitterRef: undefined,
  StatusBarAlignment: { Left: 1, Right: 2 },
  TextEditorRevealType: { InCenter: 2 },
  WebviewViewProvider: class WebviewViewProvider { },
  CancellationTokenSource: class CancellationTokenSource { constructor() { this.token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => { } }) }; } cancel() { } dispose() { } },
  TreeDataProvider: class TreeDataProvider { },
  DecorationRangeBehavior: { OpenOpen: 0 },
  OverviewRulerLane: { Right: 4 },
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  QuickPickItemKind: { Separator: -1, Default: 0 },
};

function interpolate(message, args) {
  return String(message).replace(/\{(\w+)\}/g, (m, key) => {
    if (args.length === 0) return m;
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
      return args[0][key] !== undefined ? String(args[0][key]) : m;
    }
    const idx = String(message).split(/\{\w+\}/).indexOf(m);
    return idx >= 0 && idx < args.length ? String(args[idx]) : m;
  });
}

const api = new Proxy(base, {
  get(target, key) {
    if (key in target) return target[key];
    if (key === 'then') return undefined;
    return makeStub(String(key));
  },
  has() { return true; },
});

api.__internals = { recorded, touched };
module.exports = api;
