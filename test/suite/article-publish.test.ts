import * as assert from "assert";
import { IEvent } from "../../src/service/event.service";
import { PublishService, resolvePublishOperation, stripFrontMatter } from "../../src/service/publish.service";

interface FakeEventService {
	getEvents(): IEvent[];
	registerEvent(e: IEvent): boolean;
	destroyEvent(hash: string): void;
	armEvent(e: IEvent): void;
}

function createService(events: IEvent[], destroyed: string[], armed: IEvent[]): any {
	const fakeEventService: FakeEventService = {
		getEvents: () => events,
		registerEvent: () => true,
		destroyEvent: (hash: string) => {
			const index = events.findIndex(e => e.hash === hash);
			if (index >= 0) {
				events.splice(index, 1);
			}
			destroyed.push(hash);
		},
		armEvent: (e: IEvent) => {
			armed.push(e);
		},
	};
	return new PublishService(null as any, null as any, null as any, null as any, fakeEventService as any, null as any, null as any, null as any);
}

suite("Publish routing by shebang target", () => {
	test("yaml front matter after the shebang line is stripped", () => {
		const text = "---\ntitle: CMU 10-714\ncategories: CMU10714\nmath: true\n---\n\n# 标题\n\n正文\n";
		assert.strictEqual(stripFrontMatter(text), "# 标题\n\n正文\n");
	});

	test("plain thematic breaks are never stripped", () => {
		assert.strictEqual(stripFrontMatter("---\n正文没有 front matter\n"), "---\n正文没有 front matter\n");
		assert.strictEqual(stripFrontMatter("---\nplain text\n---tail\n"), "---\nplain text\n---tail\n");
		assert.strictEqual(stripFrontMatter("# 普通文档\n\n---\n\n分隔线\n"), "# 普通文档\n\n---\n\n分隔线\n");
	});

	test("article links (with or without trailing slash) update the article", () => {
		assert.strictEqual(resolvePublishOperation(new URL("https://zhuanlan.zhihu.com/p/123456")), "updateArticle");
		assert.strictEqual(resolvePublishOperation(new URL("https://zhuanlan.zhihu.com/p/123456/")), "updateArticle");
	});

	test("question links post a new answer and answer links update it", () => {
		assert.strictEqual(resolvePublishOperation(new URL("https://www.zhihu.com/question/19602618")), "postAnswer");
		assert.strictEqual(resolvePublishOperation(new URL("https://www.zhihu.com/question/1/answer/2")), "updateAnswer");
		assert.strictEqual(resolvePublishOperation(new URL("https://www.zhihu.com/answer/2")), "updateAnswer");
	});

	test("unknown targets never route to article update or new article", () => {
		assert.strictEqual(resolvePublishOperation(new URL("https://zhuanlan.zhihu.com/pub/article/123")), undefined);
		assert.strictEqual(resolvePublishOperation(new URL("https://www.zhihu.com/people/someone")), undefined);
	});
});

suite("Scheduled publish task recovery", () => {
	test("restored updateArticle runs putArticle and never postArticle", () => {
		const updateTask: IEvent = {
			operation: "updateArticle",
			targetId: "123456",
			content: "<p>body</p>",
			title: "标题",
			titleImage: null,
			commentPermission: "followees",
			hash: "hash-update",
			date: new Date(Date.now() + 60000),
		};
		const destroyed: string[] = [];
		const armed: IEvent[] = [];
		const service = createService([updateTask], destroyed, armed);

		let putPayload: any;
		let postCalls = 0;
		service.putArticle = (payload: any) => {
			putPayload = payload;
			return Promise.resolve(true);
		};
		service.postArticle = () => {
			postCalls += 1;
			return Promise.resolve(undefined);
		};

		assert.deepStrictEqual(destroyed, []);
		assert.strictEqual(armed.length, 1);
		assert.ok(updateTask.handler, "restored task must get a rebuilt handler");
		updateTask.handler!();

		assert.ok(putPayload, "putArticle must run for updateArticle tasks");
		assert.strictEqual(putPayload.articleId, "123456");
		assert.strictEqual(putPayload.commentPermission, "followees");
		assert.strictEqual(putPayload.titleImage, null);
		assert.strictEqual(postCalls, 0, "update must never call postArticle");
	});

	test("restored postAnswer only calls postAnswer", () => {
		const task: IEvent = {
			operation: "postAnswer",
			targetId: "999",
			content: "<p>a</p>",
			hash: "hash-answer",
			date: new Date(Date.now() + 60000),
		};
		const destroyed: string[] = [];
		const armed: IEvent[] = [];
		const service = createService([task], destroyed, armed);
		let postAnswerCalls = 0;
		let putAnswerCalls = 0;
		service.postAnswer = () => {
			postAnswerCalls += 1;
		};
		service.putAnswer = () => {
			putAnswerCalls += 1;
		};
		task.handler!();
		assert.strictEqual(postAnswerCalls, 1);
		assert.strictEqual(putAnswerCalls, 0);
	});

	test("tasks without recoverable operation info are dropped, not guessed", () => {
		const legacy: any = {
			content: "<p>legacy</p>",
			type: "article",
			hash: "hash-legacy",
			date: new Date(Date.now() + 60000),
		};
		const destroyed: string[] = [];
		const armed: IEvent[] = [];
		const service = createService([legacy], destroyed, armed);
		let anyCall = false;
		service.postArticle = () => {
			anyCall = true;
		};
		service.putArticle = () => {
			anyCall = true;
		};
		assert.deepStrictEqual(destroyed, ["hash-legacy"]);
		assert.strictEqual(armed.length, 0);
		assert.strictEqual(legacy.handler, undefined);
		assert.strictEqual(anyCall, false);
	});

	test("update tasks missing their target id are dropped", () => {
		const broken: any = {
			operation: "updateArticle",
			content: "<p>body</p>",
			title: "t",
			hash: "hash-broken",
			date: new Date(Date.now() + 60000),
		};
		const destroyed: string[] = [];
		const armed: IEvent[] = [];
		createService([broken], destroyed, armed);
		assert.deepStrictEqual(destroyed, ["hash-broken"]);
		assert.strictEqual(armed.length, 0);
	});
});
