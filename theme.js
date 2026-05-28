const themeToggle = document.querySelector("#themeToggle");

function storedTheme() {
  try {
    return localStorage.getItem("color-theme");
  } catch {
    return null;
  }
}

function saveTheme(theme) {
  try {
    localStorage.setItem("color-theme", theme);
  } catch {
    // Theme persistence is a convenience; the switch still works without storage.
  }
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;

  if (!themeToggle) return;

  themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
  themeToggle.title = theme === "dark" ? "切换为淡色系" : "切换为黑色系";
}

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    saveTheme(nextTheme);
  });
}

applyTheme(storedTheme() === "dark" ? "dark" : "light");
