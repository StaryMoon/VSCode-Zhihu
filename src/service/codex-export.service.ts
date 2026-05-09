import * as cheerio from "cheerio";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { QuestionAPI, QuestionURL } from "../const/URL";
import { IQuestionAnswerTarget, IQuestionTarget, ISearchTarget } from "../model/target/target";
import { removeHtmlTag, removeSpace } from "../util/md-html-utils";
import { extractZhihuIdFromUrl, resolveTargetId } from "../util/zhihu-id";
import { sendRequest } from "./http.service";

const ANSWER_INCLUDE = [
	"is_normal",
	"content",
	"excerpt",
	"question",
	"voteup_count",
	"comment_count",
	"thanks_count",
	"favlists_count",
	"created_time",
	"updated_time",
	"is_collapsed",
	"author.follower_count",
	"author.badge[*].topics"
].join(",");

interface ExportOptions {
	questionId: string;
	maxAnswers: number;
	sortBy: string;
}

interface ExportResult {
	filePath: string;
	questionTitle: string;
	answerCount: number;
}

export class CodexExportService {
	public async exportQuestionForCodex(input?: string): Promise<ExportResult | undefined> {
		const questionInput = input || await vscode.window.showInputBox({
			ignoreFocusOut: true,
			prompt: "Paste a Zhihu question link or question id",
			placeHolder: "https://www.zhihu.com/question/15442729471"
		});
		if (!questionInput) return;

		const questionId = this.extractQuestionId(questionInput);
		if (!questionId) {
			vscode.window.showWarningMessage("没有识别到知乎问题 ID。请粘贴 question 链接或纯数字 ID。");
			return;
		}
		return this.exportQuestionByIdWithPrompt(questionId);
	}

	public async exportQuestionBySearchTarget(target: ISearchTarget): Promise<ExportResult | undefined> {
		const questionId = this.extractQuestionIdFromTarget(target);
		if (!questionId) {
			vscode.window.showWarningMessage("搜索结果里没有识别到知乎问题 ID。");
			return;
		}
		return this.exportQuestionByIdWithPrompt(questionId);
	}

	private async exportQuestionByIdWithPrompt(questionId: string): Promise<ExportResult | undefined> {
		const answerLimitInput = await vscode.window.showInputBox({
			ignoreFocusOut: true,
			prompt: "How many answers should be exported? Use all to export every answer.",
			placeHolder: "20",
			value: "20"
		});
		if (answerLimitInput === undefined) return;

		const maxAnswers = this.parseAnswerLimit(answerLimitInput);
		if (!maxAnswers) {
			vscode.window.showWarningMessage("回答数量请输入正整数，或者输入 all。");
			return;
		}
		const sortBy = await vscode.window.showQuickPick([
			{ label: "默认排序", value: "default" },
			{ label: "按时间排序", value: "updated" }
		], {
			ignoreFocusOut: true,
			placeHolder: "选择回答排序方式"
		}).then(item => item ? item.value : undefined);
		if (!sortBy) return;

		return vscode.window.withProgress<ExportResult | undefined>({
			location: vscode.ProgressLocation.Notification,
			title: `Exporting Zhihu question ${questionId} for Codex`,
			cancellable: false
		}, async progress => {
			progress.report({ message: "Fetching question..." });
			const question = await this.fetchQuestion(questionId);
			progress.report({ message: "Fetching answers..." });
			const answers = await this.fetchAnswers({ questionId, maxAnswers, sortBy }, progress);
			progress.report({ message: "Writing Markdown..." });
			const filePath = this.writeMarkdown(questionId, question, answers, sortBy);
			const doc = await vscode.workspace.openTextDocument(filePath);
			await vscode.window.showTextDocument(doc);
			vscode.window.showInformationMessage(`已导出知乎问题和 ${answers.length} 个回答：${filePath}`);
			return {
				filePath,
				questionTitle: question && question.title ? question.title : questionId,
				answerCount: answers.length
			};
		});
	}

	private async fetchQuestion(questionId: string): Promise<IQuestionTarget | undefined> {
		const question = await sendRequest({
			uri: `${QuestionAPI}/${questionId}?include=detail%2Cexcerpt%2Cfollower_count%2Canswer_count%2Ccomment_count%2Ccreated%2Cupdated_time`,
			json: true,
			gzip: true,
			useRawCookieHeader: true
		});
		if (!question || question.error) return undefined;
		return question;
	}

	private async fetchAnswers(options: ExportOptions, progress?: vscode.Progress<{ message?: string; increment?: number }>): Promise<IQuestionAnswerTarget[]> {
		const answers: IQuestionAnswerTarget[] = [];
		const pageLimit = 20;
		let offset = 0;
		let isEnd = false;
		while (!isEnd && answers.length < options.maxAnswers) {
			const limit = Math.min(pageLimit, options.maxAnswers - answers.length);
			const body = await sendRequest({
				uri: `${QuestionAPI}/${options.questionId}/answers?include=${encodeURIComponent(ANSWER_INCLUDE)}&offset=${offset}&limit=${limit}&sort_by=${options.sortBy}`,
				json: true,
				gzip: true,
				useRawCookieHeader: true
			});
			const data = body && body.data ? body.data : [];
			answers.push.apply(answers, data);
			offset += data.length;
			if (progress) {
				progress.report({ message: `Fetched ${answers.length} answers...` });
			}
			isEnd = !data.length || (body && body.paging && body.paging.is_end);
		}
		return answers.slice(0, options.maxAnswers);
	}

