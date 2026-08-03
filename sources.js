const sourceLinks = document.querySelector("#sourceLinks");
const sourceLinksSummary = document.querySelector("#sourceLinksSummary");
const sourcesUrl = document.body.dataset.sourcesUrl || "data/sources.json";
const adapterOrder = {
  ldxp: 0,
  acg: 1,
  dujiao: 2,
};
const zhCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});
// Boundary characters used to map a Chinese character to its pinyin initial.
const pinyinInitialBoundaries = [
  ["A", "阿"],
  ["B", "八"],
  ["C", "嚓"],
  ["D", "哒"],
  ["E", "妸"],
  ["F", "发"],
  ["G", "旮"],
  ["H", "哈"],
  ["J", "讥"],
  ["K", "咔"],
  ["L", "垃"],
  ["M", "妈"],
  ["N", "拏"],
  ["O", "噢"],
  ["P", "妑"],
  ["Q", "七"],
  ["R", "呥"],
  ["S", "扨"],
  ["T", "他"],
  ["W", "穵"],
  ["X", "夕"],
  ["Y", "丫"],
  ["Z", "帀"],
];

function getPinyinInitial(char) {
  let initial = "A";
  for (const [letter, boundary] of pinyinInitialBoundaries) {
    if (zhCollator.compare(char, boundary) >= 0) {
      initial = letter;
      continue;
    }
    break;
  }
  return initial;
}

function getNameSortKey(name) {
  const text = String(name || "").trim();
  if (!text) return { letter: "~", text: "" };

  const first = text[0];
  if (/[0-9]/.test(first)) {
    return { letter: first, text: text.toLowerCase() };
  }
  if (/[a-zA-Z]/.test(first)) {
    return { letter: first.toUpperCase(), text: text.toLowerCase() };
  }
  if (/[一-鿿]/.test(first)) {
    return { letter: getPinyinInitial(first), text };
  }
  return { letter: first.toUpperCase(), text };
}

function compareSourceNames(left, right) {
  const leftKey = getNameSortKey(left);
  const rightKey = getNameSortKey(right);
  if (leftKey.letter !== rightKey.letter) {
    return leftKey.letter.localeCompare(rightKey.letter, "en", { numeric: true });
  }
  return zhCollator.compare(leftKey.text, rightKey.text);
}

function sortSources(sources) {
  return [...sources].sort((left, right) => {
    const leftOrder = adapterOrder[left.adapter] ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = adapterOrder[right.adapter] ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return compareSourceNames(left.name, right.name);
  });
}

function clearElement(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function createSourceLinkCard(source) {
  const card = document.createElement("a");
  card.className = "source-link-card";
  card.href = source.url;
  card.target = "_blank";
  card.rel = "noopener noreferrer";

  const name = document.createElement("strong");
  name.textContent = source.name;

  const url = document.createElement("span");
  url.className = "source-link-url";
  url.textContent = source.url;

  const adapter = document.createElement("span");
  adapter.className = "adapter-pill";
  adapter.textContent = source.adapter;

  card.append(name, url, adapter);
  return card;
}

async function loadSourceLinks() {
  try {
    const response = await fetch(sourcesUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`sources HTTP ${response.status}`);

    const data = await response.json();
    const sources = sortSources(Array.isArray(data.sources) ? data.sources : []);
    clearElement(sourceLinks);
    sourceLinksSummary.textContent = `共 ${sources.length} 个店铺链接`;

    for (const source of sources) {
      sourceLinks.appendChild(createSourceLinkCard(source));
    }
  } catch (error) {
    sourceLinksSummary.textContent = `读取店铺链接失败：${error.message}`;
    clearElement(sourceLinks);
    console.error(error);
  }
}

loadSourceLinks();
