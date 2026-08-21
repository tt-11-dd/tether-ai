import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  protocol,
  shell,
} from "electron";
import {
  createTetherCredentialStore,
  ensureSessionRuntimeLink,
  getTetherHome,
  getStoredDeepSeekBaseUrl,
  getStoredModelSelection,
  initializeTetherHome,
  listTetherThreads,
  TetherStateStore,
  providerDisplayName,
  providerEnvironmentKey,
  removeStoredProviderCredential,
  saveDeepSeekBaseUrl,
  saveProviderApiKey,
  SUPPORTED_PROVIDER_IDS,
  type ApiKeyProviderId,
  type SupportedProviderId,
} from "tether-agent-core";
import { AgentHost } from "./agent-host";
import { isPathInsideRoot } from "./workspace-path";
import { listLocalSkills, revealSkillPath } from "./skills-fs";
import { apiBaseUrl, listOpenAiModels } from "../shared/openai-models";
import {
  activeChat,
  activeCustomProfile,
  mergeChatProfiles,
  migrateChatProfiles,
  parseChatProfiles,
  type ChatProfiles,
} from "../shared/chat-profiles";
import {
  DEFAULT_VISION_CONFIG,
  DEEPSEEK_VISION_BASE,
  resolveVisionRuntime,
  resolveVisionSettings,
  visionTitle,
  type VisionConfig,
  type VisionProvider,
} from "../shared/vision-api";
import {
  DEFAULT_LOCALE,
  isLocale,
  resolveLocale,
  t,
  type Locale,
} from "../shared/i18n";
import { getLatestUpdate } from "./update-check";
import {
  PREVIEW_SCHEME,
  UPLOADS_HOST,
  type AgentSnapshot,
  type AgentStartOptions,
  type ProviderStatus,
  type SessionSummary,
  type WorkspaceItem,
} from "../shared/types";
import { PROJECT_SKILL_ROOTS } from "../shared/skills";

const ALLOWED_AGENT_COMMANDS = new Set([
  "prompt",
  "steer",
  "abort",
  "new_session",
  "get_state",
  "get_messages",
  "set_model",
  "set_thinking_level",
  "get_session_stats",
  "get_available_models",
  "get_available_thinking_levels",
  "get_fork_messages",
  "get_entries",
  "get_commands",
  "fork",
  "compact",
]);

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const legacyUserDataPath = path.join(app.getPath("appData"), "DSHarness");
const userDataPath = path.join(app.getPath("appData"), "Tether");

// Preserve existing sessions and credentials across the product rename.
if (!fs.existsSync(userDataPath) && fs.existsSync(legacyUserDataPath)) {
  try {
    fs.renameSync(legacyUserDataPath, userDataPath);
  } catch {
    // The old directory remains usable only by older builds; start clean if migration is unavailable.
  }
}

// Desktop distribution favors a quiet first run; the owner-only file avoids OS keyring prompts.
process.env.TETHER_CREDENTIALS_STORE = "file";

let mainWindow: BrowserWindow | undefined;
let agentHost: AgentHost | undefined;
let activeAgentCwd: string | undefined;
let activeSessionPath: string | undefined;
let workspaceWatcher: fs.FSWatcher | undefined;
let watchedWorkspace = "";
let watchTimer: ReturnType<typeof setTimeout> | undefined;
let updateCheckStarted = false;
let appLocale: Locale = DEFAULT_LOCALE;

