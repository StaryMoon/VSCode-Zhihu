import * as assert from "assert";
import { IColumn } from "../../src/model/publish/column.model";
import { ArticleRequest, extractErrorSummary, submitArticleUpdate } from "../../src/service/article-api";

interface RecordedRequest {
	uri: string;
	method: string;
	body: any;
}

function fakeRequest(responses: { [key: string]: any }): { request: ArticleRequest; calls: RecordedRequest[] } {
	const calls: RecordedRequest[] = [];
	const request: ArticleRequest = async (options) => {
		calls.push({ uri: options.uri, method: options.method, body: options.body });
		const key = `${options.method} ${options.uri}`;
		return responses[key];
	};
	return { request, calls };
}

const column = { id: "col-1", title: "我的专栏" } as IColumn;

function basePayload() {
	return {
		articleId: "123456",
		title: "标题",
		content: "<p>body</p>",
		titleImage: "https://pic1.zhimg.com/cover.png",
		isTitleImageFullScreen: false,
		column,
		commentPermission: "anyone",
	};
}

function urls(method: string, calls: RecordedRequest[]): string[] {
	return calls.filter(c => c.method === method).map(c => c.uri);
}

suite("submitArticleUpdate request ordering", () => {
	test("patches the draft then publishes", async () => {
		const { request, calls } = fakeRequest({
			"patch https://zhuanlan.zhihu.com/api/articles/123456/draft": { statusCode: 200, body: {} },
			"put https://zhuanlan.zhihu.com/api/articles/123456/publish": { statusCode: 200, body: {} },
		});
		const result = await submitArticleUpdate(basePayload(), request);
		assert.strictEqual(result.ok, true);
		assert.strictEqual(calls.length, 2);
		assert.strictEqual(calls[0].method, "patch");
		assert.strictEqual(calls[1].method, "put");
	});

	test("a failing PATCH must not trigger PUT", async () => {
		const { request, calls } = fakeRequest({
			"patch https://zhuanlan.zhihu.com/api/articles/123456/draft": {
				statusCode: 403,
				body: { error: { message: "FORBIDDEN" } },
			},
			"put https://zhuanlan.zhihu.com/api/articles/123456/publish": { statusCode: 200, body: {} },
		});
		const result = await submitArticleUpdate(basePayload(), request);
		assert.strictEqual(result.ok, false);
		assert.strictEqual(result.stage, "patch");
		assert.strictEqual(result.statusCode, 403);
		assert.strictEqual(result.errorSummary, "FORBIDDEN");
		assert.strictEqual(urls("put", calls).length, 0);
	});

	test("a missing network response must not trigger PUT", async () => {
		const { request, calls } = fakeRequest({});
		const result = await submitArticleUpdate(basePayload(), request);
		assert.strictEqual(result.ok, false);
		assert.strictEqual(result.stage, "patch");
		assert.strictEqual(urls("put", calls).length, 0);
	});

	test("a failing PUT is reported separately from the patch stage", async () => {
		const { request, calls } = fakeRequest({
			"patch https://zhuanlan.zhihu.com/api/articles/123456/draft": { statusCode: 200, body: {} },
			"put https://zhuanlan.zhihu.com/api/articles/123456/publish": { statusCode: 500, body: "boom" },
		});
		const result = await submitArticleUpdate(basePayload(), request);
		assert.strictEqual(result.ok, false);
		assert.strictEqual(result.stage, "publish");
		assert.strictEqual(result.statusCode, 500);
		assert.strictEqual(calls.length, 2);
	});

	test("original column and comment permission are preserved", async () => {
		const { request, calls } = fakeRequest({
			"patch https://zhuanlan.zhihu.com/api/articles/123456/draft": { statusCode: 204, body: {} },
			"put https://zhuanlan.zhihu.com/api/articles/123456/publish": { statusCode: 200, body: {} },
		});
		await submitArticleUpdate({ ...basePayload(), commentPermission: "no_one" }, request);
		const publishBody = calls[1].body;
		assert.strictEqual(publishBody.column.id, "col-1");
		assert.strictEqual(publishBody.commentPermission, "no_one");
	});

	test("removing the cover sends an explicit clear value", async () => {
		const { request, calls } = fakeRequest({
			"patch https://zhuanlan.zhihu.com/api/articles/123456/draft": { statusCode: 200, body: {} },
			"put https://zhuanlan.zhihu.com/api/articles/123456/publish": { statusCode: 200, body: {} },
		});
		await submitArticleUpdate({ ...basePayload(), titleImage: null }, request);
		assert.strictEqual(calls[0].body.titleImage, "");
		// undefined means "leave untouched" and must stay out of the body
		await submitArticleUpdate({ ...basePayload(), titleImage: undefined }, request);
		assert.strictEqual(calls[2].body.titleImage, undefined);
	});

	test("detail comment permission values map to the publish enum", async () => {
		const { request, calls } = fakeRequest({
			"patch https://zhuanlan.zhihu.com/api/articles/123456/draft": { statusCode: 200, body: {} },
			"put https://zhuanlan.zhihu.com/api/articles/123456/publish": { statusCode: 200, body: {} },
		});
		// detail returns "all" but publishing with "all" 500s live: it must be sent as "anyone"
		await submitArticleUpdate({ ...basePayload(), commentPermission: "all" }, request);
		assert.strictEqual(calls[1].body.commentPermission, "anyone");
		await submitArticleUpdate({ ...basePayload(), commentPermission: "weird_new_value" }, request);
		assert.strictEqual(calls[3].body.commentPermission, "anyone");
	});

	test("no column omits the key instead of sending null", async () => {
		const { request, calls } = fakeRequest({
			"patch https://zhuanlan.zhihu.com/api/articles/123456/draft": { statusCode: 200, body: {} },
			"put https://zhuanlan.zhihu.com/api/articles/123456/publish": { statusCode: 200, body: {} },
		});
		await submitArticleUpdate({ ...basePayload(), column: null }, request);
		assert.strictEqual("column" in calls[1].body, false);
		assert.strictEqual(calls[1].body.commentPermission, "anyone");
	});

	test("update without article id fails without any request", async () => {
		const { request, calls } = fakeRequest({});
		const result = await submitArticleUpdate({ ...basePayload(), articleId: undefined }, request);
		assert.strictEqual(result.ok, false);
		assert.strictEqual(calls.length, 0);
	});

	test("extractErrorSummary prefers the api message", () => {
		assert.strictEqual(extractErrorSummary({ error: { message: "UPVOTE_FAIL" } }), "UPVOTE_FAIL");
		assert.strictEqual(extractErrorSummary("short"), "short");
		assert.strictEqual(extractErrorSummary(undefined), "");
	});
});
