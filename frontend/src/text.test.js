import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, safeHref, stripBidi, fmtSize } from "./text.js";

test("links: https only, trailing punctuation trimmed", () => {
  const n = parse("see https://example.com/a?b=1, ok javascript:alert(1)");
  const links = n.filter((x) => x.t === "a");
  assert.equal(links.length, 1);
  assert.equal(links[0].v, "https://example.com/a?b=1");
  assert.equal(safeHref("javascript:alert(1)"), "");
  assert.equal(safeHref("ftp://x.y"), "");
});

test("html stays literal text", () => {
  const n = parse("<img src=x onerror=alert(1)>");
  assert.deepEqual(n, [{ t: "text", v: "<img src=x onerror=alert(1)>" }]);
});

test("formatting", () => {
  const n = parse("a *bold* _it_ ~st~ `m` snake_case_x");
  assert.deepEqual(n.filter((x) => x.t !== "text").map((x) => x.t), ["b", "i", "s", "code"]);
  assert.equal(n.at(-1).v.endsWith("snake_case_x"), true);
  assert.equal(parse("*a* and *b*").filter((x) => x.t === "b").length, 2);
});

test("nesting and urls not formatted", () => {
  assert.equal(parse("*_x_*")[0].kids[0].t, "i");
  const n = parse("https://e.com/_a_b_");
  assert.equal(n.length, 1);
  assert.equal(n[0].t, "a");
});

test("bidi stripped, size", () => {
  assert.equal(stripBidi("a‮b⁦c"), "abc");
  assert.equal(fmtSize(1536), "1.5 KB");
});
