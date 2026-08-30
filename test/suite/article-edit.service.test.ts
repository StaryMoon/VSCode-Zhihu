import * as assert from "assert";
import { buildArticleDraftMarkdown } from "../../src/service/article-edit.service";
import { EditableArticle } from "../../src/model/article/article-edit";

function article(overrides?: Partial<EditableArticle>): EditableArticle {
	return Object.assign({
		id: "123456",
		title: "原文章标题",
		content: "<p>这里是转换后的正文。</p>",
	}, overrides || {});
}

suite("Article draft markdown generation", () => {
	test("shebang article link is the first line", () => {
		const md = buildArticleDraftMarkdown(article());
		assert.ok(md, "draft must be generated");
		assert.strictEqual(md!.split("\n")[0], "#! https://zhuanlan.zhihu.com/p/123456");
	});

	test("title becomes the first H1 after the body", () => {
		const md = buildArticleDraftMarkdown(article());
		const h1Index = md!.indexOf("# 原文章标题");
		const bodyIndex = md!.indexOf("这里是转换后的正文。");
		assert.ok(h1Index >= 0 && bodyIndex > h1Index, md);
	});

	test("cover image is placed before the H1", () => {
		const md = buildArticleDraftMarkdown(article({ titleImage: "https://pic4.zhimg.com/80/example.png" }));
		const coverIndex = md!.indexOf("![文章封面](https://pic4.zhimg.com/80/example.png)");
		const h1Index = md!.indexOf("# 原文章标题");
		assert.ok(coverIndex >= 0, md);
		assert.ok(coverIndex < h1Index, md);
	});

	test("missing cover produces no placeholder", () => {
		const md = buildArticleDraftMarkdown(article());
		assert.ok(md!.indexOf("文章封面") < 0, md);
	});

	test("html content is converted to markdown", () => {
		const md = buildArticleDraftMarkdown(article({
			content: '<p><a href="https://example.com">链接</a> <strong>粗</strong></p><pre><code class="lang-js">f()</code></pre>',
		}));
		assert.ok(md!.indexOf("[链接](https://example.com)") >= 0, md);
		assert.ok(md!.indexOf("**粗**") >= 0, md);
		assert.ok(md!.indexOf("```js") >= 0, md);
	});

	test("empty title or content refuses to generate", () => {
		assert.strictEqual(buildArticleDraftMarkdown(article({ title: "" })), undefined);
		assert.strictEqual(buildArticleDraftMarkdown(article({ content: "" })), undefined);
		assert.strictEqual(buildArticleDraftMarkdown(article({ content: "   " })), undefined);
		assert.strictEqual(buildArticleDraftMarkdown(article({ id: "" })), undefined);
	});
});