	private writeMarkdown(questionId: string, question: IQuestionTarget | undefined, answers: IQuestionAnswerTarget[], sortBy: string): string {
		const outputDir = path.join(os.homedir(), "Downloads", "zhihu-drafts");
		if (!fs.existsSync(outputDir)) {
			fs.mkdirSync(outputDir, { recursive: true });
		}
		const filePath = path.join(outputDir, `zhihu-question-${questionId}.md`);
		const fallbackQuestion = answers.length && answers[0].question ? answers[0].question : undefined;
		const questionTitle = question && question.title
			? question.title
			: fallbackQuestion && fallbackQuestion.title
				? fallbackQuestion.title
				: `Zhihu Question ${questionId}`;
		const lines: string[] = [];
		lines.push(`# ${this.escapeMarkdown(questionTitle)}`);
		lines.push("");
		lines.push(`- Question ID: ${questionId}`);
		lines.push(`- URL: ${QuestionURL}/${questionId}`);
		lines.push(`- Exported At: ${new Date().toISOString()}`);
		lines.push(`- Sort: ${sortBy}`);
		if (question) {
			if ((question as any).answer_count !== undefined) lines.push(`- Answer Count: ${(question as any).answer_count}`);
			if ((question as any).follower_count !== undefined) lines.push(`- Follower Count: ${(question as any).follower_count}`);
			if ((question as any).comment_count !== undefined) lines.push(`- Comment Count: ${(question as any).comment_count}`);
		}
		lines.push("");
		lines.push("## Question Detail");
		lines.push("");
		lines.push(this.htmlToMarkdown(question && question.detail ? question.detail : question && question.excerpt ? question.excerpt : fallbackQuestion && fallbackQuestion.excerpt ? fallbackQuestion.excerpt : ""));
		lines.push("");
		lines.push(`## Answers Exported (${answers.length})`);
		lines.push("");
		answers.forEach((answer, index) => {
			const author = answer.author || {} as any;
			const answerId = resolveTargetId(answer);
			lines.push(`### ${index + 1}. ${this.escapeMarkdown(author.name || "匿名用户")} · ${answer.voteup_count || 0} 赞 · ${answer.comment_count || 0} 评论`);
			lines.push("");
			lines.push(`- Answer ID: ${answerId || answer.id || ""}`);
			lines.push(`- URL: ${QuestionURL}/${questionId}/answer/${answerId || answer.id || ""}`);
			if (author.headline) lines.push(`- Author Headline: ${this.escapeMarkdown(removeSpace(removeHtmlTag(author.headline)))}`);
			if (author.follower_count !== undefined) lines.push(`- Author Followers: ${author.follower_count}`);
			if (answer.created_time) lines.push(`- Created: ${new Date(answer.created_time * 1000).toISOString()}`);
			if (answer.updated_time) lines.push(`- Updated: ${new Date(answer.updated_time * 1000).toISOString()}`);
			lines.push("");
			lines.push(this.htmlToMarkdown(answer.content || answer.excerpt || ""));
			lines.push("");
			lines.push("---");
			lines.push("");
		});
		fs.writeFileSync(filePath, lines.join("\n"), "utf8");
		return filePath;
	}

	private extractQuestionId(input: string): string | undefined {
		const trimmed = input.trim();
		if (/^\d+$/.test(trimmed)) return trimmed;
		return extractZhihuIdFromUrl(trimmed, "question");
	}

	private extractQuestionIdFromTarget(target: ISearchTarget): string | undefined {
		if (!target) return undefined;
		if (target.type === "question" && target.id !== undefined && target.id !== null) return String(target.id);
		const fromUrl = extractZhihuIdFromUrl(target.url, "question");
		if (fromUrl) return fromUrl;
		return target.id !== undefined && target.id !== null ? String(target.id) : undefined;
	}

	private parseAnswerLimit(input: string): number | undefined {
		const normalized = input.trim().toLowerCase();
		if (normalized === "all" || normalized === "全部") {
			return Number.MAX_SAFE_INTEGER;
		}
		const parsed = parseInt(normalized, 10);
		return parsed > 0 ? parsed : undefined;
	}

	private htmlToMarkdown(html: string): string {
		if (!html) return "";
		const $ = cheerio.load(`<article>${html}</article>`, { decodeEntities: true });
		$("br").replaceWith("\n");
		$("img").each((_, img) => {
			const $img = $(img);
			const src = $img.attr("data-original") || $img.attr("data-actualsrc") || $img.attr("src");
			$img.replaceWith(src ? `\n![](${src})\n` : "");
		});
		$("a").each((_, link) => {
			const $link = $(link);
			const text = $link.text();
			const href = $link.attr("href");
			$link.replaceWith(href && href !== text ? `${text} (${href})` : text);
		});
		$("pre").each((_, pre) => {
			const code = $(pre).text();
			$(pre).replaceWith(`\n\n\`\`\`\n${code.trim()}\n\`\`\`\n\n`);
		});
		$("code").each((_, code) => {
			const $code = $(code);
			$code.replaceWith(`\`${$code.text()}\``);
		});
		$("li").each((_, li) => {
			const $li = $(li);
			$li.prepend("- ");
			$li.append("\n");
		});
		$("p, div, h1, h2, h3, h4, blockquote, figure").each((_, block) => {
			$(block).append("\n\n");
		});
		return $("article").text()
			.replace(/\u00a0/g, " ")
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
	}

	private escapeMarkdown(text: string): string {
		return (text || "").replace(/\r?\n/g, " ").trim();
	}
}