// A privileged scheme gives previews a real origin: storage APIs work, and the app stays cross-origin.
protocol.registerSchemesAsPrivileged([
  {
    scheme: PREVIEW_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

app.setName("Tether");
fs.mkdirSync(userDataPath, { recursive: true, mode: 0o700 });
app.setPath("userData", userDataPath);

function appIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(currentDirectory, "../../build/icon.png");
}

function applyDockIcon(): void {
  if (process.platform !== "darwin" || app.isPackaged) return;
  const image = nativeImage.createFromPath(appIconPath());
  if (image.isEmpty()) return;
  void app.dock?.setIcon(image);
}

async function checkForUpdates(manual = false): Promise<void> {
  if (!manual && (!app.isPackaged || updateCheckStarted)) return;
  updateCheckStarted = true;

  try {
    const update = await getLatestUpdate(app.getVersion(), (url, init) =>
      net.fetch(url, init),
    );
    const window = mainWindow;
    if (!window || window.isDestroyed()) return;

    const icon = nativeImage.createFromPath(appIconPath());
    if (!update) {
      if (manual) {
        await dialog.showMessageBox(window, {
          type: "info",
          icon,
          title: t(appLocale, "update.title"),
          message: t(appLocale, "update.latest"),
          detail: t(appLocale, "update.currentVersion", {
            version: app.getVersion(),
          }),
          buttons: [t(appLocale, "update.ok")],
          noLink: true,
        });
      }
      return;
    }

    const result = await dialog.showMessageBox(window, {
      type: "info",
      icon,
      title: t(appLocale, "update.title"),
      message: t(appLocale, "update.available", { version: update.version }),
      detail: t(appLocale, "update.detail", { current: app.getVersion() }),
      buttons: [t(appLocale, "update.download"), t(appLocale, "update.later")],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (result.response === 0) await shell.openExternal(update.url);
  } catch (error) {
    // Startup checks stay silent; a manual click deserves an answer.
    if (!manual || !mainWindow || mainWindow.isDestroyed()) return;
    await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: t(appLocale, "update.title"),
      message: t(appLocale, "update.failed"),
      detail:
        error instanceof Error
          ? error.message
          : t(appLocale, "update.failedDetail"),
      buttons: [t(appLocale, "update.ok")],
      noLink: true,
    });
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 880,
    minHeight: 600,
    show: false,
    backgroundColor: "#fafafb",
    icon: appIconPath(),
    // The Windows controls overlay always paints above page content, so dialogs could never
    // cover it. Going frameless lets the renderer draw its own buttons in normal stacking order.
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 16, y: 14 },
        }
      : {
          frame: false,
          // Transparent frameless windows lose the Windows resize border, and DWM rounding punches
          // the desktop through the corners, so the shell stays square with a CSS hairline instead.
          roundedCorners: false,
          hasShadow: true,
        }),
    webPreferences: {
      preload: path.join(currentDirectory, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  agentHost = new AgentHost(
    (event) => mainWindow?.webContents.send("agent:event", event),
    (message) => mainWindow?.webContents.send("agent:error", message),
  );

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    void checkForUpdates();
  });
  // Fullscreen hides the macOS traffic lights, so the renderer must stop reserving room for them.
  const reportFullscreen = () =>
    sendAppCommand(
      mainWindow?.isFullScreen() ? "fullscreen-on" : "fullscreen-off",
    );
  mainWindow.on("enter-full-screen", reportFullscreen);
  mainWindow.on("leave-full-screen", reportFullscreen);
  mainWindow.webContents.on("did-finish-load", reportFullscreen);
  mainWindow.on("closed", () => {
    mainWindow = undefined;
    // macOS keeps the app alive after the window closes; still reap the RPC tree
    // so sandbox shells don't keep burning RAM in the background.
    void agentHost?.stop();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) void mainWindow.loadURL(devServer);
  else
    void mainWindow.loadFile(
      path.join(currentDirectory, "../../dist/index.html"),
    );
}

function sendAppCommand(command: string): void {
  mainWindow?.webContents.send("app:command", command);
}

function installMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
      {
        label: t(appLocale, "menu.file"),
        submenu: [
          {
            label: t(appLocale, "menu.newThread"),
            accelerator: "CmdOrCtrl+N",
            click: () => sendAppCommand("new-thread"),
          },
          {
            label: t(appLocale, "menu.openFolder"),
            accelerator: "CmdOrCtrl+O",
            click: () => sendAppCommand("open-folder"),
          },
          { type: "separator" },
          process.platform === "darwin" ? { role: "close" } : { role: "quit" },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
    ]),
  );
}

