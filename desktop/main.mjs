import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, Menu, protocol, shell } from "electron";

import { DESKTOP_CONFIG_FILENAME, readDesktopConfig, writeDesktopConfig } from "./config.mjs";
import { classifyNavigation, mayGrantPermission } from "./navigation.mjs";

const desktopDirectory = fileURLToPath(new URL(".", import.meta.url));
const setupUrl = "sovereign-mail://desktop/setup.html";
const documentationUrl =
  "https://github.com/shadoprizm/mailsovereign/blob/main/docs/DESKTOP_UBUNTU.md";
const releaseUrl = "https://github.com/shadoprizm/mailsovereign/releases/latest";
const localFiles = new Map([
  ["/logo.svg", { file: "logo.svg", contentType: "image/svg+xml" }],
  ["/setup.css", { file: "setup.css", contentType: "text/css; charset=utf-8" }],
  ["/setup.html", { file: "setup.html", contentType: "text/html; charset=utf-8" }],
  ["/setup.js", { file: "setup.js", contentType: "text/javascript; charset=utf-8" }]
]);

let mainWindow = null;
let desktopConfig = null;
let loadError = null;

function configFile() {
  return join(app.getPath("userData"), DESKTOP_CONFIG_FILENAME);
}

function isSetupSender(event) {
  try {
    const senderUrl = new URL(event.senderFrame.url);
    return (
      senderUrl.protocol === "sovereign-mail:" &&
      senderUrl.host === "desktop" &&
      senderUrl.pathname === "/setup.html"
    );
  } catch {
    return false;
  }
}

function focusWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function windowBounds() {
  return {
    width: 1360,
    height: 900,
    minWidth: 840,
    minHeight: 600,
    show: false,
    backgroundColor: "#080808"
  };
}

function closeCurrentWindow() {
  if (!mainWindow) return;
  mainWindow.removeAllListeners("closed");
  mainWindow.destroy();
  mainWindow = null;
}

function installMenu() {
  const template = [
    {
      label: "Sovereign Mail",
      submenu: [
        {
          label: "Change Server…",
          accelerator: "Ctrl+Shift+S",
          click: () => showSetupWindow()
        },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      role: "help",
      submenu: [
        { label: "Ubuntu Client Guide", click: () => shell.openExternal(documentationUrl) },
        { label: "Release Downloads", click: () => shell.openExternal(releaseUrl) }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createBaseWindow(options = {}) {
  const window = new BrowserWindow({
    ...windowBounds(),
    ...options,
    title: "Sovereign Mail"
  });
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  return window;
}

function showSetupWindow(options = {}) {
  loadError = options.loadError ?? null;
  closeCurrentWindow();
  mainWindow = createBaseWindow({
    width: 720,
    height: 680,
    minWidth: 560,
    minHeight: 600,
    webPreferences: {
      preload: join(desktopDirectory, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: false
    }
  });
  mainWindow.loadURL(setupUrl);
}

function handleRemoteNavigation(event, target) {
  const disposition = classifyNavigation(target, desktopConfig.serverUrl);
  if (disposition === "application" || disposition === "authorization") return;

  event.preventDefault();
  if (disposition === "external") shell.openExternal(target).catch(() => {});
}

function showApplicationWindow() {
  loadError = null;
  closeCurrentWindow();
  mainWindow = createBaseWindow({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  const { webContents } = mainWindow;
  const { session } = webContents;
  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    mayGrantPermission(permission, requestingOrigin, desktopConfig.serverUrl)
  );
  session.setPermissionRequestHandler((requestingContents, permission, callback, details) => {
    try {
      const requestingOrigin = new URL(details.requestingUrl ?? requestingContents.getURL()).origin;
      callback(mayGrantPermission(permission, requestingOrigin, desktopConfig.serverUrl));
    } catch {
      callback(false);
    }
  });

  webContents.setWindowOpenHandler(({ url }) => {
    const disposition = classifyNavigation(url, desktopConfig.serverUrl);
    if (disposition === "external") shell.openExternal(url).catch(() => {});
    if (disposition === "application" || disposition === "authorization") {
      setImmediate(() => webContents.loadURL(url));
    }
    return { action: "deny" };
  });
  webContents.on("will-navigate", handleRemoteNavigation);
  webContents.on("will-redirect", handleRemoteNavigation);
  webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      let isApplicationUrl = false;
      try {
        isApplicationUrl = new URL(validatedUrl).origin === desktopConfig.serverUrl;
      } catch {
        isApplicationUrl = false;
      }
      if (!isMainFrame || errorCode === -3 || !isApplicationUrl) return;
      showSetupWindow({
        loadError: `Could not open ${desktopConfig.serverUrl}: ${errorDescription}`
      });
    }
  );
  mainWindow.loadURL(desktopConfig.serverUrl);
}

function configureIpc() {
  ipcMain.handle("desktop:get-state", (event) => {
    if (!isSetupSender(event)) throw new Error("Untrusted desktop configuration request.");
    return { serverUrl: desktopConfig?.serverUrl ?? null, loadError };
  });

  ipcMain.handle("desktop:configure-server", (event, serverUrl) => {
    if (!isSetupSender(event)) throw new Error("Untrusted desktop configuration request.");
    try {
      desktopConfig = writeDesktopConfig(configFile(), serverUrl);
      setImmediate(showApplicationWindow);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Invalid server URL." };
    }
  });
}

function configureLocalProtocol() {
  protocol.handle("sovereign-mail", (request) => {
    const url = new URL(request.url);
    const resource = url.host === "desktop" ? localFiles.get(url.pathname) : null;
    if (!resource) return new Response("Not found", { status: 404 });
    return new Response(readFileSync(join(desktopDirectory, resource.file)), {
      headers: { "content-type": resource.contentType }
    });
  });
}

function startDesktop() {
  app.setName("Sovereign Mail");
  configureLocalProtocol();
  configureIpc();
  installMenu();
  desktopConfig = existsSync(configFile()) ? readDesktopConfig(configFile()) : null;
  if (desktopConfig) showApplicationWindow();
  else showSetupWindow();
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "sovereign-mail",
    privileges: { standard: true, secure: true, supportFetchAPI: true }
  }
]);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", focusWindow);
  app.on("window-all-closed", () => app.quit());

  if (process.argv.includes("--smoke-test")) {
    app.whenReady().then(() => {
      process.stdout.write(`Sovereign Mail desktop ${app.getVersion()}\n`);
      app.exit(0);
    });
  } else {
    app.whenReady().then(startDesktop);
  }
}
