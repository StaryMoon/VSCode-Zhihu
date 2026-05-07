import * as vscode from "vscode";
import { MediaTypes } from "../const/ENUM";
import { QuestionURL } from "../const/URL";
import { extractZhihuIdFromUrl } from "../util/zhihu-id";

export class DraftService {
	public async createDraft() {
		const draftType = await vscode.window.showQuickPick(
			[
				{
					label: "Article",
					description: "Publish as a new Zhihu column article",
					value: "article"
				},
				{
					label: "Answer",
					description: "Answer a question or update an existing answer",
					value: "answer"
				}
			],
			{
				placeHolder: "Choose a Zhihu draft type"
			}
		);

		if (!draftType) return;

		const targetUrl = draftType.value === "answer"
			? await vscode.window.showInputBox({
				prompt: "Optional: paste a Zhihu question or answer URL. It will be written as a #! target link.",
				placeHolder: "https://www.zhihu.com/question/..."
			})
			: "";

		const title = await vscode.window.showInputBox({
			prompt: "Draft title. For articles, Zhihu On VSCode will use the first H1 as the article title.",
			value: "Untitled Zhihu Draft"
		});

		const document = await vscode.workspace.openTextDocument({
			language: "markdown",
			content: this.renderDraft(draftType.value, title || "Untitled Zhihu Draft", targetUrl || "")
		});

		await vscode.window.showTextDocument(document, {
			preview: false,
			viewColumn: vscode.ViewColumn.One
		});
	}

	public async createAnswerDraftFromTarget(node?: any) {
		const target = node && node.target ? node.target : node;
		let questionId = "";
		let questionUrl = "";

		if (target) {
			const question = target.question;
			if (target.type === MediaTypes.question || target.type === "question_ask") {
				questionId = extractZhihuIdFromUrl(target.url, MediaTypes.question) || String(target.id || "");
			} else if (question) {
				questionId = extractZhihuIdFromUrl(question.url, MediaTypes.question) || String(question.id || "");
			}
		}

		if (!questionId) {
			const pastedUrl = await vscode.window.showInputBox({
				prompt: "Paste a Zhihu question URL. The draft will publish as an answer.",
				placeHolder: "https://www.zhihu.com/question/19602618",
				validateInput: (value) => {
					if (!value.trim()) return "Please paste a Zhihu question URL.";
					return extractZhihuIdFromUrl(value, MediaTypes.question)
						? ""
						: "Only Zhihu question URLs are supported here.";
				}
			});
			if (!pastedUrl) return;
			questionId = extractZhihuIdFromUrl(pastedUrl, MediaTypes.question) || "";
		}

		questionUrl = `${QuestionURL}/${questionId}`;
		const document = await vscode.workspace.openTextDocument({
			language: "markdown",
			content: this.renderAnswerDraft(questionUrl)
		});

		await vscode.window.showTextDocument(document, {
			preview: false,
			viewColumn: vscode.ViewColumn.One
		});
	}

	private renderDraft(type: string, title: string, targetUrl: string) {
		const shebang = targetUrl.trim() ? `#! ${targetUrl.trim()}\n\n` : "";
		if (type === "answer") {
			return shebang;
		}

		return `${shebang}# ${title}

> 这是一篇用 Zhihu On VSCode 创建的文章草稿。

## TL;DR

- 一句话说明这篇内容解决了什么问题。
- 给读者一个可以立即尝试的结论或命令。

## 背景

这里写为什么要做这件事、原本遇到的限制，以及你希望读者带走什么。

## 过程

1. 先记录可复现的问题。
2. 再写修复或实验的关键步骤。
3. 最后给出你实际验证过的结果。

## 踩坑

- 这里放环境、版本、接口变化、登录状态、缓存等容易被忽略的问题。

## 小结

把经验收束到 2-3 个要点，方便读者收藏和转发。
`;
	}

	private renderAnswerDraft(questionUrl: string) {
		return `#! ${questionUrl}\n\n`;
	}
}
