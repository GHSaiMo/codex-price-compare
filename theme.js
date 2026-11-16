const themeToggle = document.querySelector("#themeToggle");
const colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
const systemColorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

function systemTheme() {
  return systemColorSchemeQuery.matches ? "dark" : "light";
}

function storedTheme() {
  try {
    const value = localStorage.getItem("color-theme");
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function saveTheme(theme) {
  try {
    if (theme === "light" || theme === "dark") {
      localStorage.setItem("color-theme", theme);
    } else {
      localStorage.removeItem("color-theme");
    }
  } catch {
    // Theme persistence is a convenience; the switch still works without storage.
  }
}

function applyTheme(overrideTheme) {
  const effectiveTheme = overrideTheme ?? systemTheme();
  if (colorSchemeMeta) {
    colorSchemeMeta.content = overrideTheme ?? "light dark";
  }
  document.body.dataset.theme = effectiveTheme;

  if (!themeToggle) return;

  themeToggle.setAttribute("aria-pressed", String(effectiveTheme === "dark"));
  themeToggle.title = effectiveTheme === "dark" ? "切换为淡色系" : "切换为黑色系";
}

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const currentEffective = storedTheme() ?? systemTheme();
    const targetTheme = currentEffective === "dark" ? "light" : "dark";
    const nextOverride = targetTheme === systemTheme() ? null : targetTheme;
    applyTheme(nextOverride);
    saveTheme(nextOverride);
  });
}

systemColorSchemeQuery.addEventListener("change", () => {
  applyTheme(storedTheme());
});

window.addEventListener("storage", (event) => {
  if (event.key === "color-theme") {
    applyTheme(storedTheme());
  }
});

applyTheme(storedTheme());
