const ALLOWED_TAGS = new Set([
  "ARTICLE",
  "SECTION",
  "HEADER",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "P",
  "BR",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "S",
  "DEL",
  "STRIKE",
  "CODE",
  "PRE",
  "UL",
  "OL",
  "LI",
  "TABLE",
  "THEAD",
  "TBODY",
  "TR",
  "TH",
  "TD",
  "A",
  "IMG",
  "BLOCKQUOTE",
  "HR",
  "SPAN"
]);

const REMOVED_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON"]);
const UNSUPPORTED_EDITOR_CHARACTERS = /[\p{Script=Han}\uF900-\uFAFF]/gu;

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(["href", "title"]),
  H1: new Set(["data-align"]),
  H2: new Set(["data-align"]),
  H3: new Set(["data-align"]),
  H4: new Set(["data-align"]),
  IMG: new Set(["src", "alt", "title"]),
  P: new Set(["data-align"]),
  TH: new Set(["colspan", "rowspan"]),
  TD: new Set(["colspan", "rowspan"])
};

const ALLOWED_ALIGNMENTS = new Set(["center", "right", "justify"]);

function isSafeUrl(value: string, imageOnly: boolean): boolean {
  const trimmed = value.trim();
  if (imageOnly) {
    return /^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(trimmed) || /^blob:/i.test(trimmed);
  }
  return /^(https:|mailto:|tel:)/i.test(trimmed);
}

export function removeUnsupportedEditorCharacters(input: string): string {
  return input.normalize("NFKC").replace(UNSUPPORTED_EDITOR_CHARACTERS, "");
}

function cleanNode(node: ParentNode): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      child.textContent = removeUnsupportedEditorCharacters(child.textContent ?? "");
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) {
      child.remove();
      continue;
    }

    const element = child as HTMLElement;

    if (REMOVED_TAGS.has(element.tagName)) {
      element.remove();
      continue;
    }

    if (!ALLOWED_TAGS.has(element.tagName)) {
      cleanNode(element);
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }

    for (const attr of Array.from(element.attributes)) {
      const attrName = attr.name.toLowerCase();
      const tagAttrs = ALLOWED_ATTRS[element.tagName];
      if (attrName.startsWith("on") || !(tagAttrs && tagAttrs.has(attrName))) {
        element.removeAttribute(attr.name);
        continue;
      }
      if (attrName === "href" && !isSafeUrl(attr.value, false)) {
        element.removeAttribute(attr.name);
      }
      if (attrName === "src" && !isSafeUrl(attr.value, true)) {
        element.removeAttribute(attr.name);
      }
      if (attrName === "data-align" && !ALLOWED_ALIGNMENTS.has(attr.value)) {
        element.removeAttribute(attr.name);
      }
    }

    cleanNode(element);
  }
}

export function sanitizeHtml(input: string): string {
  const template = document.createElement("template");
  template.innerHTML = input;
  cleanNode(template.content);
  return template.innerHTML;
}

export function stripHtml(input: string): string {
  const template = document.createElement("template");
  template.innerHTML = input;
  return template.content.textContent?.trim() ?? "";
}
