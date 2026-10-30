import { expect, test } from "vitest";
import { formatMessage } from "../web/src/formatMessage.js";

/** Styles mentions of oauth and tools-137 only, like the page does for agents in the room. */
function mentionStyle(name: string): string {
  if (name === "oauth" || name === "tools-137") return "--c: red";
  return "";
}

test("escapes HTML before formatting", () => {
  expect(formatMessage("<script>alert(1)</script> & **bold**", mentionStyle)).toBe(
    "<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; <strong>bold</strong></p>",
  );
});

test("lists, paragraphs and line breaks", () => {
  const html: string = formatMessage(
    "Mine:\n- #143 docs\n- #144 loopback\n\n2. second point\nmore",
    mentionStyle,
  );
  expect(html).toBe(
    '<p>Mine:</p><ul><li>#143 docs</li><li>#144 loopback</li></ul><ol start="2"><li>second point</li></ol><p>more</p>',
  );
});

test("code is left alone, mentions only for agents in the room", () => {
  const html: string = formatMessage(
    "@oauth see `@oauth **x**`, cc @tools-137. Not @someone or a@b.no",
    mentionStyle,
  );
  expect(html).toBe(
    '<p><span class="mention" style="--c: red">@oauth</span> see <code>@oauth **x**</code>, cc <span class="mention" style="--c: red">@tools-137</span>. Not @someone or a@b.no</p>',
  );
});

test("links", () => {
  expect(formatMessage("PR: https://github.com/x/y/pull/1.", mentionStyle)).toBe(
    '<p>PR: <a href="https://github.com/x/y/pull/1" target="_blank" rel="noreferrer">https://github.com/x/y/pull/1</a>.</p>',
  );
});
