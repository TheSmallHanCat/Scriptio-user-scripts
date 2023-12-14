const scriptIdPrefix = "scriptio-script-";
const configIdPrefix = "scriptio-config-";
const eventTogglePrefix = "scriptio-toggle-";
// Normalized plugin path
const pluginPath = LiteLoader.plugins.scriptio.path.plugin.replace(":\\", "://").replaceAll("\\", "/");
let isDebug = false;
let log = () => { }; // Dummy function

// Get page
const pagePromise = new Promise((resolve, reject) => {
    let page = window.location.hash.slice(2).split("/")[0];
    if (page && page !== "blank") {
        log("Page is:", page);
        resolve(page);
    } else {
        log("Waiting for navigation...");
        navigation.addEventListener("navigatesuccess", () => {
            page = window.location.hash.slice(2).split("/")[0];
            log("Page is:", page);
            resolve(page);
        }, { once: true });
    }
});
// Helper function for js
function injectJS(name, code, enabled) {
    let current = document.getElementById(scriptIdPrefix + name);
    if (!current && enabled) {
        current = document.createElement("script");
        current.id = scriptIdPrefix + name;
        current.textContent = code;
        document.body.appendChild(current);
    }
    window.dispatchEvent(new CustomEvent(eventTogglePrefix + name, {
        detail: {
            enabled: enabled
        }
    }));
    return true;
}
function test(name, code, enabled, page, runAts) {
    log(`name: ${name}, page: ${page}, runAts: ${runAts}`);
    if (!runAts.length || runAts.includes(page)) {
        injectJS(name, code, enabled);
        return true;
    } else if (page !== "blank") {
        if (runAts.includes(page)) {
            injectJS(name, code, enabled);
            return true;
        }
    }
    return false;
}
function scriptHelper(name, code, enabled, comment, runAts) {
    pagePromise.then(page => {
        const result = test(name, code, enabled, page, runAts);
        log(`"${name}" injected? ${result}`);
    });
}
async function onLoad() {
    scriptio.onUpdateScript((event, args) => {
        scriptHelper(...args);
    });
    scriptio.rendererReady();
    scriptio.queryIsDebug().then(enabled => {
        isDebug = enabled;
        if (isDebug) {
            log = console.log.bind(console, "[Scriptio]");
            log("Debug mode activated");
        }
    });
}
async function onConfigView(view) {
    const r = await fetch(`llqqnt://local-file/${pluginPath}/settings.html`);
    view.innerHTML = await r.text();
    const container = view.querySelector("section.snippets > div.wrap");
    function addItem(name) { // Add a list item with name and description, returns the switch
        const divider = document.createElement("hr");
        divider.className = "horizontal-dividing-line";
        divider.id = configIdPrefix + name + "-divider";
        container.appendChild(divider);
        const item = document.createElement("div");
        item.className = "vertical-list-item";
        item.id = configIdPrefix + name + "-item";
        container.appendChild(item);
        const left = document.createElement("div");
        item.appendChild(left);
        const h2 = document.createElement("h2");
        h2.textContent = name;
        left.appendChild(h2);
        const span = document.createElement("span");
        span.className = "secondary-text";
        left.appendChild(span);
        const switch_ = document.createElement("div");
        switch_.className = "q-switch";
        switch_.id = configIdPrefix + name;
        item.appendChild(switch_);
        const span2 = document.createElement("span");
        span2.className = "q-switch__handle";
        switch_.appendChild(span2);
        switch_.addEventListener("click", () => {
            switch_.parentNode.classList.toggle("is-loading", true);
            scriptio.configChange(name, switch_.classList.toggle("is-active")); // Update the UI immediately, so it would be more smooth
        });
        return switch_;
    }
    scriptio.onUpdateScript((event, args) => {
        const [name, code, enabled, comment] = args;
        const switch_ = view.querySelector("#" + configIdPrefix + name)
            || addItem(name);
        switch_.classList.toggle("is-active", enabled);
        switch_.parentNode.classList.toggle("is-loading", false);
        const span = view.querySelector(`div#${configIdPrefix}${name}-item > div > span.secondary-text`);
        span.textContent = comment || "* 此文件没有描述";
        if (span.textContent.startsWith("* ")) {
            span.title = "对此脚本的更改将在重载后生效";
        } else {
            span.title = "";
        }
        log("onUpdateScript", name, enabled);
    });
    function $(prop) { // Helper function for scriptio selectors
        return view.querySelector(`#scriptio-${prop}`);
    }
    function devMode() {
        const enabled = this.classList.toggle("is-active");
        scriptio.devMode(enabled);
    }
    function openURI(type, uri) {
        console.log("[Scriptio] Opening", type, uri);
        scriptio.open(type, uri);
    }
    function openURL() {
        const url = this.getAttribute("data-scriptio-url");
        openURI("link", url);
    }
    async function importScript() {
        if (this.files.length == 0) return; // No file selected
        this.parentNode.classList.toggle("is-loading", true);
        let cnt = 0;
        const promises = [];
        for (let file of this.files) {
            if (!file.name.endsWith(".js")) {
                console.log("[Scriptio] Ignored", file.name);
                continue;
            }
            promises.push(new Promise((resolve, reject) => {
                cnt++;
                console.log("[Scriptio] Importing", file.name);
                let reader = new FileReader();
                reader.onload = () => {
                    scriptio.importScript(file.name, reader.result);
                    console.log("[Scriptio] Imported", file.name);
                    resolve();
                };
                reader.readAsText(file);
            }));
        }
        await Promise.all(promises);
        this.parentNode.classList.toggle("is-loading", false);
        console.log("[Scriptio] Imported", cnt, "files");
        if (cnt > 0) {
            alert(`成功导入 ${cnt} 个 JS 文件`);
        } else {
            alert("没有导入任何 JS 文件");
        }
    }
    scriptio.rendererReady(); // We don't have to create a new function for this 😉
    const dev = $("dev");
    dev.addEventListener("click", devMode);
    scriptio.queryDevMode().then(enabled => {
        log("queryDevMode", enabled);
        dev.classList.toggle("is-active", enabled);
    });
    if (isDebug) {
        const debug = $("debug");
        debug.style.color = "red";
        debug.title = "Debug 模式已激活";
    }
    $("reload").addEventListener("dblclick", scriptio.reload);
    $("open-folder").addEventListener("click", () => {
        openURI("folder", "scripts"); // Relative to the data directory
    });
    $("import").addEventListener("change", importScript);
    // About - Version
    $("version").textContent = LiteLoader.plugins.scriptio.manifest.version;
    view.querySelectorAll(".scriptio-link").forEach(link => {
        if (!link.getAttribute("title")) {
            link.setAttribute("title", link.getAttribute("data-scriptio-url"));
        }
        link.addEventListener("click", openURL);
    });
    // About - Backgroud image
    ["version", "author", "issues", "submit"].forEach(id => {
        $(`about-${id}`).style.backgroundImage = `url("llqqnt://local-file/${pluginPath}/icons/${id}.svg")`;
    });
}

export {
    onLoad,
    onConfigView
}