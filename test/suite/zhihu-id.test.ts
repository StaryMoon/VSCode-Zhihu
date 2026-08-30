import * as assert from "assert";
import { extractArticleId, resolveArticleIdFromTarget } from "../../src/util/zhihu-id";

suite("Zhihu article id parsing", () => {
	test("accepts pure numeric article ids", () => {
		assert.strictEqual(extractArticleId("123456"), "123456");
		assert.strictEqual(extractArticleId("  123456  "), "123456");
	});

	test("accepts article links with and without trailing slash", () => {
		assert.strictEqual(extractArticleId("https://zhuanlan.zhihu.com/p/123456"), "123456");
		assert.strictEqual(extractArticleId("https://zhuanlan.zhihu.com/p/123456/"), "123456");
		assert.strictEqual(extractArticleId("https://zhuanlan.zhihu.com/p/123456?utm=1#c"), "123456");
	});

	test("rejects non-article zhihu links", () => {
		assert.strictEqual(extractArticleId("https://www.zhihu.com/question/19602618"), undefined);
		assert.strictEqual(extractArticleId("https://www.zhihu.com/question/1/answer/2"), undefined);
		assert.strictEqual(extractArticleId("https://example.com/p/123456"), undefined);
		assert.strictEqual(extractArticleId("https://zhuanlan.zhihu.com/pub/article/123"), undefined);
		assert.strictEqual(extractArticleId("not a url"), undefined);
		assert.strictEqual(extractArticleId(""), undefined);
		assert.strictEqual(extractArticleId(undefined), undefined);
	});

	test("resolves ids from targets, strictly article-only", () => {
		assert.strictEqual(
			resolveArticleIdFromTarget({ url: "https://zhuanlan.zhihu.com/p/42", type: "article" }),
			"42"
		);
		assert.strictEqual(resolveArticleIdFromTarget({ id: 42, type: "article" }), "42");
		// A question target must never resolve to an article id.
		assert.strictEqual(resolveArticleIdFromTarget({ id: 42, url: "https://www.zhihu.com/question/77" }), "");
		assert.strictEqual(resolveArticleIdFromTarget(undefined), "");
	});
});
