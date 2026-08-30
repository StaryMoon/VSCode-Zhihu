import * as vscode from "vscode";
import { Output } from "../global/logger";
import { ArticleEditTarget, EditableArticle } from "../model/article/article-edit";
import { ZhuanlanURL } from "../const/URL";
import { htmlToMarkdown } from "../util/html-to-markdown";
import { extractArticleId, resolveArticleIdFromTarget } from "../util/zhihu-id";
import { ArticleRequest, fetchArticleDetail } from "./article-api";
import { sendRequest } from "./http.service";
import { ProfileService } from "./profile.service";

/**
 * Build the editable Markdown draft for an article:
 *
 * ```markdown
 * #! https://zhuanlan.zhihu.com/p/<id>
 *
 * ![文章封面](<cover>)     // only when the article has a cover
 *
 * # <title>
 *
 * <converted content>
 * ```
 *
 * The `#!` first line keeps the article identity so publishing the document
 * later updates the original article. Returns `undefined` for articles
 * without title or content, so no empty draft is ever produced. Pure
 * function (besides the converter) for unit testing.
 */
export function buildArticleDraftMarkdown(article: EditableArticle): string | undefined {
    const title = (article.title || "").replace(/\s+/g, " ").trim();
    if (!article.id || !title || !(article.content || "").trim()) {
        return undefined;
    }
    const body = htmlToMarkdown(article.content, {
        onWarn: message => Output(`Article ${article.id} convert: ${message}`, undefined),
    });
    const lines: string[] = [];
    lines.push(`#! ${ZhuanlanURL}${article.id}`);
    lines.push("");
    if (article.titleImage) {
        lines.push(`![文章封面](${article.titleImage})`);
        lines.push("");
    }
    lines.push(`# ${title}`);
    lines.push("");
    lines.push(body);
    lines.push("");
    return lines.join("\n");
}

/**
 * Opens an existing zhihu article as an editable Markdown document. The
 * document is an untitled buffer: it never overwrites local files, and the
 * existing `Zhihu: Publish Current Markdown` command updates the original
 * article through the `#!` first line.
 */
export class ArticleEditService {
    constructor(
        protected profileService: ProfileService,
        protected request: ArticleRequest = sendRequest
    ) {}

    public async editArticle(target?: ArticleEditTarget): Promise<void> {
        const articleId = await this.resolveArticleId(target);
        if (!articleId) {
            return;
        }
        const article = await this.fetchArticleForEdit(articleId);
        if (!article) {
            return;
        }
        if (!(await this.confirmAuthorship(article))) {
            return;
        }
        const markdown = buildArticleDraftMarkdown(article);
        if (!markdown) {
            vscode.window.showWarningMessage("该文章没有可编辑的正文或标题，已终止生成草稿。");
            return;
        }
        const document = await vscode.workspace.openTextDocument({ language: "markdown", content: markdown });
        await vscode.window.showTextDocument(document, {
            preview: false,
            viewColumn: vscode.ViewColumn.One,
        });
    }

    /**
     * Accepts tree node targets, webview payloads and free user input. With
     * no target at all (command palette) an input box asks for the article
     * url or id; only strict zhihu article links are accepted.
     */
    private async resolveArticleId(target?: ArticleEditTarget): Promise<string | undefined> {
        if (target && (target.id !== undefined || target.url)) {
            const fromTarget = resolveArticleIdFromTarget(target);
            if (!fromTarget) {
                vscode.window.showWarningMessage("只能修改知乎专栏文章（https://zhuanlan.zhihu.com/p/…），问题和回答请使用对应的发布流程。");
            }
            return fromTarget || undefined;
        }
        const input = await vscode.window.showInputBox({
            ignoreFocusOut: true,
            prompt: "输入要修改的知乎文章链接或文章 ID",
            placeHolder: "https://zhuanlan.zhihu.com/p/123456",
            validateInput: (value: string) => {
                return extractArticleId(value)
                    ? ""
                    : "仅支持知乎文章链接（https://zhuanlan.zhihu.com/p/123456）或纯数字文章 ID。";
            },
        });
        if (input === undefined) {
            return undefined;
        }
        return extractArticleId(input);
    }

    private async fetchArticleForEdit(articleId: string): Promise<EditableArticle | undefined> {
        const detail = await fetchArticleDetail(articleId, this.request);
        if (!detail) {
            vscode.window.showWarningMessage(`读取文章 ${articleId} 失败：文章可能已删除、需要重新登录，或知乎接口已变化。`);
            return undefined;
        }
        if (!detail.title || !(detail.content || "").trim()) {
            vscode.window.showWarningMessage(`文章《${detail.title || articleId}》缺少可编辑的正文，已终止。`);
            return undefined;
        }
        return {
            id: articleId,
            title: detail.title,
            content: detail.content || "",
            titleImage: detail.title_image || detail.image_url || undefined,
            isTitleImageFullScreen: detail.is_title_image_full_screen === true,
            commentPermission: detail.comment_permission,
            column: detail.column || undefined,
            author: detail.author,
        };
    }

    /**
     * Front-end hint only: zhihu still decides permissions on PATCH/PUT, so
     * a mismatch only asks for confirmation instead of blocking.
     */
    private async confirmAuthorship(article: EditableArticle): Promise<boolean> {
        const profile = this.profileService.profile;
        if (!article.author || !profile) {
            return true;
        }
        const sameId = article.author.id !== undefined && String(article.author.id) === String(profile.id);
        const sameToken = !!article.author.url_token && !!profile.url_token && article.author.url_token === profile.url_token;
        if (sameId || sameToken) {
            return true;
        }
        const choice = await vscode.window.showWarningMessage(
            `《${article.title}》的作者是“${article.author.name || "未知用户"}”，不是当前登录账号。知乎只允许修改自己的文章，仍要打开草稿吗？`,
            "仍然编辑"
        );
        return choice === "仍然编辑";
    }
}
