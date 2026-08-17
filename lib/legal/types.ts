export type LegalInlineLink = {
  href: string;
  label: string;
};

export type LegalBlock =
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "note"; text: string };

export type LegalSection = {
  heading: string;
  blocks: LegalBlock[];
};

export type LegalDocument = {
  route: string;
  title: string;
  sections: LegalSection[];
};

const LINK_MARKUP = /\[\[([^\]|]+)\|([^\]]+)\]\]/g;

export function flattenLegalText(document: LegalDocument): string {
  const parts: string[] = [document.title];
  for (const section of document.sections) {
    parts.push(section.heading);
    for (const block of section.blocks) {
      if (block.type === "ul") {
        parts.push(...block.items.map(stripLegalMarkup));
      } else {
        parts.push(stripLegalMarkup(block.text));
      }
    }
  }
  return parts.join("\n");
}

export function renderLegalDocumentMarkdown(document: LegalDocument): string {
  const lines: string[] = [`# ${document.title}`, ""];
  for (const section of document.sections) {
    lines.push(`## ${section.heading}`, "");
    for (const block of section.blocks) {
      if (block.type === "ul") {
        for (const item of block.items) {
          lines.push(`- ${stripLegalMarkup(item)}`);
        }
        lines.push("");
        continue;
      }
      const prefix = block.type === "note" ? "> " : "";
      lines.push(`${prefix}${stripLegalMarkup(block.text)}`, "");
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function stripLegalMarkup(text: string): string {
  return text.replace(LINK_MARKUP, "$1");
}

export function parseLegalMarkup(
  text: string,
): Array<string | LegalInlineLink> {
  const nodes: Array<string | LegalInlineLink> = [];
  let lastIndex = 0;
  for (const match of text.matchAll(LINK_MARKUP)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }
    nodes.push({ label: match[1] ?? "", href: match[2] ?? "" });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}
