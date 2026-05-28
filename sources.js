const sourceLinks = document.querySelector("#sourceLinks");
const sourceLinksSummary = document.querySelector("#sourceLinksSummary");
const sourcesUrl = document.body.dataset.sourcesUrl || "data/sources.json";

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
    const sources = Array.isArray(data.sources) ? data.sources : [];
    clearElement(sourceLinks);
    sourceLinksSummary.textContent = `共 ${sources.length} 个店铺链接。`;

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
