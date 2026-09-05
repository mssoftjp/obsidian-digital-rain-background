const { Notice, Plugin, PluginSettingTab, Setting, normalizePath } = require("obsidian");

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  speed: 1,
  density: 1,
  rainFontSize: 14,
  rainCellWidthEm: 0.62,
  rainLatinFill: 0.84,
  rainKanaFill: 0.74,
  glyphWeight: 700,
  kanaWeight: 800,
  bloom: 1.55,
  mirrorRate: 0.92,
  surfaceOpacity: 0.84,
  rainIntensity: 1,
});

const MATRIX_COLOR = [49, 220, 139];

const SLIDER_SETTINGS = [
  ["Speed", "speed", 0.2, 2.5, 0.05],
  ["Density", "density", 0.2, 1.8, 0.05],
  ["Rain font size", "rainFontSize", 9, 24, 1],
  ["Rain cell width", "rainCellWidthEm", 0.45, 0.9, 0.01],
  ["Latin fill", "rainLatinFill", 0.55, 1.05, 0.01],
  ["Kana fill", "rainKanaFill", 0.5, 1.05, 0.01],
  ["Latin weight", "glyphWeight", 400, 900, 100],
  ["Kana weight", "kanaWeight", 400, 900, 100],
  ["Glow", "bloom", 0.5, 2.8, 0.05],
  ["Rain intensity", "rainIntensity", 0.25, 2, 0.05],
  ["Mirror rate", "mirrorRate", 0, 1, 0.02],
  ["Uniform interface opacity", "surfaceOpacity", 0.35, 0.9, 0.01],
];