function registerIpc(): void {
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:check-update", () => checkForUpdates(true));
  ipcMain.handle("app:get-locale", () => appLocale);
  ipcMain.handle("app:set-locale", async (_event, locale: unknown) => {
    if (!isLocale(locale)) throw new Error("Unsupported locale");
    await saveLocale(locale);
  });
  ipcMain.handle("app:open-external", async (_event, url: string) => {
    if (!isSafeExternalUrl(url))
      throw new Error("Only http(s) links can be opened");
    await shell.openExternal(url);
  });
  ipcMain.handle(
    "app:reveal-path",
    async (_event, skillName: string, hint?: string) => {
      if (typeof skillName !== "string" || !skillName.trim())
        throw new Error("Invalid skill name");
      await revealSkillPath(
        skillName.trim(),
        typeof hint === "string" ? hint : undefined,
      );
    },
  );
  ipcMain.handle("app:list-skills", async () =>
    listLocalSkills(activeAgentCwd),
  );

  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:toggle-maximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle("window:close", () => mainWindow?.close());

  ipcMain.handle("workspace:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: t(appLocale, "dialog.openWorkspace"),
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: t(appLocale, "dialog.open"),
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return recentWorkspaces.touch(result.filePaths[0]);
  });
  ipcMain.handle("workspace:recent", () => recentWorkspaces.list());
  ipcMain.handle("workspace:forget", async (_event, workspacePath: string) => {
    const store = new TetherStateStore();
    try {
      await store.refresh();
      for (const thread of store.list({ cwd: workspacePath })) {
        await store.archive(thread.id);
      }
    } finally {
      store.close();
    }
    return recentWorkspaces.forget(workspacePath);
  });
  ipcMain.handle(
    "workspace:read",
    async (_event, relativePath: string, workspacePath?: string) => {
      try {
        const resolved = await resolveInWorkspace(relativePath, workspacePath);
        const buffer = await fsp.readFile(resolved);
        if (buffer.includes(0))
          return { path: relativePath, binary: true, content: "" };
        const text = buffer.toString("utf8");
        return {
          path: relativePath,
          binary: false,
          content:
            text.length > 200_000 ? `${text.slice(0, 200_000)}\n…` : text,
        };
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return { path: relativePath, binary: false, content: "" };
        }
        throw error;
      }
    },
  );
  ipcMain.handle(
    "workspace:open",
    async (_event, relativePath: string, workspacePath?: string) => {
      const error = await shell.openPath(
        await resolveInWorkspace(relativePath, workspacePath),
      );
      if (error) throw new Error(error);
    },
  );
  ipcMain.handle(
    "workspace:reveal",
    async (_event, relativePath: string, workspacePath?: string) => {
      shell.showItemInFolder(
        await resolveInWorkspace(
          typeof relativePath === "string" && relativePath.trim()
            ? relativePath
            : ".",
          workspacePath,
        ),
      );
    },
  );
  ipcMain.handle(
    "workspace:restore",
    async (_event, files: unknown, workspacePath?: string) => {
      if (!Array.isArray(files)) throw new Error("Invalid restore payload");
      const restored: string[] = [];
      for (const file of files) {
        if (!file || typeof file !== "object") continue;
        const item = file as {
          path?: unknown;
          content?: unknown;
          mode?: unknown;
        };
        if (typeof item.path !== "string" || !item.path.trim()) continue;
        const resolved = await resolveInWorkspace(item.path, workspacePath);
        if (item.content === null) {
          await fsp.rm(resolved, { force: true });
        } else if (typeof item.content === "string") {
          await fsp.mkdir(path.dirname(resolved), { recursive: true });
          await fsp.writeFile(resolved, item.content, {
            encoding: "utf8",
            ...(typeof item.mode === "number" ? { mode: item.mode } : {}),
          });
        } else {
          continue;
        }
        restored.push(item.path);
      }
      return { restored };
    },
  );
  ipcMain.handle("workspace:list", async (_event, workspacePath?: string) => {
    const root = path.resolve(
      typeof workspacePath === "string" && workspacePath
        ? workspacePath
        : (activeAgentCwd ?? ""),
    );
    if (!root) return [];
    const allowed =
      path.resolve(activeAgentCwd ?? "") === root ||
      (await recentWorkspaces.list()).some(
        (item) => path.resolve(item.path) === root,
      );
    if (!allowed) return [];
    watchWorkspace(root);
    return listWorkspaceFiles(root);
  });
  ipcMain.handle("vision:config", async () => {
    const config = await loadVisionConfig();
    const profiles = await loadChatProfiles().catch(() => undefined);
    const chatKey =
      profiles?.kind === "deepseek" ? profiles.deepseek.apiKey.trim() : "";
    const apiKey =
      config.provider === "deepseek"
        ? config.apiKey.trim() || chatKey
        : config.apiKey;
    return {
      provider: config.provider,
      endpoint: config.endpoint,
      model: config.model,
      apiKey,
      hasApiKey: Boolean(apiKey.trim()),
    };
  });
  ipcMain.handle(
    "vision:save-config",
    async (
      _event,
      next: {
        provider?: VisionProvider;
        endpoint?: string;
        model?: string;
        apiKey?: string;
      },
    ) => {
      const settings = resolveVisionSettings({
        provider: next.provider,
        endpoint: next.endpoint,
        model: next.model,
      });
      const apiKey = typeof next.apiKey === "string" ? next.apiKey.trim() : "";
      const config: VisionConfig =
        settings.provider === "deepseek"
          ? await materializeDeepSeekVision(apiKey)
          : { ...settings, apiKey };
      await fsp.writeFile(
        visionConfigPath(),
        `${JSON.stringify(config, null, 2)}\n`,
        { mode: 0o600 },
      );
    },
  );
  ipcMain.handle("vision:stage", async (_event, images: string[]) => {
    const refs = Array.isArray(images)
      ? images.filter((item) => typeof item === "string" && item).slice(0, 4)
      : [];
    if (refs.length === 0) throw new Error("先上传至少一张图片");
    const dir = visionUploadsDir();
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    const stamp = Date.now();
    return Promise.all(
      refs.map(async (item, index) => {
        const match = item.match(/^data:([^;]+);base64,(.+)$/);
        const mime = match?.[1] ?? "image/png";
        const data = match?.[2] ?? item.replace(/^data:[^;]+;base64,/, "");
        const ext =
          mime.includes("jpeg") || mime.includes("jpg")
            ? "jpg"
            : mime.includes("webp")
              ? "webp"
              : mime.includes("gif")
                ? "gif"
                : "png";
        const file = path.join(dir, `${stamp}-${index + 1}.${ext}`);
        await fsp.writeFile(file, Buffer.from(data, "base64"), { mode: 0o600 });
        return file;
      }),
    );
  });

  ipcMain.handle("sessions:list", async (_event, cwd?: string) => {
    const threads = await listTetherThreads(cwd ? { cwd } : {});
    return threads.map(
      (thread): SessionSummary => ({
        path: thread.sessionPath,
        storagePath: thread.storagePath,
        id: thread.id,
        cwd: thread.cwd,
        title: visionTitle(thread.title),
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        ...(thread.provider ? { provider: thread.provider } : {}),
        ...(thread.model ? { model: thread.model } : {}),
        messageCount: thread.messageCount,
        ...(thread.preview ? { preview: thread.preview } : {}),
        pinned: thread.pinned,
        archived: thread.archived,
      }),
    );
  });
  ipcMain.handle("sessions:remove", async (_event, id: string) => {
    const store = new TetherStateStore();
    try {
      await store.refresh();
      await store.archive(id);
    } finally {
      store.close();
    }
  });
  ipcMain.handle(
    "sessions:pin",
    async (_event, id: string, pinned: boolean) => {
      const store = new TetherStateStore();
      try {
        await store.refresh();
        if (!store.setPinned(id, pinned))
          throw new Error("Conversation not found");
      } finally {
        store.close();
      }
    },
  );
  ipcMain.handle(
    "sessions:rename",
    async (_event, id: string, title: string) => {
      const name = title.trim().slice(0, 96);
      if (!name) throw new Error("Conversation name cannot be empty");
      const store = new TetherStateStore();
      try {
        await store.refresh();
        const thread = store.get(id);
        if (!thread) throw new Error("Conversation not found");
        await fsp.appendFile(
          thread.storagePath,
          `${JSON.stringify({
            type: "session_info",
            name,
            timestamp: new Date().toISOString(),
          })}\n`,
        );
        await store.indexSession(thread.storagePath);
      } finally {
        store.close();
      }
    },
  );

  ipcMain.handle("auth:status", async (): Promise<ProviderStatus[]> => {
    const credentialStore = await createTetherCredentialStore();
    const storedProviders = new Set(
      (await credentialStore.list()).map((entry) => entry.providerId),
    );
    const stored = getStoredModelSelection();
    const deepseekUrl = getStoredDeepSeekBaseUrl();
    return SUPPORTED_PROVIDER_IDS.filter((id) => id !== "openai-codex").map(
      (id) => {
        const hasStore = storedProviders.has(id);
        const environmentKey = providerEnvironmentKey(id);
        const environment = Boolean(
          environmentKey && process.env[environmentKey]?.trim(),
        );
        return {
          id,
          name: providerDisplayName(id),
          configured: hasStore || environment,
          ...(hasStore
            ? { source: "stored" as const }
            : environment
              ? { source: "environment" as const }
              : {}),
          defaultModel:
            stored?.providerId === id && stored.modelId ? stored.modelId : "",
          ...(id === "deepseek" && deepseekUrl ? { baseUrl: deepseekUrl } : {}),
          ...(stored?.providerId === id ? { preferred: true } : {}),
        };
      },
    );
  });
  ipcMain.handle(
    "auth:read-api-key",
    async (_event, provider: ApiKeyProviderId) => {
      const stored = await (await createTetherCredentialStore()).read(provider);
      if (stored && stored.type === "api_key" && typeof stored.key === "string")
        return stored.key;
      const envName = providerEnvironmentKey(provider);
      return envName ? (process.env[envName]?.trim() ?? "") : "";
    },
  );
  ipcMain.handle(
    "auth:save-api-key",
    async (
      _event,
      provider: ApiKeyProviderId,
      key: string,
      baseUrl?: string,
      model?: string,
    ) => {
      if (typeof key === "string" && key.trim())
        await saveProviderApiKey(provider, key.trim());
      if (baseUrl?.trim()) await saveDeepSeekBaseUrl(baseUrl.trim());
      if (model?.trim()) await saveDefaultModel(provider, model.trim());
    },
  );
  ipcMain.handle("auth:profiles", () => loadChatProfiles());
  ipcMain.handle("auth:save-profiles", async (_event, next: ChatProfiles) => {
    await saveChatProfiles(next);
  });
  ipcMain.handle(
    "auth:list-models",
    async (_event, baseUrl: string, apiKey: string) => {
      if (typeof baseUrl !== "string" || typeof apiKey !== "string")
        throw new Error("先填写 API URL 和 Key");
      return listOpenAiModels(baseUrl, apiKey);
    },
  );
  ipcMain.handle(
    "auth:logout",
    async (_event, provider: SupportedProviderId) => {
      await removeStoredProviderCredential(provider);
    },
  );

  ipcMain.handle("agent:start", async (_event, options: AgentStartOptions) => {
    const tasksDir = path.resolve(path.join(userDataPath, "tasks"));
    const cwd = options.cwd ? path.resolve(options.cwd) : tasksDir;
    await fsp.mkdir(cwd, { recursive: true });
    if (
      options.resume &&
      agentHost!.isRunning() &&
      (!options.sessionPath || options.sessionPath === activeSessionPath)
    ) {
      return { ...(await agentHost!.snapshot()), cwd: activeAgentCwd ?? cwd };
    }
    activeAgentCwd = cwd;
    if (options.project || cwd !== tasksDir) await recentWorkspaces.touch(cwd);
    const {
      resume: _resume,
      sandbox: requestedSandbox,
      storagePath,
      ...startOptions
    } = options;
    let sessionPath = startOptions.sessionPath;
    if (sessionPath) {
      sessionPath = await ensureSessionRuntimeLink(
        sessionPath,
        storagePath || sessionPath,
      );
    }
    const sandbox =
      cwd === tasksDir
        ? "read-only"
        : requestedSandbox === "read-only"
          ? "workspace-write"
          : requestedSandbox;
    const storedUrl =
      startOptions.provider === "deepseek"
        ? getStoredDeepSeekBaseUrl()
        : undefined;
    const rawUrl = startOptions.baseUrl ?? storedUrl;
    // Keep DeepSeek vision credentials in sync with the chat DeepSeek key/base URL.
    await syncDeepSeekVisionConfig().catch(() => undefined);
    const profiles = await loadChatProfiles();
    const maxTokens =
      profiles.kind === "custom"
        ? (activeCustomProfile(profiles)?.maxTokens ?? 384_000)
        : undefined;
    const baseUrl = rawUrl ? apiBaseUrl(rawUrl) : undefined;
    const snapshot = await agentHost!.start({
      ...startOptions,
      ...(sessionPath ? { sessionPath } : {}),
      cwd,
      sandbox,
      visionExtension: visionExtensionPath(),
      visionConfig: visionConfigPath(),
      visionUploads: visionUploadsDir(),
      ...(baseUrl ? { baseUrl } : {}),
      ...(maxTokens ? { maxTokens } : {}),
    });
    activeSessionPath = sessionFileOf(snapshot);
    return { ...snapshot, cwd };
  });
  ipcMain.handle("agent:stop", () => {
    activeSessionPath = undefined;
    return agentHost!.stop();
  });
  ipcMain.handle(
    "agent:command",
    async (_event, type: string, data?: Record<string, unknown>) => {
      if (!ALLOWED_AGENT_COMMANDS.has(type))
        throw new Error(`Unsupported agent command: ${type}`);
      const result = await agentHost!.request(type, data);
      if (
        type === "new_session" ||
        type === "get_state" ||
        type === "get_session_stats"
      ) {
        const file = sessionFileFromUnknown(result);
        if (file) activeSessionPath = file;
      }
      return result;
    },
  );
  ipcMain.handle(
    "agent:ui-response",
    (_event, id: string, response: Record<string, unknown>) => {
      return agentHost!.respondToUi(id, response);
    },
  );
}

