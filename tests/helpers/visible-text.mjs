// Collects every string a person (or a screen reader) can meet on the page:
// visible text, plus tooltips, aria-labels, placeholders and image alt text.
// Styling-independent on purpose: a string is the full text of the element
// that directly holds it, so recolouring, re-spacing or re-ordering the
// layout doesn't change the result, but changing a single word does.

function collectInPage(rootSelector) {
  // With a selector, the last match wins: a confirmation opened on top of
  // another dialog is the one being asked about.
  const matches = rootSelector ? document.querySelectorAll(rootSelector) : [document.body];
  const root = matches[matches.length - 1];
  if (!root) return [];

  const clean = (value) => (value ?? "").replace(/\s+/g, " ").trim();
  const shown = (element) =>
    element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: false });

  const found = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let element = root; element; element = walker.nextNode()) {
    if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(element.tagName)) continue;
    if (!shown(element)) continue;

    const holdsText = Array.from(element.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && clean(node.nodeValue),
    );
    if (holdsText) {
      const text = clean(element.textContent);
      if (text) found.add(`text: ${text}`);
    }
    for (const attribute of ["title", "aria-label", "placeholder", "alt"]) {
      const value = clean(element.getAttribute(attribute));
      if (value) found.add(`${attribute}: ${value}`);
    }
  }
  return Array.from(found);
}

// Dates shown on screen depend on the day the check runs.
function stable(text) {
  return text.replace(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, "<date>");
}

// `target` is a Playwright Page or Frame.
export async function collectStrings(target, rootSelector) {
  const strings = await target.evaluate(collectInPage, rootSelector ?? null);
  return Array.from(new Set(strings.map(stable))).sort();
}

export const DIALOG = '[role="dialog"], [role="alertdialog"]';