const MATRIX_KANA = [..."ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ"];
const GLYPHS = [
  ...MATRIX_KANA,
  ...MATRIX_KANA,
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ..."0123456789",
  ..."*+:=.<>\"|_¦",
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const normalizeSettings = (input = {}) => {
  const settings = { ...DEFAULT_SETTINGS };
  if (!input || typeof input !== "object" || Array.isArray(input)) return settings;
  if (typeof input.enabled === "boolean") settings.enabled = input.enabled;
  for (const [, key, min, max, step] of SLIDER_SETTINGS) {
    const value = input[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const precision = (String(step).split(".")[1] || "").length;
    const snapped = min + Math.round((value - min) / step) * step;
    settings[key] = Number(clamp(snapped, min, max).toFixed(precision));
  }
  return settings;
};
const randomBetween = (min, max) => min + Math.random() * (max - min);
const isHalfKana = (character) => {
  const codePoint = character.codePointAt(0) || 0;
  return codePoint >= 0xff61 && codePoint <= 0xff9f;
};
const isLatinLike = (character) => /^[A-Za-z0-9]$/.test(character);
const isAsciiPunctuation = (character) =>
  /^[\x20-\x7E]$/.test(character) && !isLatinLike(character);
const detectThemeProfile = (backgroundColor, minimalMarker) => ({
  surfaceColor:
    backgroundColor && !/^rgba?\(0(?:,?\s*0){2}(?:,?\s*0)?\)$/.test(backgroundColor)
      ? backgroundColor
      : "#000805",
  minimal: Boolean(minimalMarker && minimalMarker.trim()),
});

class MatrixColumn {
  constructor(rain, index) {
    this.rain = rain;
    this.index = index;
    this.enabled =
      Math.random() <
      Math.min(1, 0.96 * Math.min(Math.max(0.01, rain.settings.density), 1));
    this.extra =
      rain.settings.density > 1 &&
      Math.random() < Math.min(0.9, (rain.settings.density - 1) * 0.8);
    this.restart(true);
  }

  restart(initial = false) {
    const { rows } = this.rain.grid;
    this.head = initial
      ? Math.floor(randomBetween(-rows * 0.8, rows * 0.95))
      : -Math.floor(randomBetween(1, rows * 0.45));
    this.length = Math.max(
      5,
      Math.round(rows * 0.43 * randomBetween(0.64, 1.34)),
    );
    this.expireAt =
      Math.random() < 0.8
        ? Math.floor(randomBetween(rows * 0.25, rows * 0.93))
        : rows + this.length;
    this.stopped = false;
    this.done = false;
    this.lastAdvance = this.rain.now() - randomBetween(0, this.tickMs());
    this.cells = new Map();
    this.whiteMap = new Map();
    this.hiddenPrefix =
      Math.random() < 0.09
        ? Math.floor(randomBetween(1, Math.max(2, rows * 0.34)))
        : 0;
    this.visibleSteps = 0;

    if (this.enabled) {
      const seedLength = initial
        ? Math.floor(randomBetween(this.length * 0.45, this.length))
        : 0;
      for (let offset = seedLength; offset >= 0; offset -= 1) {
        const row = this.head - offset;
        if (row >= 0 && row < rows) this.makeCell(row);
      }
    }
  }

  tickMs() {
    const { settings, grid, height } = this.rain;
    const rowsPerSecond =
      ((0.19 * height) / grid.ch) * Math.max(0.05, settings.speed);
    return 1000 / Math.max(0.1, rowsPerSecond);
  }

  makeCell(row) {
    if (row < 0 || row >= this.rain.grid.rows) return;
    const cell = {
      glyph: "",
      nextMutation:
        this.rain.now() + randomBetween(260, 1700) / this.rain.settings.speed,
      shade: randomBetween(0.61, 1.45),
      flipX: false,
      flipY: false,
      inkScale: 1,
      nudgeX: 0,
    };
    this.rain.orientCellGlyph(cell, this.rain.pickGlyph());
    this.cells.set(row, cell);
    if (Math.random() < 0.006) {
      this.whiteMap.set(row, this.rain.now() + randomBetween(90, 245));
    }
  }

  step(now) {
    if (!this.enabled) return;
    if (this.done) this.restart(false);

    const tick = this.tickMs() * randomBetween(0.985, 1.015);
    let guard = 0;
    while (now - this.lastAdvance >= tick && guard < 6) {
      guard += 1;
      this.lastAdvance += tick;

      if (!this.stopped) {
        this.head += 1;
        this.visibleSteps += 1;
        if (this.visibleSteps > this.hiddenPrefix) this.makeCell(this.head);
        if (this.head >= this.expireAt) this.stopped = true;
      }

      const tail = this.head - this.length;
      for (const row of this.cells.keys()) {
        if (row < tail) this.cells.delete(row);
      }
      for (const row of this.whiteMap.keys()) {
        if (row < tail) this.whiteMap.delete(row);
      }

      if (this.stopped) {
        this.length -= 1;
        if (this.length <= 0 || this.cells.size === 0) {
          this.done = true;
          break;
        }
      }
    }

    for (const cell of this.cells.values()) {
      if (now >= cell.nextMutation) {
        if (Math.random() < 0.72) {
          this.rain.orientCellGlyph(cell, this.rain.pickGlyph());
        }
        cell.nextMutation =
          now + randomBetween(320, 2100) / this.rain.settings.speed;
      }
    }
    if (this.done) this.restart(false);
  }

  draw(context, now) {
    if (!this.enabled) return;
    const { grid, settings, height } = this.rain;
    const x = this.index * grid.cw;
    context.textBaseline = "top";
    context.textAlign = "center";

    for (const [row, cell] of this.cells) {
      const y = row * grid.ch;
      if (y < -settings.rainFontSize || y > height + settings.rainFontSize) {
        continue;
      }

      const distance = this.head - row;
      const trail = clamp(1 - distance / Math.max(1, this.length), 0, 1);
      const alpha = (0.09 + 0.34 * trail) * cell.shade;
      if (row === this.head) {
        context.fillStyle = this.rain.color(
          0.75,
          Math.min(0.9, 0.44 + alpha * 0.68),
        );
        context.shadowBlur = 14 * settings.bloom;
        context.shadowColor = this.rain.color(0.1, 0.68);
      } else if ((this.whiteMap.get(row) || 0) > now) {
        context.fillStyle = this.rain.color(
          0.55,
          Math.min(0.84, 0.38 + alpha * 0.72),
        );
        context.shadowBlur = 12 * settings.bloom;
        context.shadowColor = this.rain.color(0.02, 0.61);
      } else {
        context.fillStyle = this.rain.color(0, Math.min(0.68, alpha));
        context.shadowBlur = 7.2 * settings.bloom;
        context.shadowColor = this.rain.color(-0.12, 0.42);
      }
      this.rain.paintGlyph(context, cell, x, y);
    }

    context.shadowBlur = 0;
    if (this.extra) {
      context.globalAlpha = 0.34;
      context.fillStyle = this.rain.color(-0.22, 0.16);
      for (const [row, cell] of this.cells) {
        if ((row + this.index) % 3 === 0) {
          this.rain.paintGlyph(
            context,
            cell,
            x + grid.cw * 0.42,
            row * grid.ch + grid.ch * 0.24,
          );
        }
      }
      context.globalAlpha = 1;
    }
  }
}

class MatrixRain {
  constructor(document, settings) {
    this.document = document;
    this.window = document.defaultView;
    this.settings = settings;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "digital-rain-background-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.setAttribute("role", "presentation");
    this.context = this.canvas.getContext("2d");
    if (!this.context) throw new Error("Digital Rain Background needs Canvas 2D support.");
    this.grid = { cw: 8, ch: 12, cols: 0, rows: 0 };
    this.columns = [];
    this.scale = { latin: 0, kana: 0 };
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.lastRender = 0;
    this.pausedAt = null;
    this.frameId = 0;
    this.themeRefreshId = 0;
    this.themeSignature = "";
    this.motionQuery = this.window.matchMedia?.("(prefers-reduced-motion: reduce)");
    this.frame = this.frame.bind(this);
    this.handleResize = this.resize.bind(this);
    this.handleBlur = this.pause.bind(this);
    this.handleFocus = this.resume.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.handleMotionChange = this.handleMotionChange.bind(this);
    this.scheduleThemeRefresh = this.scheduleThemeRefresh.bind(this);
  }

  now() {
    return this.window.performance.now();
  }

  start() {
    this.document.body.prepend(this.canvas);
    this.refreshTheme();
    this.document.body.classList.add("digital-rain-background-enabled");
    this.observeTheme();
    this.applyVisualSettings();
    this.resize();
    this.window.addEventListener("resize", this.handleResize);
    this.window.addEventListener("blur", this.handleBlur);
    this.window.addEventListener("focus", this.handleFocus);
    this.document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.motionQuery?.addEventListener("change", this.handleMotionChange);
    const now = this.now();
    this.lastRender = now;
    this.render(now);
    if (this.motionQuery?.matches || this.document.hidden || !this.document.hasFocus()) this.pausedAt = now;
    else this.requestFrame();
  }

  destroy() {
    if (this.frameId) this.window.cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.canvas.remove();
    this.themeObserver?.disconnect();
    this.window.removeEventListener("resize", this.handleResize);
    this.window.removeEventListener("blur", this.handleBlur);
    this.window.removeEventListener("focus", this.handleFocus);
    this.document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.motionQuery?.removeEventListener("change", this.handleMotionChange);
    if (this.themeRefreshId) this.window.clearTimeout(this.themeRefreshId);
    this.document.body.classList.remove(
      "digital-rain-background-enabled",
      "digital-rain-theme-minimal",
    );
    this.document.body.style.removeProperty("--digital-rain-surface-opacity");
    this.document.body.style.removeProperty("--digital-rain-blur");
    this.document.body.style.removeProperty("--digital-rain-theme-surface");
  }

  observeTheme() {
    this.themeSignature = this.currentThemeSignature();
    this.themeObserver = new this.window.MutationObserver(() => {
      const nextSignature = this.currentThemeSignature();
      if (nextSignature !== this.themeSignature) {
        this.themeSignature = nextSignature;
        this.scheduleThemeRefresh();
      }
    });
    this.themeObserver.observe(this.document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  currentThemeSignature() {
    return [...this.document.body.classList]
      .filter(
        (name) =>
          name === "theme-dark" ||
          name === "theme-light" ||
          name.startsWith("minimal-"),
      )
      .sort()
      .join(" ");
  }

  scheduleThemeRefresh() {
    if (this.themeRefreshId) this.window.clearTimeout(this.themeRefreshId);
    this.themeRefreshId = this.window.setTimeout(() => {
      this.themeRefreshId = 0;
      this.refreshTheme();
    }, 50);
  }

  refreshTheme() {
    const body = this.document.body;
    const wasEnabled = body.classList.contains("digital-rain-background-enabled");
    body.classList.remove(
      "digital-rain-background-enabled",
      "digital-rain-theme-minimal",
    );
    const probe = this.document.createElement("div");
    probe.className = "digital-rain-theme-probe";
    body.append(probe);
    const probeStyle = this.window.getComputedStyle(probe);
    const bodyStyle = this.window.getComputedStyle(body);
    const profile = detectThemeProfile(
      probeStyle.backgroundColor,
      bodyStyle.getPropertyValue("--minimal-tab-text-color"),
    );
    probe.remove();
    body.style.setProperty("--digital-rain-theme-surface", profile.surfaceColor);
    body.classList.toggle("digital-rain-theme-minimal", profile.minimal);
    if (wasEnabled) body.classList.add("digital-rain-background-enabled");
  }

  update(settings) {
    this.settings = settings;
    this.applyVisualSettings();
    this.rebuild();
  }

  applyVisualSettings() {
    this.baseColor = MATRIX_COLOR;
    this.document.body.style.setProperty(
      "--digital-rain-surface-opacity",
      String(clamp(this.settings.surfaceOpacity, 0.35, 0.9)),
    );
    const blur = Math.max(0, (this.settings.bloom - 0.5) * 0.65);
    this.document.body.style.setProperty("--digital-rain-blur", `${blur.toFixed(2)}px`);
  }

  resize() {
    const width = this.window.innerWidth;
    const height = this.window.innerHeight;
    const dpr = clamp(this.window.devicePixelRatio || 1, 1, 1.5);
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.floor(width * this.dpr);
    this.canvas.height = Math.floor(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.context.fillStyle = "rgb(0,3,2)";
    this.context.fillRect(0, 0, width, height);
    this.rebuild();
  }

  rebuild() {
    if (!this.width || !this.height) return;
    this.grid.cw = Math.max(
      4.5,
      this.settings.rainFontSize * this.settings.rainCellWidthEm * 0.96,
    );
    this.grid.ch = Math.max(7, this.settings.rainFontSize * 0.88);
    this.grid.cols = Math.ceil(this.width / this.grid.cw) + 1;
    this.grid.rows = Math.ceil(this.height / this.grid.ch) + 1;
    this.scale.latin = 0;
    this.scale.kana = 0;
    this.columns = Array.from(
      { length: this.grid.cols },
      (_, index) => new MatrixColumn(this, index),
    );
    // New columns use current timestamps, even when rebuilt during a pause.
    const now = this.now();
    if (this.pausedAt !== null) this.pausedAt = now;
    this.context.clearRect(0, 0, this.width, this.height);
    this.render(now);
  }

  pickGlyph() {
    return Math.random() < 0.16
      ? " "
      : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
  }

  orientCellGlyph(cell, glyph) {
    const kana = isHalfKana(glyph);
    const latin = isLatinLike(glyph);
    const mirrorProbability = kana
      ? this.settings.mirrorRate
      : this.settings.mirrorRate * (latin ? 0.52 : 0.3);
    cell.glyph = glyph;
    cell.flipX = Math.random() < mirrorProbability;
    cell.flipY = !kana && Math.random() < 0.07;
    cell.inkScale = randomBetween(0.94, 1.06);
    cell.nudgeX = randomBetween(-0.32, 0.32);
  }

  kanaFont() {
    return `${this.settings.kanaWeight} ${this.settings.rainFontSize}px "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif`;
  }

  latinFont() {
    return `${this.settings.glyphWeight} ${this.settings.rainFontSize}px "American Typewriter", "Courier New", Courier, monospace`;
  }

  glyphFont(glyph) {
    return isLatinLike(glyph) || isAsciiPunctuation(glyph)
      ? this.latinFont()
      : this.kanaFont();
  }

  color(mix, alpha) {
    const target = mix >= 0 ? 255 : 0;
    const amount = Math.abs(mix);
    const [red, green, blue] = this.baseColor.map((channel) =>
      Math.round(channel + (target - channel) * amount),
    );
    const opacity = clamp(alpha * this.settings.rainIntensity, 0, 1);
    return `rgba(${red},${green},${blue},${opacity})`;
  }

  scaleX(context, glyph) {
    const latin = isLatinLike(glyph) || isAsciiPunctuation(glyph);
    const key = latin ? "latin" : "kana";
    if (this.scale[key]) return this.scale[key];
    context.save();
    context.font = latin ? this.latinFont() : this.kanaFont();
    const metrics = context.measureText(latin ? "M" : "ｱ");
    const measured = Math.max(
      1,
      Number.isFinite(metrics.actualBoundingBoxLeft) &&
        Number.isFinite(metrics.actualBoundingBoxRight)
        ? metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight
        : metrics.width,
    );
    context.restore();
    const fill = latin
      ? this.settings.rainLatinFill
      : this.settings.rainKanaFill;
    this.scale[key] = (this.grid.cw * fill) / measured;
    return this.scale[key];
  }

  paintGlyph(context, cell, x, y) {
    context.save();
    context.font = this.glyphFont(cell.glyph);
    const scaleX =
      this.scaleX(context, cell.glyph) * cell.inkScale * (cell.flipX ? -1 : 1);
    context.translate(
      x + cell.nudgeX,
      y + (cell.flipY ? this.settings.rainFontSize : 0),
    );
    context.scale(scaleX, cell.flipY ? -1 : 1);
    context.fillText(cell.glyph, 0, 0);
    context.restore();
  }

  pause() {
    if (this.pausedAt !== null) return;
    this.pausedAt = this.now();
    if (this.frameId) this.window.cancelAnimationFrame(this.frameId);
    this.frameId = 0;
  }

  resume() {
    if (
      this.pausedAt === null ||
      this.document.hidden ||
      !this.document.hasFocus() ||
      this.motionQuery?.matches
    ) return;
    const now = this.now();
    const paused = Math.max(0, now - this.pausedAt);
    for (const column of this.columns) {
      column.lastAdvance += paused;
      for (const cell of column.cells.values()) cell.nextMutation += paused;
      for (const [row, until] of column.whiteMap) {
        column.whiteMap.set(row, until + paused);
      }
    }
    this.lastRender = now;
    this.pausedAt = null;
    this.requestFrame();
  }

  handleVisibilityChange() {
    if (this.document.hidden) this.pause();
    else this.resume();
  }

  handleMotionChange(event) {
    if (event.matches) this.pause();
    else this.resume();
  }

  requestFrame() {
    if (!this.frameId && this.pausedAt === null) {
      this.frameId = this.window.requestAnimationFrame(this.frame);
    }
  }

  frame(now) {
    this.frameId = 0;
    if (this.pausedAt !== null) return;
    if (now - this.lastRender >= 1000 / 30) {
      this.lastRender = now;
      this.render(now);
    }
    this.requestFrame();
  }

  render(now) {
    this.context.fillStyle = "rgba(0,3,2,.205)";
    this.context.fillRect(0, 0, this.width, this.height);
    for (const column of this.columns) {
      column.step(now);
      column.draw(this.context, now);
    }
  }
}

class DigitalRainSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    this.containerEl.empty();

    new Setting(this.containerEl)
      .setName("Enabled")
      .setDesc("Show the rain behind the normal Obsidian interface.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enabled)
          .onChange((value) => this.plugin.setSetting("enabled", value)),
      );

    for (const spec of SLIDER_SETTINGS) this.addSlider(...spec);

    new Setting(this.containerEl)
      .setName("Reset defaults")
      .setDesc("Restore all default values and enable the background.")
      .addButton((button) =>
        button.setButtonText("Reset").onClick(async () => {
          this.plugin.settings = { ...DEFAULT_SETTINGS };
          this.plugin.syncRenderers();
          await this.plugin.persistSettings();
          this.display();
        }),
      );

    this.addFileControls();
  }

  addSlider(name, key, min, max, step) {
    new Setting(this.containerEl).setName(name).addSlider((slider) =>
      slider
        .setLimits(min, max, step)
        .setValue(this.plugin.settings[key])
        .setDynamicTooltip()
        .onChange((value) => this.plugin.setSetting(key, value)),
    );
  }

  addFileControls() {
    new Setting(this.containerEl)
      .setName("Settings backup")
      .setDesc("Export overwrites settings-backup.json in this plugin's folder. Import restores that same file. Changes are saved automatically.")
      .addButton((button) =>
        button.setButtonText("Export JSON").onClick(async () => {
          try {
            const path = await this.plugin.exportSettingsFile();
            new Notice(`Settings saved to ${path}`);
          } catch (error) {
            if (error.name !== "AbortError") new Notice(`Export failed: ${error.message}`);
          }
        }),
      )
      .addButton((button) =>
        button.setButtonText("Import JSON").setCta().onClick(async () => {
          try {
            if (!(await this.plugin.importSettingsFile())) return;
            new Notice("Digital Rain Background settings imported.");
            this.display();
          } catch (error) {
            if (error.name !== "AbortError") new Notice(`Import failed: ${error.message}`);
          }
        }),
      );
  }
}

class DigitalRainBackgroundPlugin extends Plugin {
  async onload() {
    this.unloaded = false;
    this.renderers = new Map();
    this.settings = normalizeSettings(await this.loadData());
    if (this.unloaded) return;
    this.addSettingTab(new DigitalRainSettingTab(this.app, this));
    this.addCommand({
      id: "toggle-background",
      name: "Toggle background",
      callback: async () => {
        await this.setSetting("enabled", !this.settings.enabled);
      },
    });
    this.registerEvent(
      this.app.workspace.on("window-open", (workspaceWindow, window) => {
        const ownerDocument = workspaceWindow.doc || window.document;
        const frameId = window.requestAnimationFrame(() => this.syncDocument(ownerDocument));
        this.register(() => window.cancelAnimationFrame(frameId));
      }),
    );
    this.registerEvent(
      this.app.workspace.on("window-close", (workspaceWindow, window) => {
        this.removeRenderer(workspaceWindow.doc || window.document);
      }),
    );
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        for (const renderer of this.renderers.values()) {
          renderer.scheduleThemeRefresh();
        }
      }),
    );
    this.app.workspace.onLayoutReady(() => this.syncRenderers());
  }

  onunload() {
    this.unloaded = true;
    this.destroyRenderers();
  }

  async persistSettings() {
    try {
      await this.saveData({ ...this.settings });
    } catch (error) {
      new Notice(`Digital Rain Background: settings could not be saved. ${error.message}`);
    }
  }

  async setSetting(key, value) {
    this.settings[key] = value;
    this.syncRenderers();
    await this.persistSettings();
  }

  async onExternalSettingsChange() {
    this.settings = normalizeSettings(await this.loadData());
    this.syncRenderers();
  }

  exportSettings() {
    return JSON.stringify({
      format: "digital-rain-background",
      version: 1,
      settings: this.settings,
    }, null, 2);
  }

  async exportSettingsFile() {
    const path = normalizePath(`${this.manifest.dir}/settings-backup.json`);
    await this.app.vault.adapter.write(path, this.exportSettings());
    return path;
  }

  async importSettingsFile() {
    const path = normalizePath(`${this.manifest.dir}/settings-backup.json`);
    if (!(await this.app.vault.adapter.exists(path))) {
      throw new Error(`backup file not found: ${path}`);
    }
    const contents = await this.app.vault.adapter.read(path);
    if (contents.length > 100_000) throw new Error("settings file is too large");
    await this.importSettings(contents);
    return true;
  }

  async importSettings(text) {
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("settings must be a JSON object");
    }
    if (payload.format && payload.format !== "digital-rain-background") {
      throw new Error("this JSON belongs to another plugin");
    }
    if (payload.format && payload.version !== 1) {
      throw new Error("unsupported settings backup version");
    }
    const source = payload.settings ?? payload;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error("settings are missing");
    }
    const knownKeys = [
      "enabled",
      ...SLIDER_SETTINGS.map(([, key]) => key),
    ];
    if (!knownKeys.some((key) => Object.hasOwn(source, key))) {
      throw new Error("no Digital Rain Background settings found");
    }
    const settings = normalizeSettings(source);
    await this.saveData(settings);
    this.settings = settings;
    this.syncRenderers();
  }

  collectDocuments() {
    const documents = new Set([document]);
    this.app.workspace.iterateAllLeaves((leaf) => {
      const ownerDocument = leaf.getContainer().doc;
      if (ownerDocument) documents.add(ownerDocument);
    });
    return documents;
  }

  createRenderer(ownerDocument) {
    return new MatrixRain(ownerDocument, this.settings);
  }

  syncDocument(ownerDocument) {
    if (this.unloaded || !this.settings.enabled || !ownerDocument || ownerDocument.defaultView?.closed || this.renderers.has(ownerDocument)) return;
    const renderer = this.createRenderer(ownerDocument);
    this.renderers.set(ownerDocument, renderer);
    renderer.start();
  }

  removeRenderer(ownerDocument) {
    const renderer = this.renderers.get(ownerDocument);
    if (!renderer) return;
    renderer.destroy();
    this.renderers.delete(ownerDocument);
  }

  destroyRenderers() {
    for (const renderer of this.renderers.values()) renderer.destroy();
    this.renderers.clear();
  }

  syncRenderers() {
    if (this.unloaded) return;
    if (!this.settings.enabled) {
      this.destroyRenderers();
      return;
    }
    const documents = this.collectDocuments();
    for (const [ownerDocument, renderer] of this.renderers) {
      if (!documents.has(ownerDocument)) {
        this.removeRenderer(ownerDocument);
      } else {
        renderer.update(this.settings);
      }
    }
    for (const ownerDocument of documents) this.syncDocument(ownerDocument);
  }
}

function runRainSelfCheck() {
  const fakeRain = {
    settings: DEFAULT_SETTINGS,
    grid: { rows: 40, ch: 12 },
    height: 480,
    now: () => performance.now(),
    pickGlyph: () => "ｱ",
    orientCellGlyph: (cell, glyph) => {
      cell.glyph = glyph;
    },
  };
  const column = new MatrixColumn(fakeRain, 0);
  column.enabled = true;
  column.done = true;
  column.step(performance.now());
  if (column.done) throw new Error("rain column did not recycle");
  const color = MatrixRain.prototype.color.call(
    { baseColor: [49, 220, 139], settings: DEFAULT_SETTINGS },
    0,
    0.5,
  );
  if (color !== "rgba(49,220,139,0.5)") throw new Error("rain color was not applied");
}

DigitalRainBackgroundPlugin.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
DigitalRainBackgroundPlugin.normalizeSettings = normalizeSettings;
DigitalRainBackgroundPlugin.runRainSelfCheck = runRainSelfCheck;
DigitalRainBackgroundPlugin.detectThemeProfile = detectThemeProfile;
DigitalRainBackgroundPlugin.MatrixRain = MatrixRain;
module.exports = DigitalRainBackgroundPlugin;
