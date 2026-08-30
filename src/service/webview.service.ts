import * as path from "path";
import { compileFile } from "pug";
import * as vscode from "vscode";
import { MediaTypes, SettingEnum, WebviewEvents } from "../const/ENUM";
import { TemplatePath, ZhihuIconPath } from "../const/PATH";
import { AnswerAPI, AnswerURL, ArticleAPI, QuestionAPI, QuestionURL, ZhuanlanAPI, ZhuanlanURL } from "../const/URL";
import { IArticle } from "../model/article/article-detail";
import { IQuestionAnswerTarget, IQuestionTarget, ITarget } from "../model/target/target";
import { CollectionTreeviewProvider } from "../treeview/collection-treeview-provider";
import { CollectionService, ICollectionItem } from "./collection.service";
import { sendRequest } from "./http.service";
import { getExtensionPath, getSubscriptions } from "../global/globa-var";
import { resolveTargetId, withResolvedTargetId } from "../util/zhihu-id";

export interface IWebviewPugRender {
	viewType?: string,
	title?: string,
	showOptions?: vscode.ViewColumn | { viewColumn: vscode.ViewColumn, preserveFocus?: boolean },
	options?: vscode.WebviewOptions & vscode.WebviewPanelOptions,
	pugTemplatePath: string,
	pugObjects?: any,
	iconPath?: any
}

export class WebviewService {

	constructor(
		protected collectService: CollectionService,
		protected collectionTreeviewProvider: CollectionTreeviewProvider
	) {
	}

	public renderHtml(w: IWebviewPugRender, panel?: vscode.WebviewPanel): vscode.WebviewPanel {
		if (panel == undefined) {
			panel = vscode.window.createWebviewPanel(
				w.viewType ? w.viewType : "zhihu",
				w.title ? w.title : "知乎",
				w.showOptions ? w.showOptions : vscode.ViewColumn.One,
				w.options ? w.options : { enableScripts: true }
			);
		}
		const compiledFunction = compileFile(w.pugTemplatePath);
		panel.iconPath = vscode.Uri.file(w.iconPath ? w.iconPath : path.join(
			getExtensionPath(),
			ZhihuIconPath
		));
		panel.webview.html = compiledFunction(w.pugObjects);
		return panel;
	}

	public async openWebview(object: ITarget & any) {
		if (object.type == MediaTypes.question) {
			const includeContent = "is_normal,content,voteup_count,comment_count,thanks_count,favlists_count";
			const questionId = resolveTargetId(object);
			const questionAPI = `${QuestionAPI}/${questionId}?include=detail%2cexcerpt`;
			const answerAPI = `${QuestionAPI}/${questionId}/answers?include=${includeContent}&offset=0`;
			const question: IQuestionTarget = await sendRequest({
				uri: questionAPI,
				json: true,
				gzip: true
			});
			const body: { data: IQuestionAnswerTarget[] } = await sendRequest({
				uri: answerAPI,
				json: true,
				gzip: true
			});
			const useVSTheme = vscode.workspace.getConfiguration("zhihu").get(SettingEnum.useVSTheme);

			const panel = this.renderHtml({
				title: "知乎问题",
				pugTemplatePath: path.join(
					getExtensionPath(),
					TemplatePath,
					"questions-answers.pug"
				),
				pugObjects: {
					answers: (body && body.data ? body.data : []).map(answer => {
						const normalizedAnswer = withResolvedTargetId(answer);
						normalizedAnswer.content = this.actualSrcNormalize(normalizedAnswer.content);
						return normalizedAnswer;
					}),
					title: question && question.title ? question.title : object.title,
					subTitle: question && question.detail ? question.detail : (object.excerpt || ""),
					useVSTheme
				}
			});
			this.registerEvent(
				panel,
				{ type: MediaTypes.question, id: questionId.toString() },
				`${QuestionURL}/${resolveTargetId(question) || questionId}`
			);
		} else if (object.type == MediaTypes.answer) {
			const answerId = resolveTargetId(object);
			const body: IQuestionAnswerTarget = await sendRequest({
				uri: `${AnswerAPI}/${answerId}?include=content,excerpt,voteup_count,comment_count,thanks_count,favlists_count`,
				json: true,
				gzip: true
			});
			const useVSTheme = vscode.workspace.getConfiguration("zhihu").get(SettingEnum.useVSTheme);
			const normalizedAnswer = withResolvedTargetId(body);
			normalizedAnswer.content = this.actualSrcNormalize(normalizedAnswer.content);
			const questionTitle = object.question ? (object.question.title || object.question.name || "") : "";
			const panel = this.renderHtml({
				title: "知乎回答",
				pugTemplatePath: path.join(
					getExtensionPath(),
					TemplatePath,
					"questions-answers.pug"
				),
				pugObjects: {
					answers: [normalizedAnswer],
					title: questionTitle,
					useVSTheme
				}
			});
			this.registerEvent(panel, { type: MediaTypes.answer, id: answerId }, `${AnswerURL}/${answerId}`);
		} else if (object.type == MediaTypes.article) {
			const articleId = resolveTargetId(object);
			// The public v4 article endpoint is risk-controlled (403 code 10003);
			// zhuanlan's own API returns content, author and vote/comment/favlists
			// counts for both own and others' articles — live verified.
			const article: IArticle = await sendRequest({
				uri: `${ZhuanlanAPI}/${articleId}`,
				json: true,
				gzip: true,
				headers: null
			});
			const useVSTheme = vscode.workspace.getConfiguration("zhihu").get(SettingEnum.useVSTheme);
			const normalizedArticle = withResolvedTargetId(article);
			normalizedArticle.content = this.actualSrcNormalize(normalizedArticle.content);
			const panel = this.renderHtml({
				title: "知乎文章",
				pugTemplatePath: path.join(
					getExtensionPath(),
					TemplatePath,
					"article.pug"
				),
				pugObjects: {
					article: normalizedArticle,
					title: normalizedArticle.title,
					useVSTheme
				}
			});
			this.registerEvent(panel, { type: MediaTypes.article, id: articleId }, `${ZhuanlanURL}${articleId}`);
		}
	}

