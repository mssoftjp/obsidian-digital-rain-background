import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

const root = new URL("./", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const versions = JSON.parse(await readFile(new URL("versions.json", root), "utf8"));
const source = await readFile(new URL("src/main.js", root), "utf8");
const bundle = await readFile(new URL("dist/main.js", root), "utf8");
const styles = await readFile(new URL("styles.css", root), "utf8");
const readme = await readFile(new URL("README.md", root), "utf8");

assert.equal(manifest.id, "digital-rain-background");
assert.equal(manifest.name, "Digital Rain Background");
assert.equal(manifest.isDesktopOnly, false);
assert.equal(manifest.minAppVersion, "1.13.7");
assert.equal(packageJson.version, manifest.version);
assert.equal(versions[manifest.version], manifest.minAppVersion);
assert.doesNotMatch(readme, /musashino-software\/digital-rain-editor/);
assert.doesNotMatch(readme, /Zero Vault Access/);
assert.doesNotMatch(source, /textarea|contenteditable|editorCallback/);
assert.doesNotMatch(
  source,
  /\.setName\("Digital Rain Background"\)\s*\.setHeading\(\)/,
);
assert.match(source, /setAttribute\("aria-hidden", "true"\)/);
assert.match(source, /id: "toggle-background"/);
assert.match(source, /onLayoutReady\(\(\) => this\.syncRenderers\(\)\)/);
assert.match(source, /workspace\.on\("window-open"/);
assert.match(source, /requestAnimationFrame\(\(\) => this\.syncDocument\(ownerDocument\)\)/);
assert.match(source, /workspace\.on\("window-close"/);
assert.match(source, /workspace\.on\("css-change"/);
assert.match(source, /onExternalSettingsChange/);
assert.match(source, /prefers-reduced-motion: reduce/);
// The effect owns one palette, independent of Obsidian's light/dark mode.
assert.doesNotMatch(styles, /\.theme-(light|dark)/);
assert.doesNotMatch(styles, /var\(--digital-rain-theme-surface/);
assert.match(styles, /background: rgb\(0 8 5 \/ var\(--digital-rain-surface-opacity/);
assert.match(styles, /--minimal-tab-text-color-active: var\(--tx1\)/);
assert.match(styles, /--background-modifier-cover: rgb\(0 0 0 \/ 0\.68\)/);
assert.match(styles, /--input-text-bg-color: rgb\(9 36 22 \/ 0\.94\)/);
assert.match(styles, /--table-selection-blend-mode: normal/);
assert.match(styles, /--divider-color: rgb\(90 166 122 \/ 0\.22\)/);
assert.match(styles, /--setting-items-background: #050c08/);
assert.match(styles, /--titlebar-background-focused: #050c08/);
assert.match(styles, /\.prompt,/);
assert.match(styles, /\.modal\.mod-settings \.vertical-tab-header/);
assert.match(styles, /:is\(\.setting-items, \.setting-item\)/);
assert.match(
  styles,
  /enabled :is\(\.app-container, \.workspace\) \{[\s\S]*--background-primary: transparent[\s\S]*--ribbon-background: transparent[\s\S]*--status-bar-background: transparent/,
);
assert.match(styles, /enabled > \.workspace \{/);
assert.match(styles, /enabled \.view-header \{\s*background-color: transparent !important/);
assert.doesNotMatch(
  styles.match(/body\.digital-rain-background-enabled \{[^}]+\}/)?.[0] || "",
  /--background-primary: transparent/,
);

class Plugin {}
class PluginSettingTab {}
class Setting {}
const notices = [];
class Notice { constructor(message) { notices.push(message); } }
const sandbox = {
  module: { exports: {} },
  exports: {},
  require: (name) => {
    assert.equal(name, "obsidian");
    return { Notice, Plugin, PluginSettingTab, Setting, normalizePath: (path) => path.replace(/\\/g, "/").replace(/\/{2,}/g, "/") };
  },
  performance,
  Math,
  Map,
  Object,
  Number,
  String,
  RegExp,
  Error,
};

vm.runInNewContext(bundle, sandbox, { filename: "dist/main.js" });
const RainPlugin = sandbox.module.exports;
assert.equal(typeof RainPlugin, "function");
// Exercise startup with no data.json, as on a new installation.
const freshPlugin = new RainPlugin();
const handlers = new Map();
const disposers = [];
let layoutReady;
freshPlugin.loadData = async () => null;
freshPlugin.addSettingTab = () => {};
freshPlugin.addCommand = () => {};
freshPlugin.registerEvent = () => {};
freshPlugin.register = (dispose) => disposers.push(dispose);
freshPlugin.app = { workspace: {
  on: (name, callback) => { handlers.set(name, callback); },
  onLayoutReady: (callback) => { layoutReady = callback; },
} };
await freshPlugin.onload();
assert.equal(freshPlugin.settings.enabled, true);
let pendingOpen;
let cancelledOpen;
handlers.get("window-open")({ doc: {} }, {
  requestAnimationFrame: (callback) => { pendingOpen = callback; return 7; },
  cancelAnimationFrame: (id) => { cancelledOpen = id; },
});
freshPlugin.onunload();
for (const dispose of disposers) dispose();
layoutReady();
pendingOpen();
assert.equal(cancelledOpen, 7);
assert.equal(freshPlugin.renderers.size, 0);
assert.equal(RainPlugin.DEFAULT_SETTINGS.rainCellWidthEm, 0.62);
assert.equal(RainPlugin.DEFAULT_SETTINGS.rainLatinFill, 0.84);
assert.equal(RainPlugin.DEFAULT_SETTINGS.rainKanaFill, 0.74);
assert.equal(RainPlugin.DEFAULT_SETTINGS.surfaceOpacity, 0.84);
assert.equal(RainPlugin.DEFAULT_SETTINGS.rainIntensity, 1);
const minimalProfile = RainPlugin.detectThemeProfile(
  "rgb(40, 44, 52)",
  "var(--tx2)",
);
assert.equal(minimalProfile.surfaceColor, "rgb(40, 44, 52)");
assert.equal(minimalProfile.minimal, true);
const defaultProfile = RainPlugin.detectThemeProfile("rgba(0, 0, 0, 0)", "");
assert.equal(defaultProfile.surfaceColor, "#000805");
assert.equal(defaultProfile.minimal, false);
assert.doesNotMatch(source, /addDropdown/);
assert.doesNotMatch(source, /addTextArea/);
assert.doesNotMatch(source, /addColorPicker/);
assert.match(source, /settings-backup\.json/);
const normalized = RainPlugin.normalizeSettings({
  glyphWeight: 751,
  rainColor: "#FF00AA",
  enabled: false,
});
assert.equal(normalized.glyphWeight, 800);
assert.equal("rainColor" in normalized, false);
assert.equal(normalized.enabled, false);
for (const input of [null, undefined, [], false, 42, "invalid"]) {
  assert.deepEqual({ ...RainPlugin.normalizeSettings(input) }, { ...RainPlugin.DEFAULT_SETTINGS });
}
const bounded = RainPlugin.normalizeSettings({ speed: Infinity, density: -3, rainFontSize: 99 });
assert.equal(bounded.speed, 1);
assert.equal(bounded.density, 0.2);
assert.equal(bounded.rainFontSize, 24);
const plugin = new RainPlugin();
plugin.settings = normalized;
plugin.saveData = async (settings) => { plugin.savedSettings = settings; };
plugin.syncRenderers = () => { plugin.synced = true; };
plugin.manifest = { dir: ".obsidian/plugins/digital-rain-background" };
const files = new Map();
plugin.app = { vault: { adapter: {
  write: async (path, contents) => files.set(path, contents),
  read: async (path) => files.get(path),
  exists: async (path) => files.has(path),
} } };
const exported = plugin.exportSettings();
await plugin.importSettings(exported);
assert.equal("rainColor" in plugin.savedSettings, false);
assert.equal(plugin.synced, true);
const backupPath = await plugin.exportSettingsFile();
assert.equal(backupPath, ".obsidian/plugins/digital-rain-background/settings-backup.json");
plugin.settings.speed = 2;
await plugin.importSettingsFile();
assert.equal(plugin.settings.speed, 1);
await assert.rejects(() => plugin.importSettings('{"format":"another-plugin"}'));
await assert.rejects(() => plugin.importSettings('{"format":"digital-rain-background","version":2,"settings":{"speed":2}}'));
const previousSettings = plugin.settings;
plugin.saveData = async () => { throw new Error("disk full"); };
await assert.rejects(() => plugin.importSettings('{"speed":2}'), /disk full/);
assert.equal(plugin.settings, previousSettings);
await plugin.setSetting("speed", 1.5);
assert.match(notices.at(-1), /settings could not be saved.*disk full/);

const lifecyclePlugin = new RainPlugin();
lifecyclePlugin.settings = { ...RainPlugin.DEFAULT_SETTINGS };
lifecyclePlugin.renderers = new Map();
const events = [];
lifecyclePlugin.createRenderer = (ownerDocument) => ({
  start: () => events.push(["start", ownerDocument]),
  update: () => events.push(["update", ownerDocument]),
  destroy: () => events.push(["destroy", ownerDocument]),
});
const mainDocument = {};
const popoutDocument = {};
lifecyclePlugin.syncDocument(mainDocument);
lifecyclePlugin.syncDocument(mainDocument);
lifecyclePlugin.syncDocument(popoutDocument);
assert.equal(lifecyclePlugin.renderers.size, 2);
assert.equal(events.filter(([name]) => name === "start").length, 2);
lifecyclePlugin.collectDocuments = () => new Set([popoutDocument]);
lifecyclePlugin.syncRenderers();
assert.equal(lifecyclePlugin.renderers.size, 1);
assert.equal(events.some(([name, doc]) => name === "destroy" && doc === mainDocument), true);
lifecyclePlugin.settings.enabled = false;
lifecyclePlugin.syncRenderers();
assert.equal(lifecyclePlugin.renderers.size, 0);
lifecyclePlugin.settings.enabled = true;
lifecyclePlugin.onunload();
lifecyclePlugin.syncDocument(mainDocument);
lifecyclePlugin.syncRenderers();
assert.equal(lifecyclePlugin.renderers.size, 0, "delayed callbacks must not restart an unloaded plugin");

const externalPlugin = new RainPlugin();
externalPlugin.loadData = async () => ({ speed: 1.75 });
externalPlugin.syncRenderers = () => { externalPlugin.synced = true; };
await externalPlugin.onExternalSettingsChange();
assert.equal(externalPlugin.settings.speed, 1.75);
assert.equal(externalPlugin.synced, true);

const fakeResize = {
  window: { innerWidth: 100, innerHeight: 50, devicePixelRatio: 2 },
  width: 100,
  height: 50,
  dpr: 1,
  canvas: { style: {} },
  context: { setTransform: (...args) => { fakeResize.transform = args; }, fillRect: () => {} },
  rebuild: () => { fakeResize.rebuilt = true; },
};
RainPlugin.MatrixRain.prototype.resize.call(fakeResize);
assert.equal(fakeResize.dpr, 1.5);
assert.equal(fakeResize.canvas.width, 150);
assert.equal(fakeResize.rebuilt, true);

const pausedFrame = {
  frameId: 42,
  pausedAt: 100,
  lastRender: 0,
  render: () => { pausedFrame.rendered = true; },
  requestFrame: () => { pausedFrame.requested = true; },
};
RainPlugin.MatrixRain.prototype.frame.call(pausedFrame, 200);
assert.equal(pausedFrame.frameId, 0);
assert.equal(pausedFrame.rendered, undefined);
assert.equal(pausedFrame.requested, undefined);

const rain = Object.create(RainPlugin.MatrixRain.prototype);
let clock = 0;
let scheduled = 0;
rain.now = () => clock;
rain.window = { requestAnimationFrame: () => ++scheduled, cancelAnimationFrame: () => {} };
rain.document = { hidden: false, hasFocus: () => true };
rain.motionQuery = { matches: false };
rain.pausedAt = null;
rain.frameId = 1;
rain.columns = [];
rain.pause();
assert.equal(rain.pausedAt, 0, "zero is a valid pause timestamp");
rain.requestFrame();
assert.equal(scheduled, 0);
clock = 100;
rain.resume();
assert.equal(scheduled, 1);
rain.pause();
rain.width = 100;
rain.height = 50;
rain.settings = { ...RainPlugin.DEFAULT_SETTINGS };
rain.grid = {};
rain.scale = {};
let paints = 0;
rain.context = { clearRect: () => {} };
rain.render = () => paints++;
clock = 1000;
rain.rebuild();
assert.equal(paints, 1, "paused/reduced-motion backgrounds must redraw after rebuilding");
assert.equal(rain.pausedAt, 1000);
const advance = rain.columns[0].lastAdvance;
clock = 1100;
rain.resume();
assert.equal(rain.columns[0].lastAdvance, advance + 100, "only compensate time since the rebuild");
assert.doesNotThrow(() => RainPlugin.runRainSelfCheck());

console.log("Digital Rain Background self-check passed");
