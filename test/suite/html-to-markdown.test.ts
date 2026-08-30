import * as assert from "assert";
import { readFileSync } from "fs";
import { join } from "path";
import { htmlToMarkdown } from "../../src/util/html-to-markdown";

const fixture = readFileSync(join(__dirname, "../../../test/fixtures/article-edit/article-content.html"), "utf8");

suite("htmlToMarkdown", () => {
	test("empty input produces empty output", () => {
		assert.strictEqual(htmlToMarkdown(""), "");
		assert.strictEqual(htmlToMarkdown(undefined), "");
		assert.strictEqual(htmlToMarkdown("   "), "");
	});

	test("paragraphs, headings and inline emphasis", () => {
		const md = htmlToMarkdown("<p>普通 <strong>粗</strong> <em>斜</em> <del>删</del> <code>c</code></p><h2>标题</h2>");
		assert.ok(md.indexOf("**粗**") >= 0, md);
		assert.ok(md.indexOf("*斜*") >= 0, md);
		assert.ok(md.indexOf("~~删~~") >= 0, md);
		assert.ok(md.indexOf("`c`") >= 0, md);
		assert.ok(md.indexOf("## 标题") >= 0, md);
	});

	test("links use markdown syntax with url", () => {
		const md = htmlToMarkdown('<p>看<a href="https://example.com/a">这里</a>吧</p>');
		assert.ok(md.indexOf("[这里](https://example.com/a)") >= 0, md);
	});

	test("images prefer lazy-load attributes over placeholder src", () => {
		const md = htmlToMarkdown('<p><img data-original="https://pic1.zhimg.com/a.png" src="data:image/svg+xml;base64,xx" alt="图"/></p>');
		assert.ok(md.indexOf("![图](https://pic1.zhimg.com/a.png)") >= 0, md);
		const actual = htmlToMarkdown('<p><img data-actualsrc="https://picx.zhimg.com/b.png" src="/static/placeholder.png"/></p>');
		assert.ok(actual.indexOf("![](https://picx.zhimg.com/b.png)") >= 0, actual);
	});

	test("code blocks keep language identifiers", () => {
		const md = htmlToMarkdown('<pre><code class="language-java">public class A {}</code></pre>');
		assert.ok(md.indexOf("```java") === 0, md);
		assert.ok(md.indexOf("public class A {}") >= 0, md);
		const langAttr = htmlToMarkdown('<pre lang="python"><code>print(1)</code></pre>');
		assert.ok(langAttr.indexOf("```python") === 0, langAttr);
	});

	test("nested ordered and unordered lists", () => {
		const md = htmlToMarkdown("<ul><li>a<ul><li>a1</li></ul></li><li>b</li></ul><ol><li>one</li><li>two</li></ol>");
		assert.ok(md.indexOf("- a") === 0, md);
		assert.ok(md.indexOf("  - a1") >= 0, md);
		assert.ok(md.indexOf("1. one") >= 0, md);
		assert.ok(md.indexOf("2. two") >= 0, md);
	});

	test("blockquotes, hr and tables", () => {
		const md = htmlToMarkdown("<blockquote><p>q1<br>q2</p></blockquote><hr><table><tbody><tr><th>x</th><th>y</th></tr><tr><td>a|b</td><td>1</td></tr></tbody></table>");
		assert.ok(md.indexOf("> q1") >= 0, md);
		assert.ok(md.indexOf("> q2") >= 0, md);
		assert.ok(md.indexOf("---") >= 0, md);
		assert.ok(md.indexOf("| x | y |") >= 0, md);
		assert.ok(md.indexOf("a\\|b") >= 0, md);
	});

	test("noscript fallback never duplicates images", () => {
		const md = htmlToMarkdown('<figure><img data-original="https://pic4.zhimg.com/a.png"><noscript><img src="https://pic4.zhimg.com/a.png"></noscript></figure>');
		const matches = md.match(/!\[\]\(https:\/\/pic4\.zhimg\.com\/a\.png\)/g);
		assert.strictEqual(matches ? matches.length : 0, 1, md);
	});

	test("noscript-only images are hoisted", () => {
		const md = htmlToMarkdown('<figure><noscript><img src="https://pic4.zhimg.com/only.png"/></noscript></figure>');
		assert.ok(md.indexOf("https://pic4.zhimg.com/only.png") >= 0, md);
	});

	test("zhihu formula images keep their tex source", () => {
		const inline = htmlToMarkdown('<p>公式 <img eeimg="1" src="https://www.zhihu.com/equation?tex=E%3Dmc%5E2"></p>');
		assert.ok(inline.indexOf("$E=mc^2$") >= 0, inline);
		const block = htmlToMarkdown('<p><img eeimg="1" src="https://www.zhihu.com/equation?tex=%5Cfrac%7Ba%7D%7Bb%7D"></p>');
		assert.ok(block.indexOf("$$\\frac{a}{b}$$") >= 0, block);
	});

	test("unknown zhihu widgets are preserved as raw html", () => {
		const md = htmlToMarkdown('<figure class="zm-item-link-card" data-block-card="{&quot;type&quot;:&quot;link&quot;}"><a href="https://www.zhihu.com/question/42">卡片</a></figure>');
		assert.ok(md.indexOf("<figure") >= 0, md);
		assert.ok(md.indexOf("data-block-card") >= 0, md);
	});

	test("converts the full fixture without losing structures", () => {
		const md = htmlToMarkdown(fixture);
		assert.ok(md.indexOf("[一篇站内文章](https://zhuanlan.zhihu.com/p/999888)") >= 0, md);
		assert.ok(md.indexOf("## 小标题") >= 0, md);
		assert.ok(md.indexOf("```java") >= 0, md);
		assert.ok(md.indexOf("嵌套项") >= 0, md);
		assert.ok(md.indexOf("$E=mc^2$") >= 0, md);
		assert.ok(md.indexOf("| 名字 | 值 |") >= 0, md);
		assert.ok(md.indexOf("data-block-card") >= 0, md);
		// noscript fallback must not duplicate the figure image
		const imageCount = (md.match(/https:\/\/picx\.zhimg\.com\/80\/v2-demo\.png/g) || []).length;
		assert.strictEqual(imageCount, 1, md);
	});
});