async function saveDefaultModel(
  providerId: string,
  modelId: string,
): Promise<void> {
  const settingsPath = path.join(getTetherHome(), "settings.json");
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(await fsp.readFile(settingsPath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    /* first write */
  }
  settings.defaultProvider = providerId;
  settings.defaultModel = modelId;
  await fsp.mkdir(path.dirname(settingsPath), { recursive: true, mode: 0o700 });
  await fsp.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, {
    mode: 0o600,
  });
}

async function readSettingsFile(): Promise<Record<string, unknown>> {
  const settingsPath = path.join(getTetherHome(), "settings.json");
  try {
    return JSON.parse(await fsp.readFile(settingsPath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

async function loadLocale(): Promise<Locale> {
  const settings = await readSettingsFile();
  const stored = typeof settings.locale === "string" ? settings.locale : null;
  const system =
    typeof app.getPreferredSystemLanguages === "function"
      ? app.getPreferredSystemLanguages()
      : [];
  appLocale = resolveLocale(stored, system);
  return appLocale;
}

async function saveLocale(locale: Locale): Promise<void> {
  const settingsPath = path.join(getTetherHome(), "settings.json");
  const settings = await readSettingsFile();
  settings.locale = locale;
  await fsp.mkdir(path.dirname(settingsPath), { recursive: true, mode: 0o700 });
  await fsp.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, {
    mode: 0o600,
  });
  appLocale = locale;
  installMenu();
}

function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

const recentFile = path.join(userDataPath, "recent-workspaces.json");
const recentWorkspaces = {
  async list(): Promise<WorkspaceItem[]> {
    try {
      const parsed = JSON.parse(
        await fsp.readFile(recentFile, "utf8"),
      ) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isWorkspaceItem).slice(0, 12);
    } catch {
      return [];
    }
  },
  async touch(workspacePath: string): Promise<string> {
    const resolved = path.resolve(workspacePath);
    const stat = await fsp.stat(resolved);
    if (!stat.isDirectory())
      throw new Error("Selected workspace is not a folder");
    const current = await this.list();
    const next = [
      {
        path: resolved,
        name: path.basename(resolved) || resolved,
        lastOpenedAt: new Date().toISOString(),
      },
      ...current.filter((item) => item.path !== resolved),
    ].slice(0, 12);
    await fsp.mkdir(path.dirname(recentFile), { recursive: true });
    await fsp.writeFile(recentFile, `${JSON.stringify(next, null, 2)}\n`, {
      mode: 0o600,
    });
    return resolved;
  },
  async forget(workspacePath: string): Promise<WorkspaceItem[]> {
    const next = (await this.list()).filter(
      (item) => item.path !== workspacePath,
    );
    await fsp.writeFile(recentFile, `${JSON.stringify(next, null, 2)}\n`, {
      mode: 0o600,
    });
    return next;
  },
};

async function servePreview(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const name = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  let target: string;
  if (url.host === UPLOADS_HOST) {
    // basename only: this host serves staged uploads, never an arbitrary path on disk.
    target = path.join(visionUploadsDir(), path.basename(name));
  } else {
    try {
      target = await resolveInWorkspace(name);
    } catch (error) {
      return new Response(
        error instanceof Error ? error.message : "Forbidden",
        { status: 403 },
      );
    }
  }
  try {
    return await net.fetch(pathToFileURL(target).toString());
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function visionConfigPath(): string {
  return path.join(userDataPath, "vision-config.json");
}

function chatProfilesPath(): string {
  return path.join(userDataPath, "chat-profiles.json");
}

async function loadChatProfiles(): Promise<ChatProfiles> {
  try {
    const parsed = parseChatProfiles(
      JSON.parse(await fsp.readFile(chatProfilesPath(), "utf8")),
    );
    if (parsed) return parsed;
  } catch {
    /* migrate from the single stored slot */
  }
  const stored = await (await createTetherCredentialStore()).read("deepseek");
  const apiKey =
    stored && stored.type === "api_key" && typeof stored.key === "string"
      ? stored.key
      : "";
  const selected = getStoredModelSelection();
  return migrateChatProfiles({
    url: getStoredDeepSeekBaseUrl() ?? "",
    model: selected?.providerId === "deepseek" ? (selected.modelId ?? "") : "",
    apiKey,
  });
}

async function saveChatProfiles(next: ChatProfiles): Promise<void> {
  const merged = mergeChatProfiles(await loadChatProfiles(), next);
  await fsp.mkdir(path.dirname(chatProfilesPath()), {
    recursive: true,
    mode: 0o700,
  });
  await fsp.writeFile(
    chatProfilesPath(),
    `${JSON.stringify(merged, null, 2)}\n`,
    { mode: 0o600 },
  );
  const chat = activeChat(merged);
  if (chat.apiKey) await saveProviderApiKey("deepseek", chat.apiKey);
  if (chat.url) await saveDeepSeekBaseUrl(chat.url.replace(/\/+$/, ""));
  if (chat.model) await saveDefaultModel("deepseek", chat.model);
}

function visionUploadsDir(): string {
  return path.join(userDataPath, "uploads");
}

function visionExtensionPath(): string {
  return path.join(currentDirectory, "../extensions/vision.js");
}

async function loadVisionConfig(): Promise<VisionConfig> {
  try {
    const raw = JSON.parse(
      await fsp.readFile(visionConfigPath(), "utf8"),
    ) as Partial<VisionConfig>;
    const settings = resolveVisionSettings(raw);
    const base: VisionConfig = {
      ...settings,
      apiKey: typeof raw.apiKey === "string" ? raw.apiKey.trim() : "",
    };
    if (base.provider === "deepseek")
      return materializeDeepSeekVision(base.apiKey);
    return base;
  } catch {
    return {
      ...DEFAULT_VISION_CONFIG,
      apiKey: process.env.ZHIPU_API_KEY?.trim() ?? "",
    };
  }
}

async function materializeDeepSeekVision(
  fallbackKey = "",
): Promise<VisionConfig> {
  const store = await createTetherCredentialStore();
  try {
    const profiles = await loadChatProfiles().catch(() => undefined);
    const stored = await store.read("deepseek");
    const storedKey =
      stored && stored.type === "api_key" && typeof stored.key === "string"
        ? stored.key.trim()
        : "";
    // Prefer an explicit vision key; only reuse chat DeepSeek key when chat is actually DeepSeek
    // (custom chat overwrites the same credential slot with a gateway key that official API rejects).
    const chatKey =
      profiles?.kind === "deepseek"
        ? profiles.deepseek.apiKey.trim() || storedKey
        : "";
    const key =
      fallbackKey.trim() ||
      chatKey ||
      process.env.DEEPSEEK_API_KEY?.trim() ||
      "";
    return resolveVisionRuntime(
      { provider: "deepseek", endpoint: "", model: "", apiKey: "" },
      { baseUrl: DEEPSEEK_VISION_BASE, apiKey: key },
    );
  } finally {
    // Credential store may hold file handles on some backends; ignore close failures.
  }
}

async function syncDeepSeekVisionConfig(): Promise<void> {
  const current = await loadVisionConfig();
  if (current.provider !== "deepseek") return;
  const next = await materializeDeepSeekVision(current.apiKey);
  await fsp.writeFile(
    visionConfigPath(),
    `${JSON.stringify(next, null, 2)}\n`,
    { mode: 0o600 },
  );
}

async function resolveInWorkspace(
  relativePath: string,
  workspacePath?: string,
): Promise<string> {
  const candidate =
    typeof workspacePath === "string" && workspacePath.trim()
      ? workspacePath
      : activeAgentCwd;
  if (!candidate) throw new Error("No workspace session is active");
  const root = path.resolve(candidate);
  const allowed =
    path.resolve(activeAgentCwd ?? "") === root ||
    (await recentWorkspaces.list()).some(
      (item) => path.resolve(item.path) === root,
    );
  if (!allowed) throw new Error("Folder is not an opened project");
  const resolved = path.resolve(root, relativePath);
  if (!isPathInsideRoot(root, resolved))
    throw new Error("Path outside workspace");
  // Lexical check alone loses to symlinks (e.g. workspace/link → ~/.ssh). Re-check after realpath.
  let realRoot: string;
  try {
    realRoot = await fsp.realpath(root);
  } catch {
    throw new Error("Workspace path is not accessible");
  }
  const realPath = await realpathExistingOrJoin(resolved);
  if (!isPathInsideRoot(realRoot, realPath))
    throw new Error("Path outside workspace");
  return resolved;
}

/** realpath(target), or realpath(nearest existing ancestor) + remaining segments for create paths. */
async function realpathExistingOrJoin(target: string): Promise<string> {
  try {
    return await fsp.realpath(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("Path outside workspace");
  }
  const parts: string[] = [];
  let cursor = target;
  while (true) {
    parts.unshift(path.basename(cursor));
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error("Path outside workspace");
    try {
      return path.join(await fsp.realpath(parent), ...parts);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("Path outside workspace");
      cursor = parent;
    }
  }
}

function sessionFileOf(snapshot: AgentSnapshot): string | undefined {
  return (
    sessionFileFromUnknown(snapshot.stats) ??
    sessionFileFromUnknown(snapshot.state)
  );
}

function sessionFileFromUnknown(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("sessionFile" in value))
    return undefined;
  return typeof value.sessionFile === "string" ? value.sessionFile : undefined;
}

function isWorkspaceItem(value: unknown): value is WorkspaceItem {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as WorkspaceItem).path === "string" &&
    typeof (value as WorkspaceItem).name === "string" &&
    typeof (value as WorkspaceItem).lastOpenedAt === "string",
  );
}

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-dev",
  "dist-production",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  ".vite",
  ".cache",
  ".tether",
  ".build",
  "DerivedData",
  "Pods",
  "__pycache__",
  ".pnpm-store",
]);