	private registerEvent(panel: vscode.WebviewPanel, defaultCollectionItem: ICollectionItem, link?: string) {
		panel.webview.onDidReceiveMessage(async event => {
			if (event.command == WebviewEvents.collect) {
				const collectionItem: ICollectionItem = event && event.id && event.itemType
					? { id: event.id.toString(), type: event.itemType }
					: defaultCollectionItem;
				if (collectionItem.type == MediaTypes.question) {
					vscode.window.showWarningMessage("问题页暂不支持顶部收藏，请使用回答下方的收藏按钮。");
					return;
				}
				if (await this.collectService.addItem(collectionItem)) {
					vscode.window.showInformationMessage("收藏成功！");
				} else {
					vscode.window.showWarningMessage("收藏失败，请稍后重试并查看 ZHIHU 输出。");
				}
				this.collectionTreeviewProvider.refresh();
			} else if (event.command == WebviewEvents.open) {
				if (link) {
					vscode.env.openExternal(vscode.Uri.parse(link));
				}
			} else if (event.command == WebviewEvents.share) {
				if (link) {
					vscode.env.clipboard.writeText(link).then(() => {
						vscode.window.showInformationMessage("链接已复制至剪贴板。");
					});
				}
			} else if (event.command == WebviewEvents.editArticle) {
				const articleId = event.id ? event.id.toString() : defaultCollectionItem.id;
				vscode.commands.executeCommand("zhihu.editArticle", {
					type: MediaTypes.article,
					id: articleId,
					url: `${ZhuanlanURL}${articleId}`
				});
			} else if (event.command == WebviewEvents.upvoteAnswer) {
				sendRequest({
					uri: `${AnswerAPI}/${event.id}/voters`,
					method: "post",
					headers: {},
					json: true,
					body: { type: "up" },
					resolveWithFullResponse: true
				}).then(response => {
					if (response.statusCode == 200) {
						vscode.window.showInformationMessage("点赞成功！");
					} else if (response.statusCode == 403) {
						vscode.window.showWarningMessage("你已经投过票了！");
					}
				});
			} else if (event.command == WebviewEvents.upvoteArticle) {
				sendRequest({
					uri: `${ArticleAPI}/${event.id}/voters`,
					method: "post",
					headers: {},
					json: true,
					body: { voting: 1 },
					resolveWithFullResponse: true
				}).then(response => {
					if (response.statusCode == 200) {
						vscode.window.showInformationMessage("点赞成功！");
					} else if (response.statusCode == 403) {
						vscode.window.showWarningMessage("你已经投过票了！");
					}
				});
			}
		}, undefined, getSubscriptions());
	}

	private actualSrcNormalize(html?: string): string {
		return (html || "").replace(/<\/?noscript>/g, "");
	}
}
