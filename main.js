const fs = require("fs");
const path = require("path");
const { BrowserWindow, ipcMain, webContents, shell } = require("electron");

const isDebug = process.argv.includes("--scriptio-debug");
const updateInterval = 1000;
const ignoredFolders = new Set(["node_modules"]);
const log = isDebug ? console.log.bind(console, "\x1b[38;2;0;72;91m%s\x1b[0m", "[Scriptio]") : () => { };
let devMode = false;
let watcher = null;

const dataPath = LiteLoader.plugins.scriptio.path.data;
const scriptPath = path.join(dataPath, "scripts");
const CHARTSET_RE = /(?:charset|encoding)\s{0,10}=\s{0,10}['"]? {0,10}([\w\-]{1,100})/i;

// 创建 scripts 目录 (如果不存在)
if (!fs.existsSync(scriptPath)) {
    log(`${scriptPath} does not exist, creating...`);
    fs.mkdirSync(scriptPath, { recursive: true });
}
// 监听
ipcMain.on("LiteLoader.scriptio.rendererReady", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    loadScripts(window.webContents);
});
ipcMain.on("LiteLoader.scriptio.reload", reload);
ipcMain.on("LiteLoader.scriptio.importScript", (event, fname, content) => {
    importScript(fname, content);
});
ipcMain.on("LiteLoader.scriptio.open", (event, type, uri) => {
    log("open", type, uri);
    switch (type) {
        case "link":
            shell.openExternal(uri);
            break;
        case "path":
            shell.openPath(path.normalize(uri));
            break;
        case "show":
            shell.showItemInFolder(path.normalize(uri));
            break;
        default:
            break;
    }
});
ipcMain.on("LiteLoader.scriptio.configChange", onConfigChange);
ipcMain.on("LiteLoader.scriptio.devMode", onDevMode);
ipcMain.handle("LiteLoader.scriptio.queryDevMode", async (event) => {
    log("queryDevMode", devMode);
    return devMode;
});
ipcMain.handle("LiteLoader.scriptio.queryIsDebug", (event) => {
    log("queryIsDebug", isDebug);
    return isDebug;
});
ipcMain.handle("LiteLoader.scriptio.fetchText", async (event, ...args) => {
    log("fetch", ...args);
    try {
        // Firing a HEAD request to check the content type
        const head = await fetch(args[0], { method: "HEAD" });
        const headContentType = head.headers.get("Content-Type");
        // Judge the content type should be text
        if (headContentType && !headContentType.startsWith("text")) {
            log(`"${args[0]}" is not text, content type: ${headContentType}`); // Not text, return empty string
            return ""; // Not text, return empty string
        }
        // Actually firing the request
        const r = await fetch(...args);
        // Detect charset from response header. Adapted from https://github.com/node-modules/charset/blob/master/index.js
        const contentType = r?.headers?.get("Content-Type");
        const match = contentType?.match(CHARTSET_RE);
        const charset = match ? match[1].toLowerCase() : "utf-8";
        log(`Charset of "${args[0]}": ${charset}`);
        const buffer = await r.arrayBuffer();
        const decoder = new TextDecoder(charset);
        const text = decoder.decode(buffer);
        return text;
    } catch (err) {
        log("fetch error", err);
        return "";
    }
});

// 防抖
function debounce(fn, time) {
    const timer = null;
    return function (...args) {
        timer && clearTimeout(timer);
        timer = setTimeout(() => {
            fn.apply(this, args);
        }, time);
    }
}

// 标准化路径 (Unix style)
function normalize(path) {
    return path.replace(":\\", "://").replaceAll("\\", "/");
}

