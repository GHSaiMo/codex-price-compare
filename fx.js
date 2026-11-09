/* Based on Effect Atlas (effectatlas.com) — Copyright (c) 2026 PROJECT Y/O — Effect Atlas License 1.0 */
/* Masked Word Flip / Dock Menu Dropdown / Pixel Wipe Button — 精简原生移植。
 * 缓动固定 cubic-bezier(.22,1,.36,1)（Do not change）。仅用 transform/opacity，支持 prefers-reduced-motion。 */
(function () {
  "use strict";
  const EASE = "cubic-bezier(.22, 1, .36, 1)";
  const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const reduced = () => reduceQuery.matches;

  /* ---------- Masked Word Flip ---------- */
  function flip(el, text) {
    if (!el) return;
    text = String(text);
    if (el._fxAnim) { el._fxAnim.forEach((a) => a.cancel()); el._fxAnim = null; }
    const prev = el.dataset.fxText ?? el.textContent;
    el.dataset.fxText = text;
    if (prev === text || reduced() || !el.isConnected || !el.animate || !prev) {
      el.textContent = text;
      return;
    }
    const mask = document.createElement("span");
    mask.className = "fx-flip-mask";
    const a = document.createElement("span");
    const b = document.createElement("span");
    a.className = b.className = "fx-flip-word";
    a.textContent = prev;
    b.textContent = text;
    b.setAttribute("aria-hidden", "true");
    a.setAttribute("aria-hidden", "true");
    mask.append(a, b);
    el.textContent = "";
    el.append(mask);
    const opts = { duration: 600, easing: EASE, fill: "both" };
    const anims = [
      a.animate([{ transform: "translate3d(0,0,0)" }, { transform: "translate3d(0,-100%,0)" }], opts),
      b.animate([{ transform: "translate3d(0,100%,0)" }, { transform: "translate3d(0,0,0)" }], opts),
    ];
    el._fxAnim = anims;
    const done = () => {
      if (el._fxAnim !== anims) return;
      el._fxAnim = null;
      el.textContent = text;
    };
    anims[1].onfinish = done;
    setTimeout(done, 700); // 后台标签页动画被节流时的兜底
  }

  /* ---------- Pixel Wipe Button ---------- */
  const CELL = 8, DUR = 420;
  const ease = (() => {
    const bez = (p1, p2, m) => { const k = 1 - m; return 3 * k * k * m * p1 + 3 * k * m * m * p2 + m * m * m; };
    const xs = [];
    for (let i = 0; i <= 96; i++) xs.push(bez(.22, .36, i / 96));
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let i = 1;
      while (i < 96 && xs[i] < x) i++;
      const d = xs[i] - xs[i - 1];
      return bez(1, 1, (i - 1 + (d > 0 ? (x - xs[i - 1]) / d : 0)) / 96);
    };
  })();
  const hash = (x, y) => {
    let d = Math.imul(x + 1, 668265261) ^ Math.imul(y + 1, 374761393) ^ 20973;
    d = Math.imul(d ^ (d >>> 15), 739982445);
    d = Math.imul(d ^ (d >>> 12), 695872825);
    d ^= d >>> 15;
    return (d >>> 0) / 4294967296;
  };

  function wipeState(btn) {
    if (btn._fxWipe) return btn._fxWipe;
    const canvas = document.createElement("canvas");
    canvas.className = "fx-pixel-grain";
    canvas.setAttribute("aria-hidden", "true");
    btn.classList.add("fx-pixel");
    btn.prepend(canvas);
    const s = { canvas, ctx: canvas.getContext("2d"), v: 0, from: 0, to: 0, t0: 0, run: false, cols: 0, rows: 0, color: "" };
    btn._fxWipe = s;
    return s;
  }
  function wipeTo(btn, target) {
    if (reduced()) return;
    const s = wipeState(btn);
    s.from = s.v; s.to = target; s.t0 = performance.now();
    if (!s.run) { s.run = true; requestAnimationFrame((t) => wipeFrame(btn, s, t)); }
  }
  function wipeFrame(btn, s, now) {
    const p = Math.min(1, (now - s.t0) / DUR);
    s.v = s.from + (s.to - s.from) * ease(p);
    const w = btn.clientWidth, h = btn.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (s.canvas.width !== Math.round(w * dpr) || s.canvas.height !== Math.round(h * dpr)) {
      s.canvas.width = Math.round(w * dpr); s.canvas.height = Math.round(h * dpr);
      s.cols = Math.ceil(w / CELL); s.rows = Math.ceil(h / CELL);
      s.color = getComputedStyle(btn).getPropertyValue("--accent").trim() || "#0f766e";
    }
    const ctx = s.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = .22;
    ctx.fillStyle = s.color;
    for (let r = 0; r < s.rows; r++) {
      for (let c = 0; c < s.cols; c++) {
        // 左→右扫动 + 随机抖动阈值
        const t = (c / s.cols) * .6 + hash(c, r) * .4;
        if (t < s.v * 1.0) ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
      }
    }
    if (p < 1) requestAnimationFrame((t) => wipeFrame(btn, s, t));
    else s.run = false;
  }
  function bindPixelWipe(root) {
    const sel = ".mode-button, .subtype-button";
    root.addEventListener("pointerover", (e) => {
      if (e.pointerType === "touch") return;
      const btn = e.target.closest?.(sel);
      if (btn && !btn.contains(e.relatedTarget)) wipeTo(btn, 1);
    });
    root.addEventListener("pointerout", (e) => {
      const btn = e.target.closest?.(sel);
      if (btn && !btn.contains(e.relatedTarget)) wipeTo(btn, 0);
    });
    root.addEventListener("focusin", (e) => { const b = e.target.closest?.(sel); if (b && e.target.matches(":focus-visible")) wipeTo(b, 1); });
    root.addEventListener("focusout", (e) => { const b = e.target.closest?.(sel); if (b) wipeTo(b, 0); });
  }

  /* ---------- Dock Menu Dropdown（用于 <select> 的外观替换，原 select 仍是数据源） ---------- */
  function dockSelect(select) {
    if (!select || select._fxDock) return;
    select._fxDock = true;
    const wrap = document.createElement("div");
    wrap.className = "fx-dock";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "fx-dock-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", select.getAttribute("aria-label") || "选择");
    const label = document.createElement("span");
    label.className = "fx-dock-label";
    const chev = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chev.setAttribute("viewBox", "0 0 17 10");
    chev.setAttribute("aria-hidden", "true");
    chev.classList.add("fx-dock-chev");
    chev.innerHTML = '<path d="M1.5 1.5 8.5 8.5 15.5 1.5"/>';
    trigger.append(label, chev);
    const list = document.createElement("ul");
    list.className = "fx-dock-list";
    list.setAttribute("role", "listbox");
    list.hidden = true;
    wrap.append(trigger, list);
    select.classList.add("fx-native-select");
    select.after(wrap);

    const syncLabel = () => flip(label, select.selectedOptions[0]?.textContent || "");
    const build = () => {
      list.textContent = "";
      [...select.options].forEach((opt, i) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.className = "fx-dock-item";
        b.setAttribute("role", "option");
        b.tabIndex = -1;
        b.dataset.value = opt.value;
        b.style.setProperty("--n", i);
        b.setAttribute("aria-selected", String(opt.value === select.value));
        b.textContent = opt.textContent;
        li.append(b);
        list.append(li);
      });
    };
    let open = false;
    const items = () => [...list.querySelectorAll(".fx-dock-item")];
    const setOpen = (v, focusTrigger) => {
      if (v === open) return;
      open = v;
      if (v) { build(); list.hidden = false; void list.offsetWidth; }
      wrap.classList.toggle("is-open", v);
      trigger.setAttribute("aria-expanded", String(v));
      if (!v) {
        const hide = () => { if (!open) list.hidden = true; };
        reduced() ? hide() : setTimeout(hide, 260);
        if (focusTrigger) trigger.focus();
      } else {
        (items().find((x) => x.getAttribute("aria-selected") === "true") || items()[0])?.focus();
      }
    };
    const choose = (value) => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      syncLabel();
      setOpen(false, true);
    };
    trigger.addEventListener("click", () => setOpen(!open));
    list.addEventListener("click", (e) => { const b = e.target.closest(".fx-dock-item"); if (b) choose(b.dataset.value); });
    wrap.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && open) { e.preventDefault(); setOpen(false, true); return; }
      if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp") && e.target === trigger) { e.preventDefault(); setOpen(true); return; }
      if (!open) return;
      const its = items(); const i = its.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); its[Math.min(its.length - 1, i + 1)]?.focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); its[Math.max(0, i - 1)]?.focus(); }
      else if (e.key === "Tab") setOpen(false);
    });
    document.addEventListener("pointerdown", (e) => { if (open && !wrap.contains(e.target)) setOpen(false); });
    select.addEventListener("change", syncLabel);
    // 选项由 app.js 重建时同步文案
    new MutationObserver(() => { label.dataset.fxText = ""; label.textContent = select.selectedOptions[0]?.textContent || ""; label.dataset.fxText = label.textContent; })
      .observe(select, { childList: true });
    label.textContent = select.selectedOptions[0]?.textContent || "";
    label.dataset.fxText = label.textContent;
  }

  window.FX = { flip, dockSelect, reduced };
  function init() {
    bindPixelWipe(document.body);
    dockSelect(document.querySelector("#shopFilter"));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
