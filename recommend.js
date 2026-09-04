(function () {
  const IDLE_TIMEOUT_MS = 60 * 1000;
  const STORAGE_KEY_BLOCKED = "codex_rec_blocked";
  const STORAGE_KEY_SUBMITTED = "codex_rec_submitted_at";
  const STORAGE_KEY_PROMPTED = "codex_rec_prompted_date";

  function isDebug() {
    try {
      return (
        window.__DEBUG_REC__ === true ||
        new URLSearchParams(window.location.search).has("rec_debug")
      );
    } catch {
      return false;
    }
  }

  function shouldRun() {
    const isPublicDomain =
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1";
    if (!isPublicDomain && !isDebug()) {
      return false;
    }

    // Wide screen / PC check (min-width: 1024px)
    if (!window.matchMedia("(min-width: 1024px)").matches && !isDebug()) {
      return false;
    }

    // 1. Actively clicked 'x': permanent block
    if (localStorage.getItem(STORAGE_KEY_BLOCKED) === "permanent") {
      return false;
    }

    // 2. Submitted successfully: 7 days cooldown
    const submittedAt = Number(localStorage.getItem(STORAGE_KEY_SUBMITTED) || 0);
    if (submittedAt && Date.now() - submittedAt < 7 * 24 * 60 * 60 * 1000 && !isDebug()) {
      return false;
    }

    // 3. Naturally ignored: at most once per calendar day
    const todayStr = new Date().toISOString().slice(0, 10);
    const promptedDate = localStorage.getItem(STORAGE_KEY_PROMPTED);
    if (promptedDate === todayStr && !isDebug()) {
      return false;
    }

    return true;
  }

  if (!shouldRun()) {
    return;
  }

  let idleTimer = null;
  let remainingMs = isDebug() ? 3000 : IDLE_TIMEOUT_MS;
  let lastActiveTimestamp = Date.now();
  let isWidgetShown = false;

  function resetIdleTimer() {
    if (isWidgetShown) return;
    lastActiveTimestamp = Date.now();
    remainingMs = isDebug() ? 3000 : IDLE_TIMEOUT_MS;
    clearTimeout(idleTimer);
    if (!document.hidden) {
      idleTimer = setTimeout(triggerPrompt, remainingMs);
    }
  }

  function handleVisibilityChange() {
    if (isWidgetShown) return;
    if (document.hidden) {
      clearTimeout(idleTimer);
      const elapsed = Date.now() - lastActiveTimestamp;
      remainingMs = Math.max(0, remainingMs - elapsed);
    } else {
      lastActiveTimestamp = Date.now();
      if (remainingMs <= 0) {
        triggerPrompt();
      } else {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(triggerPrompt, remainingMs);
      }
    }
  }

  const activityEvents = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
  let throttleTimeout = null;
  function onUserActivity() {
    if (throttleTimeout) return;
    throttleTimeout = setTimeout(() => {
      throttleTimeout = null;
      resetIdleTimer();
    }, 1000);
  }

  activityEvents.forEach((evt) => {
    window.addEventListener(evt, onUserActivity, { passive: true });
  });
  document.addEventListener("visibilitychange", handleVisibilityChange);

  idleTimer = setTimeout(triggerPrompt, remainingMs);

  function triggerPrompt() {
    if (isWidgetShown) return;
    if (!shouldRun()) return;

    isWidgetShown = true;
    const todayStr = new Date().toISOString().slice(0, 10);
    localStorage.setItem(STORAGE_KEY_PROMPTED, todayStr);

    renderWidget();
  }

  function renderWidget() {
    const existing = document.getElementById("recommendWidget");
    if (existing) existing.remove();

    const container = document.createElement("div");
    container.id = "recommendWidget";
    container.className = "recommend-widget";

    container.innerHTML = `
      <div class="recommend-bubble" id="recommendBubble" role="region" aria-label="推荐店铺气泡">
        <button class="recommend-bubble-btn" id="recommendOpenBtn" type="button">
          <span class="recommend-bubble-icon" aria-hidden="true">💡</span>
          <span class="recommend-bubble-text">发现好店？推荐给我们</span>
        </button>
        <button class="recommend-bubble-close" id="recommendBlockBtn" type="button" title="不再提示" aria-label="不再提示">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `;

    document.body.appendChild(container);

    const openBtn = document.getElementById("recommendOpenBtn");
    const blockBtn = document.getElementById("recommendBlockBtn");

    blockBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      localStorage.setItem(STORAGE_KEY_BLOCKED, "permanent");
      dismissWidget();
    });

    openBtn.addEventListener("click", () => {
      renderFormCard(container);
    });
  }

  function renderFormCard(container) {
    const renderTime = Date.now();
    container.innerHTML = `
      <div class="recommend-card" id="recommendCard" role="dialog" aria-modal="false" aria-labelledby="recommendCardTitle">
        <div class="recommend-card-header">
          <h3 id="recommendCardTitle" class="recommend-card-title">推荐商品 / 店铺链接</h3>
          <button class="recommend-card-close" id="recommendCardCloseBtn" type="button" title="关闭" aria-label="关闭">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <form class="recommend-form" id="recommendForm">
          <input
            type="text"
            name="website_hp"
            class="recommend-hp-field"
            tabindex="-1"
            autocomplete="off"
            aria-hidden="true"
          >
          <div class="recommend-field">
            <input
              type="url"
              id="recommendUrlInput"
              class="recommend-input"
              placeholder="https://example.com/shop"
              required
              autocomplete="off"
              spellcheck="false"
            >
          </div>
          <div class="recommend-error-message" id="recommendError" hidden></div>
          <div class="recommend-card-actions">
            <button type="button" class="recommend-btn-cancel" id="recommendCancelBtn">取消</button>
            <button type="submit" class="recommend-btn-submit" id="recommendSubmitBtn">确认推荐</button>
          </div>
        </form>
      </div>
    `;

    const form = document.getElementById("recommendForm");
    const urlInput = document.getElementById("recommendUrlInput");
    const errorMsg = document.getElementById("recommendError");
    const submitBtn = document.getElementById("recommendSubmitBtn");
    const cancelBtn = document.getElementById("recommendCancelBtn");
    const closeBtn = document.getElementById("recommendCardCloseBtn");
    const hpInput = container.querySelector(".recommend-hp-field");

    setTimeout(() => urlInput?.focus(), 80);

    const handleClose = () => {
      dismissWidget();
    };

    closeBtn.addEventListener("click", handleClose);
    cancelBtn.addEventListener("click", handleClose);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const rawUrl = urlInput.value.trim();
      errorMsg.hidden = true;
      errorMsg.textContent = "";

      if (!/^https?:\/\//i.test(rawUrl)) {
        errorMsg.textContent = "链接请以 http:// 或 https:// 开头";
        errorMsg.hidden = false;
        urlInput.focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "提交中...";

      try {
        const res = await fetch("/api/recommendations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: rawUrl,
            _hp: hpInput?.value || "",
            _t: renderTime,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.message || `提交失败 (${res.status})`);
        }

        // Success: 7 days cool-down
        localStorage.setItem(STORAGE_KEY_SUBMITTED, String(Date.now()));

        container.innerHTML = `
          <div class="recommend-success-card">
            <span class="recommend-success-icon">🎉</span>
            <span class="recommend-success-text">感谢您的推荐！已收到</span>
          </div>
        `;

        setTimeout(() => {
          dismissWidget();
        }, 1500);
      } catch (err) {
        errorMsg.textContent = err.message || "提交失败，请稍后重试";
        errorMsg.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = "确认推荐";
      }
    });
  }

  function dismissWidget() {
    const container = document.getElementById("recommendWidget");
    if (!container) return;
    container.classList.add("is-dismissing");
    setTimeout(() => {
      container.remove();
    }, 280);
  }
})();