function listJS(dir) {
    log("listJS", dir);
    function walk(dir, files = []) {
        const dirFiles = fs.readdirSync(dir);
        for (const f of dirFiles) {
            const stat = fs.lstatSync(dir + "/" + f);
            if (stat.isDirectory()) {
                if (!ignoredFolders.has(f) && !f.startsWith(".")) { // Ignore given folders and hidden folders
                    walk(dir + "/" + f, files);
                }
            } else if (f.endsWith(".js")) {
                files.push(normalize(dir + "/" + f));
            } else if (f.endsWith(".lnk") && shell.readShortcutLink) { // lnk file & on Windows
                const { target } = shell.readShortcutLink(dir + "/" + f);
                if (target.endsWith(".js")) {
                    files.push(normalize(target));
                }
            }
        }
        return files;
    }
    return walk(dir);
}

// 获取 JS 文件头的注释，返回为数组
function getComments(code) {
    const lines = code.split("\n");
    const comments = [];
    for (let line of lines) {
        line = line.trim();
        if (line.startsWith("//")) {
            comments.push(line.slice(2).trim());
        } else {
            break;
        }
    }
    return comments.slice(0, 2); // 目前只考虑前两行
}

// 获取 JS 文件内容
function getScript(absPath) {
    try {
        return fs.readFileSync(absPath, "utf-8");
    } catch (err) {
        return "";
    }
}

// 脚本更改
function updateScript(absPath, webContent) {
    const content = getScript(absPath);
    if (!content) return;
    const comments = getComments(content);
    let comment = comments[0] || "";
    let runAts = comments[1] || "";
    let enabled = true;
    if (comment.endsWith("[Disabled]")) {
        comment = comment.slice(0, -10).trim();
        enabled = false;
    }
    if (runAts.toLowerCase().startsWith("@run-at ")) {
        runAts = runAts.slice(8).split(",")
            .map((item) => item.trim())
            .filter((item) => item);
    } else {
        runAts = [];
    }
    log("updateScript", absPath, enabled, comment, runAts);
    if (webContent) {
        webContent.send("LiteLoader.scriptio.updateScript", [absPath, content, enabled, comment, runAts]);
    } else {
        webContents.getAllWebContents().forEach((webContent) => {
            webContent.send("LiteLoader.scriptio.updateScript", [absPath, content, enabled, comment, runAts]);
        });
    }
}

// 重载所有窗口
function reload(event) {
    // 若有，关闭发送者窗口 (设置界面)
    if (event && event.sender) {
        const win = BrowserWindow.fromWebContents(event.sender);
        win.close();
    }
    BrowserWindow.getAllWindows().forEach((window) => {
        window.reload();
    });
}

// 载入脚本
function loadScripts(webContent) {
    log("loadScripts");
    for (const absPath of listJS(scriptPath)) {
        updateScript(absPath, webContent);
    }
}

// 导入脚本
function importScript(fname, content) {
    log("importScript", fname);
    const filePath = path.join(scriptPath, fname);
    fs.writeFileSync(filePath, content, "utf-8");
    if (!devMode) {
        updateScript(fname);
    }
}

// 监听 `scripts` 目录修改
function onScriptChange(eventType, filename) {
    log("onScriptChange", eventType, filename);
    reload();
}

// 监听配置修改
function onConfigChange(event, absPath, enable) {
    log("onConfigChange", absPath, enable);
    let content = getScript(absPath);
    let comment = getComments(content)[0] || "";
    const current = (comment === null) || !comment.endsWith("[Disabled]");
    if (current === enable) return;
    if (comment === null) {
        comment = "";
    } else {
        content = content.split("\n").slice(1).join("\n");
    }
    if (enable) {
        comment = comment.slice(0, -11);
    } else {
        comment += " [Disabled]";
    }
    content = `// ${comment}\n` + content;
    fs.writeFileSync(absPath, content, "utf-8");
    if (!devMode) {
        updateScript(absPath);
    }
}

// 监听开发者模式开关
function onDevMode(event, enable) {
    log("onDevMode", enable);
    devMode = enable;
    if (enable && !watcher) {
        watcher = watchScriptChange();
        log("watcher created");
    } else if (!enable && watcher) {
        watcher.close();
        watcher = null;
        log("watcher closed");
    }
}

// 监听目录更改
function watchScriptChange() {
    return fs.watch(scriptPath, "utf-8",
        debounce(onScriptChange, updateInterval)
    );
}
