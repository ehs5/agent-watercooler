const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const CODE = /`([^`\n]+)`/g;
const LINK = /\bhttps?:\/\/[^\s<]*[^\s<.,;:!?)\]'"]/g;
const BOLD = /\*\*([^*\n]+)\*\*/g;
// The look-behind keeps email addresses like a@b.no from turning into mentions
const MENTION = /(?<![\w@])@([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)/g;

type List = { tag: "ul" | "ol"; start: number; items: string[] };

/** Escapes text for use inside HTML. */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Formats links, bold text and @mentions in escaped text that isn't code. */
function formatText(escaped: string, mentionStyle: (name: string) => string): string {
  return escaped
    .replace(LINK, (url) => `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`)
    .replace(BOLD, "<strong>$1</strong>")
    .replace(MENTION, (match: string, name: string) => {
      const style: string = mentionStyle(name);
      // Only names of agents in the room become mentions
      if (!style) return match;
      return `<span class="mention" style="${style}">@${name}</span>`;
    });
}

/** Formats one line: `code` stays as written, the rest gets links, bold and mentions. */
function formatInline(line: string, mentionStyle: (name: string) => string): string {
  let html = "";
  let last = 0;
  for (const match of line.matchAll(CODE)) {
    html += formatText(escapeHtml(line.slice(last, match.index)), mentionStyle);
    html += `<code>${escapeHtml(match[1])}</code>`;
    last = match.index + match[0].length;
  }
  return html + formatText(escapeHtml(line.slice(last)), mentionStyle);
}

/** Renders a list as HTML. */
function renderList(list: List): string {
  const start: string = list.tag === "ol" && list.start !== 1 ? ` start="${list.start}"` : "";
  const items: string = list.items.map((item) => `<li>${item}</li>`).join("");
  return `<${list.tag}${start}>${items}</${list.tag}>`;
}

/**
 * Turns a message body into safe HTML: paragraphs, "- " and "1. " lists, `code`, **bold**, links and @mentions.
 * mentionStyle returns the inline style for an agent's mention, or "" when the name isn't an agent in the room.
 */
export function formatMessage(body: string, mentionStyle: (name: string) => string): string {
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: List | undefined;

  /** Closes the open paragraph and list, if any. */
  function flush() {
    if (paragraph.length > 0) blocks.push(`<p>${paragraph.join("<br>")}</p>`);
    if (list) blocks.push(renderList(list));
    paragraph = [];
    list = undefined;
  }

  for (const line of body.split("\n")) {
    if (!line.trim()) {
      flush();
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    const tag = bullet ? "ul" : numbered ? "ol" : "";

    // Plain text ends any list and continues the paragraph
    if (!tag) {
      if (list) flush();
      paragraph.push(formatInline(line, mentionStyle));
      continue;
    }

    if (paragraph.length > 0 || list?.tag !== tag) flush();
    const text: string = bullet ? bullet[1] : (numbered?.[2] ?? "");
    list ??= { tag, start: Number(numbered?.[1] ?? 1), items: [] };
    list.items.push(formatInline(text, mentionStyle));
  }

  flush();
  return blocks.join("");
}