// ponytail: one recursive fs.watch, 200ms debounce. Ceiling: skip SKIP_DIRS/dotdirs; upgrade to chokidar if events drop on Linux/network FS.
function watchWorkspace(root: string): void {
  if (watchedWorkspace === root) return;
  workspaceWatcher?.close();
  workspaceWatcher = undefined;
  watchedWorkspace = root;
  try {
    workspaceWatcher = fs.watch(
      root,
      { persistent: false, recursive: true },
      (_event, filename) => {
        if (skipWatch(filename)) return;
        clearTimeout(watchTimer);
        watchTimer = setTimeout(() => {
          mainWindow?.webContents.send("workspace:changed", root);
        }, 200);
      },
    );
    workspaceWatcher.on("error", () => {
      workspaceWatcher?.close();
      workspaceWatcher = undefined;
      watchedWorkspace = "";
    });
  } catch {
    watchedWorkspace = "";
  }
}

function skipWatch(filename: string | null): boolean {
  if (!filename) return false;
  return filename
    .replaceAll("\\", "/")
    .split("/")
    .some(
      (part) =>
        SKIP_DIRS.has(part) || (part.startsWith(".") && part !== ".agents"),
    );
}

// ponytail: dirs always complete; files capped globally + per folder so DFS doesn't starve later siblings.
async function listWorkspaceFiles(
  root: string,
  fileLimit = 8000,
  perDirLimit = 200,
): Promise<string[]> {
  const dirs: string[] = [];
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort(
      (left, right) =>
        Number(right.isDirectory()) - Number(left.isDirectory()) ||
        left.name.localeCompare(right.name),
    );
    let localFiles = 0;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        dirs.push(
          `${path.relative(root, path.join(dir, entry.name)).replaceAll("\\", "/")}/`,
        );
        await walk(path.join(dir, entry.name));
        continue;
      }
      if (files.length >= fileLimit || localFiles >= perDirLimit) continue;
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      files.push(
        path.relative(root, path.join(dir, entry.name)).replaceAll("\\", "/"),
      );
      localFiles += 1;
    }
  }
  await walk(root);
  await addSkillManifests(root, files);
  return dirs.concat(files);
}

const SKILL_ROOTS = PROJECT_SKILL_ROOTS;

async function addSkillManifests(root: string, files: string[]): Promise<void> {
  const seen = new Set(files);
  for (const rel of SKILL_ROOTS) {
    let entries;
    try {
      entries = await fsp.readdir(path.join(root, rel), {
        withFileTypes: true,
      });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skill = `${rel}/${entry.name}/SKILL.md`;
      try {
        await fsp.stat(path.join(root, skill));
      } catch {
        continue;
      }
      if (!seen.has(skill)) {
        files.push(skill);
        seen.add(skill);
      }
    }
  }
  for (const extra of [".agents/features.json", ".agents/progress.md"]) {
    try {
      await fsp.stat(path.join(root, extra));
    } catch {
      continue;
    }
    if (!seen.has(extra)) {
      files.push(extra);
      seen.add(extra);
    }
  }
}

app.whenReady().then(async () => {
  await initializeTetherHome();
  await loadLocale();
  protocol.handle(PREVIEW_SCHEME, servePreview);
  registerIpc();
  installMenu();
  if (process.platform === "darwin") applyDockIcon();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let quitting = false;
app.on("before-quit", (event) => {
  if (quitting) return;
  // Always wait for stop on quit (Cmd+Q / Dock → Quit). macOS Seatbelt shells
  // are detached; skipping this leaves orphan `sh -lc` / find / rg processes.
  event.preventDefault();
  quitting = true;
  workspaceWatcher?.close();
  void Promise.resolve(agentHost?.stop())
    .catch(() => undefined)
    .finally(() => app.exit(0));
});
