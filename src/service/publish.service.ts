import { join } from "path";
import * as vscode from "vscode";
import { MediaTypes, SettingEnum } from "../const/ENUM";
import { TemplatePath } from "../const/PATH";
import {
    ArticlePathReg,
    QuestionAnswerPathReg,
    QuestionPathReg,
} from "../const/REG";
import {
    AnswerAPI,
    AnswerURL,
    QuestionAPI,
    ZhuanlanAPI,
    ZhuanlanURL,
} from "../const/URL";
import { ArticlePublishPayload } from "../model/article/article-edit";
import { PostAnswer } from "../model/publish/answer.model";
import { IColumn } from "../model/publish/column.model";
import { IProfile, ITarget } from "../model/target/target";
import { beautifyDate, removeHtmlTag } from "../util/md-html-utils";
import { CollectionService, ICollectionItem } from "./collection.service";
import { EventService, IEvent, isPublishOperation, PublishOperation } from "./event.service";
import { sendRequest } from "./http.service";
import { ProfileService } from "./profile.service";
import { WebviewService } from "./webview.service";
import * as MarkdownIt from "markdown-it";
import md5 = require("md5");
import { PasteService } from "./paste.service";
import { PipeService } from "./pipe.service";
import { getExtensionPath } from "../global/globa-var";
import { Output } from "../global/logger";
import { uploadMermaidToZhihu } from "../util/upload-mermaid";
import { ArticleUpdateResult, fetchArticleDetail, isSuccessStatus, submitArticleUpdate } from "./article-api";

enum previewActions {
    openInBrowser = "去看看",
}

interface TimeObject {
    hour: number;
    minute: number;

    /**
     * interval in millisec
     */
    date: Date;
}

/**
 * Decide what a first-line `#!` url means for publishing. Pure function so
 * routing (article update vs. new article vs. answers) is unit testable.
 */
export function resolvePublishOperation(url: URL): PublishOperation | undefined {
    if (QuestionAnswerPathReg.test(url.pathname)) {
        return "updateAnswer";
    }
    if (QuestionPathReg.test(url.pathname)) {
        return "postAnswer";
    }
    if (ArticlePathReg.test(url.pathname)) {
        return "updateArticle";
    }
    return undefined;
}

/**
 * Remove a Jekyll/Hexo style YAML front-matter block that appears at the
 * very beginning of the document (directly after the optional `#!` line).
 * Only strips a `---` opened and closed fenced block containing `key: value`
 * lines, so a plain thematic break (`---` alone) is never touched.
 */
export function stripFrontMatter(text: string): string {
    const lines = text.split("\n");
    if (!lines.length || !/^-{3,}\s*$/.test(lines[0])) {
        return text;
    }
    const limit = Math.min(lines.length - 1, 60);
    for (let i = 1; i <= limit; i++) {
        if (/^-{3,}\s*$/.test(lines[i]) || /^\.\.\.\s*$/.test(lines[i])) {
            const body = lines.slice(i + 1);
            const frontMatter = lines.slice(1, i);
            const isYaml = frontMatter.some(line => /^\s*[\w"'-]+\s*:(\s|$)/.test(line));
            if (!isYaml) {
                return text;
            }
            return body.join("\n").replace(/^\s*\n/, "");
        }
    }
    return text;
}

export class PublishService {
    public profile: IProfile;

    constructor(
        protected zhihuMdParser: MarkdownIt,
        protected defualtMdParser: MarkdownIt,
        protected webviewService: WebviewService,
        protected collectionService: CollectionService,
        protected eventService: EventService,
        protected profileService: ProfileService,
        protected pasteService: PasteService,
        protected pipeService: PipeService
    ) {
        this.registerPublishEvents();
    }

    /**
     * When extension starts, all publish events should be re-registered.
     * Restored tasks dispatch on the persisted `operation`, so a scheduled
     * article update re-executes `putArticle` after a restart and never
     * silently degrades into a new-article post. Tasks without recoverable
     * operation info are dropped with a warning instead of being guessed.
     */
    private registerPublishEvents() {
        const events = this.eventService.getEvents().slice();
        for (const e of events) {
            if (!isPublishOperation(e.operation) || !this.canDispatch(e)) {
                this.eventService.destroyEvent(e.hash);
                Output(`已丢弃缺少可恢复操作信息的定时发布任务（hash=${e.hash}），请重新安排发布。`, "warn");
                continue;
            }
            e.handler = () => {
                this.dispatchPublishEvent(e);
                this.eventService.destroyEvent(e.hash);
            };
            this.eventService.armEvent(e);
        }
    }

    private canDispatch(e: IEvent): boolean {
        switch (e.operation) {
            case "postArticle":
                return !!(e.content && e.title);
            case "updateArticle":
                return !!(e.content && e.title && e.targetId);
            case "postAnswer":
            case "updateAnswer":
                return !!(e.content && e.targetId);
            default:
                return false;
        }
    }

    private dispatchPublishEvent(e: IEvent) {
        switch (e.operation) {
            case "postArticle":
                this.postArticle(e.content, e.title, e.column || undefined, typeof e.titleImage === "string" ? e.titleImage : undefined);
                return;
            case "updateArticle":
                this.putArticle({
                    articleId: e.targetId,
                    title: e.title || "",
                    content: e.content,
                    titleImage: e.titleImage,
                    isTitleImageFullScreen: this.getTitleImageFullScreen(),
                    column: e.column,
                    commentPermission: e.commentPermission,
                });
                return;
            case "postAnswer":
                this.postAnswer(e.content, e.targetId || "");
                return;
            case "updateAnswer":
                this.putAnswer(e.content, e.targetId || "");
                return;
            default:
                Output(`忽略未知的定时发布任务类型: ${String(e.operation)}`, "warn");
                return;
        }
    }

    private getTitleImageFullScreen(): boolean {
        return vscode.workspace.getConfiguration("zhihu").get(SettingEnum.isTitleImageFullScreen) === true;
    }

    preview(textEdtior: vscode.TextEditor, edit: vscode.TextEditorEdit) {
        let text = textEdtior.document.getText();
        if (!text.trim()) {
            vscode.window.showWarningMessage("当前 Markdown 文档为空，无法预览。");
            return;
        }
        let url: URL = this.shebangParser(text);
        // get rid of shebang line and blog front matter
        if (url) text = text.slice(text.indexOf("\n") + 1);
        text = stripFrontMatter(text);
        let html = this.zhihuMdParser.render(text);
        this.webviewService.renderHtml({
            title: "预览",
            pugTemplatePath: join(
                getExtensionPath(),
                TemplatePath,
                "pre-publish.pug"
            ),
            pugObjects: {
                title: "答案预览",
                subTitle: "Zhihu Markdown Preview",
                content: html,
            },
            showOptions: {
                viewColumn: vscode.ViewColumn.Beside,
                preserveFocus: true,
            },
        });
    }

    async publishAnswer(textEdtior: vscode.TextEditor, edit: vscode.TextEditorEdit) {
        const text = textEdtior.document.getText();
        if (!text.trim()) {
            vscode.window.showWarningMessage("当前 Markdown 文档为空，无法发布回答。");
            return;
        }

        let url: URL | undefined;
        try {
            url = this.shebangParser(text);
        } catch (error) {
            vscode.window.showWarningMessage("首行 #! 链接无法识别，请使用知乎问题或答案链接。");
            return;
        }

        if (url) {
            if (QuestionPathReg.test(url.pathname) || QuestionAnswerPathReg.test(url.pathname)) {
                return this.publish(textEdtior, edit);
            }
            vscode.window.showWarningMessage("当前 #! 链接不是知乎问题/答案链接，无法按回答发布。");
            return;
        }

        const targetUrl = await vscode.window.showInputBox({
            ignoreFocusOut: true,
            prompt: "输入知乎问题链接，当前 Markdown 将作为该问题下的新回答发布。",
            placeHolder: "https://www.zhihu.com/question/19602618",
            validateInput: (value: string) => {
                try {
                    const inputUrl = new URL(value.trim());
                    if (!/^(\w)+\.zhihu\.com$/.test(inputUrl.host)) {
                        return "请输入 zhihu.com 的问题链接。";
                    }
                    if (!QuestionPathReg.test(inputUrl.pathname) && !QuestionAnswerPathReg.test(inputUrl.pathname)) {
                        return "请输入知乎问题链接；答案链接仅用于更新已有回答。";
                    }
                    return "";
                } catch (error) {
                    return "请输入完整链接，例如 https://www.zhihu.com/question/19602618";
                }
            },
        });

        if (!targetUrl) return;
        const normalizedTargetUrl = targetUrl.trim();
        await textEdtior.edit((editor) => {
            editor.insert(new vscode.Position(0, 0), `#! ${normalizedTargetUrl}\n\n`);
        });
        return this.publish(textEdtior, edit);
    }

    async publish(textEdtior: vscode.TextEditor, edit: vscode.TextEditorEdit) {
        let title: string | undefined;
        let titleImage: string | undefined;
        let bgIndex: number | undefined;
        let text = textEdtior.document.getText();
        if (!text.trim()) {
            vscode.window.showWarningMessage("当前 Markdown 文档为空，无法发布。");
            return;
        }
        const url: URL = this.shebangParser(text);
        const timeObject: TimeObject = { hour: 0, date: new Date(), minute: 0 };
        // get rid of shebang line and blog front matter
        if (url) text = text.slice(text.indexOf("\n") + 1);
        text = stripFrontMatter(text);

        const operation: PublishOperation | undefined = url ? resolvePublishOperation(url) : undefined;
        if (url && !operation) {
            vscode.window.showWarningMessage("无法识别首行 #! 链接的目标，请使用知乎文章、问题或答案链接。");
            return;
        }

        const isEnable = vscode.workspace
            .getConfiguration("zhihu")
            .get("enableMermaidToPng");

        if (isEnable) {
            text = await uploadMermaidToZhihu(text);
        }
        let tokens = this.zhihuMdParser.parse(text, {});
        // convert local and outer link to zhihu link
        let pipePromise = this.pipeService.sanitizeMdTokens(tokens);
        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Window,
                cancellable: false,
                title: "文章发布中...",
            },
            (progress, token) => {
                return Promise.resolve(pipePromise);
            }
        );
        await pipePromise;

        let html = this.zhihuMdParser.renderer.render(tokens, {}, {});
        const openIndex = tokens.findIndex(
            (t) => t.type == "heading_open" && t.tag == "h1"
        );
        const endIndex = tokens.findIndex(
            (t) => t.type == "heading_close" && t.tag == "h1"
        );
        if (openIndex >= 0) {
            title = removeHtmlTag(
                this.zhihuMdParser.renderInline(tokens[openIndex + 1].content)
            );
            for (let i = 0; i < openIndex; i++) {
                if (tokens[i].type === "inline") {
                    for (let c of tokens[i].children) {
                        if (c.type === "image") {
                            let tmp = c.attrs.find((a) => a[0] === "src");
                            titleImage = tmp[1];
                            bgIndex = i;
                        }
                    }
                }
            }
        }

        const pubLater = await vscode.window
            .showQuickPick<vscode.QuickPickItem & { value: boolean }>([
                { label: "立即发布", description: "", value: false },
                { label: "稍后发布", description: "", value: true },
            ])
            .then((item) => item ? item.value : undefined);

        if (pubLater == undefined) return;

        if (pubLater) {
            let ClockReg = /^(\d\d?)[:：](\d\d)\s*([ap]m)\s*$/i;
            let timeStr: string | undefined = await vscode.window.showInputBox({
                ignoreFocusOut: true,
                prompt: "输入发布时间，如 5:30 pm, 6:40 am 等，目前只支持当天发布！",
                placeHolder: "",
                validateInput: (s: string) => {
                    if (!ClockReg.test(s)) return "请输入正确的时间格式！";
                    if (
                        parseInt(s.replace(ClockReg, "$1")) > 12 ||
                        parseInt(s.replace(ClockReg, "$2")) > 60
                    )
                        return "请输入正确的时间格式！";
                    return "";
                },
            });
            if (!timeStr) return;
            timeStr = timeStr.trim();
            const h = parseInt(timeStr.replace(ClockReg, "$1"), 10);
            const m = parseInt(timeStr.replace(ClockReg, "$2"), 10);
            const aOrPm = timeStr.replace(ClockReg, "$3");
            /**
             * the time interval between now and the publish time in millisecs.
             */
            timeObject.date.setHours(aOrPm.toLowerCase() == "am" ? h : h + 12);
            timeObject.date.setMinutes(m);
            if (timeObject.date.getTime() < Date.now()) {
                vscode.window.showWarningMessage("不能选择比现在更早的时间！");
                return;
            }
        }

        if (url && operation) {
            // Shebang present: route strictly by target type.
            const targetId = this.shebangTargetId(url);
            if (!targetId) {
                vscode.window.showWarningMessage("首行 #! 链接缺少有效的目标 ID。");
                return;
            }
            if (operation === "updateArticle") {
                ({ tokens, html } = this.removeTitleAndBgFromContent(
                    tokens,
                    openIndex,
                    bgIndex,
                    html
                ));
                await this.registerArticleUpdate(targetId, html, title, titleImage, timeObject);
            } else if (operation === "updateAnswer") {
                this.registerAnswerEvent("updateAnswer", targetId, html, timeObject, () => {
                    this.putAnswer(html, targetId);
                });
            } else if (operation === "postAnswer") {
                this.registerAnswerEvent("postAnswer", targetId, html, timeObject, () => {
                    this.postAnswer(html, targetId);
                });
            }
            return;
        }

        // url is not provided
        const selectFrom: MediaTypes = await vscode.window
            .showQuickPick<vscode.QuickPickItem & { value: MediaTypes }>([
                {
                    label: "发布新文章",
                    description: "",
                    value: MediaTypes.article,
                },
                {
                    label: "从收藏夹中选取",
                    description: "",
                    value: MediaTypes.answer,
                },
            ])
            .then((item) => item ? item.value : undefined);

        if (selectFrom === MediaTypes.article) {
            ({ tokens, html } = this.removeTitleAndBgFromContent(
                tokens,
                openIndex,
                bgIndex,
                html
            ));

            // user select to publish new article
            if (!title) {
                title = await this._getTitle();
            }
            if (!title) return;
            const columnChoice = await this._selectColumn();
            if (!columnChoice) return;
            const content: string = html;
            const hash = md5(`postArticle|${title}|${content}`);
            const registered = this.eventService.registerEvent({
                operation: "postArticle",
                content,
                title,
                titleImage: titleImage || null,
                column: columnChoice.column || null,
                date: timeObject.date,
                hash,
                handler: () => {
                    this.postArticle(content, title, columnChoice.column, titleImage, textEdtior);
                    this.eventService.destroyEvent(hash);
                },
            });
            if (!registered) this.promptSameContentWarn();
            else this.promptEventRegistedInfo(timeObject);
        } else if (selectFrom === MediaTypes.answer) {
            // user select from collection
            // shebang not found, then prompt a quick pick to select a question from collections
            const selectedTarget: ICollectionItem | undefined =
                await vscode.window
                    .showQuickPick<vscode.QuickPickItem & ICollectionItem>(
                        this.collectionService
                            .getTargets(MediaTypes.question)
                            .then((targets) => {
                                let items = targets.map((t) => ({
                                    label: t.title ? t.title : t.excerpt,
                                    description: t.excerpt,
                                    id: t.id,
                                    type: t.type,
                                }));
                                return items;
                            })
                    )
                    .then((item) =>
                        item ? { id: item.id, type: item.type } : undefined
                    );
            if (!selectedTarget) return;
            this.registerAnswerEvent("postAnswer", selectedTarget.id, html, timeObject, () => {
                this.postAnswer(html, selectedTarget.id);
            });
        }
    }

    /**
     * Article update branch: read the live article metadata first so the
     * original column and comment permission can be preserved, then register
     * a serializable `updateArticle` task. Cover images placed before the H1
     * act as the article cover; removing them explicitly clears it.
     */
    private async registerArticleUpdate(
        articleId: string,
        content: string,
        title: string | undefined,
        titleImage: string | undefined,
        timeObject: TimeObject
    ): Promise<void> {
        if (!title) {
            title = await this._getTitle();
        }
        if (!title) return;
        const detail = await fetchArticleDetail(articleId, sendRequest);
        if (!detail) {
            vscode.window.showWarningMessage(`无法读取原文章 ${articleId} 的最新信息（可能已被删除或登录已过期），已停止发布。`);
            return;
        }
        const columnChoice = await this._selectColumnForUpdate(detail.column || null);
        if (!columnChoice) return;
        const payload: ArticlePublishPayload = {
            articleId,
            title,
            content,
            // no image before the H1 means the user removed the cover: clear it
            titleImage: titleImage === undefined ? null : titleImage,
            isTitleImageFullScreen: this.getTitleImageFullScreen(),
            column: columnChoice.column,
            commentPermission: detail.comment_permission || "anyone",
        };
        const hash = md5(`updateArticle|${articleId}|${title}|${content}`);
        const registered = this.eventService.registerEvent({
            operation: "updateArticle",
            targetId: articleId,
            content,
            title,
            titleImage: payload.titleImage,
            column: payload.column,
            commentPermission: payload.commentPermission,
            date: timeObject.date,
            hash,
            handler: () => {
                this.putArticle(payload);
                this.eventService.destroyEvent(hash);
            },
        });
        if (!registered) this.promptSameContentWarn();
        else this.promptEventRegistedInfo(timeObject);
    }

    private registerAnswerEvent(
        operation: PublishOperation,
        targetId: string,
        html: string,
        timeObject: TimeObject,
        run: () => void
    ) {
        const hash = md5(`${operation}|${targetId}|${html}`);
        const registered = this.eventService.registerEvent({
            operation,
            targetId,
            content: html,
            date: timeObject.date,
            hash,
            handler: () => {
                run();
                this.eventService.destroyEvent(hash);
            },
        });
        if (!registered) this.promptSameContentWarn();
        else this.promptEventRegistedInfo(timeObject);
    }

    private shebangTargetId(url: URL): string {
        if (QuestionAnswerPathReg.test(url.pathname)) {
            return url.pathname.replace(QuestionAnswerPathReg, "$3");
        }
        if (QuestionPathReg.test(url.pathname)) {
            return url.pathname.replace(QuestionPathReg, "$1");
        }
        if (ArticlePathReg.test(url.pathname)) {
            return url.pathname.replace(ArticlePathReg, "$1");
        }
        return "";
    }

    private removeTitleAndBgFromContent(
        tokens,
        openIndex: number,
        bgIndex: number,
        html: string
    ) {
        tokens = tokens.filter(this._removeTitleAndBg(openIndex, bgIndex));
        html = this.zhihuMdParser.renderer.render(tokens, {}, {});
        return { tokens, html };
    }

    private _removeTitleAndBg(openIndex: number, bgIndex: number) {
        return (t, i) => Math.abs(openIndex + 1 - i) > 1 && bgIndex != i;
    }

    private promptEventRegistedInfo(timeObject: TimeObject) {
        if (timeObject.date.getTime() > Date.now()) {
            vscode.window.showInformationMessage(
                `内容将在 ${beautifyDate(
                    timeObject.date
                )} 发布，请发布时保证VSCode处于打开状态，并` + `激活知乎插件`
            );
        }
    }

    private promptSameContentWarn() {
        vscode.window.showWarningMessage(
            `你已经有一篇一模一样的内容还未发布！`
        );
    }

    private async _getTitle(): Promise<string | undefined> {
        return vscode.window.showInputBox({
            ignoreFocusOut: true,
            prompt: "输入标题：",
            placeHolder: "",
        });
    }

    /**
     * Column picker for new articles. `undefined` means the user cancelled
     * (abort publishing); `{ column: undefined }` is the explicit
     * "no column" choice.
     */
    private async _selectColumn(): Promise<{ column?: IColumn } | undefined> {
        const columns = await this.profileService.getColumns();
        if (!columns || columns.length === 0) return { column: undefined };
        return vscode.window
            .showQuickPick<vscode.QuickPickItem & { choice?: { column?: IColumn } }>(
                [{ label: "不发布到专栏", choice: { column: undefined } }].concat(
                    columns.map((c) => ({ label: c.title, choice: { column: c } }))
                ),
                {
                    ignoreFocusOut: true,
                }
            )
            .then((item) => (item ? item.choice : undefined));
    }

    /**
     * Column picker for article updates. Keeps the original column by
     * default; the column only changes when the user explicitly picks
     * another one or "no column".
     */
    private async _selectColumnForUpdate(original: IColumn | null): Promise<{ column: IColumn | null } | undefined> {
        const columns = await this.profileService.getColumns();
        const options: (vscode.QuickPickItem & { choice: { column: IColumn | null } })[] = [];
        options.push({
            label: original && original.title ? `保持原专栏：${original.title}` : "保持当前状态（无专栏）",
            description: "默认",
            choice: { column: original },
        });
        if (original) {
            options.push({
                label: "不归属任何专栏",
                description: "",
                choice: { column: null },
            });
        }
        for (const c of columns || []) {
            if (original && c.id === original.id) continue;
            options.push({
                label: `迁移到专栏：${c.title}`,
                description: "",
                choice: { column: c },
            });
        }
        return vscode.window
            .showQuickPick<vscode.QuickPickItem & { choice: { column: IColumn | null } }>(options, {
                ignoreFocusOut: true,
                placeHolder: "选择文章发布后归属的专栏（Esc 取消发布）",
            })
            .then((item) => (item ? item.choice : undefined));
    }

    public putAnswer(html: string, answerId: string) {
        sendRequest({
            uri: `${AnswerAPI}/${answerId}`,
            method: "put",
            body: {
                content: html,
                reward_setting: { can_reward: false, tagline: "" },
            },
            json: true,
            resolveWithFullResponse: true,
            headers: {},
        }).then((resp) => {
            if (!resp) {
                vscode.window.showWarningMessage("回答更新失败：网络请求失败，未收到响应。");
                return;
            }
            if (resp.statusCode === 200) {
                let newUrl = `${AnswerURL}/${answerId}`;
                this.promptSuccessMsg(newUrl);
                const pane = vscode.window.createWebviewPanel(
                    "zhihu",
                    "zhihu",
                    vscode.ViewColumn.One,
                    {
                        enableScripts: true,
                        enableCommandUris: true,
                        enableFindWidget: true,
                    }
                );
                sendRequest({
                    uri: `${AnswerURL}/${answerId}`,
                    gzip: true,
                }).then((resp) => {
                    if (resp) {
                        pane.webview.html = resp;
                    }
                });
            } else {
                vscode.window.showWarningMessage(
                    `发布失败！错误代码 ${resp.statusCode}`
                );
            }
        });
    }

    public postAnswer(html: string, questionId: string) {
        sendRequest({
            uri: `${QuestionAPI}/${questionId}/answers`,
            method: "post",
            body: new PostAnswer(html),
            json: true,
            resolveWithFullResponse: true,
            headers: {},
        }).then((resp) => {
            if (!resp) {
                vscode.window.showWarningMessage("回答发布失败：网络请求失败，未收到响应。");
                return;
            }
            if (resp.statusCode == 200) {
                let newUrl = `${AnswerURL}/${resp.body.id}`;
                this.promptSuccessMsg(newUrl);
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    editor.edit((e) => {
                        e.replace(
                            editor.document.lineAt(0).range,
                            `#! ${newUrl}\n`
                        );
                    });
                }
            } else {
                if (resp.statusCode == 400 || resp.statusCode == 403) {
                    vscode.window
                        .showWarningMessage(`发布失败，你已经在该问题下发布过答案，请将头部链接更改为\
					已回答的问题下的链接。`);
                } else {
                    vscode.window.showWarningMessage(
                        `发布失败！错误代码 ${resp.statusCode}`
                    );
                }
            }
        });
    }

    public async postArticle(
        content: string,
        title?: string,
        column?: IColumn,
        titleImage?: string,
        editor?: vscode.TextEditor
    ) {
        if (!title) {
            title = await vscode.window.showInputBox({
                ignoreFocusOut: true,
                prompt: "输入文章标题：",
                placeHolder: "",
            });
        }
        if (!title) return;

        let postResp: ITarget = await sendRequest({
            uri: `${ZhuanlanAPI}/drafts`,
            json: true,
            method: "post",
            body: { title: "h", delta_time: 0 },
            headers: {
                authority: "zhuanlan.zhihu.com",
                "user-agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4101.0 Safari/537.36 Edg/83.0.474.0",
                origin: "https://zhuanlan.zhihu.com",
                "sec-fetch-site": "same-origin",
                "sec-fetch-mode": "cors",
                "sec-fetch-dest": "empty",
                referer: "https://zhuanlan.zhihu.com/write",
                "x-requested-with": "fetch",
            },
        });
        if (!postResp || !postResp.id) {
            vscode.window.showWarningMessage("创建文章草稿失败：未登录、Cookie 失效或知乎接口已变化，请重新登录后重试。");
            return;
        }

        let patchResp = await sendRequest({
            uri: `${ZhuanlanAPI}/${postResp.id}/draft`,
            json: true,
            method: "patch",
            resolveWithFullResponse: true,
            body: {
                content: content,
                title: title,
                titleImage,
                isTitleImageFullScreen: this.getTitleImageFullScreen(),
            },
            headers: {},
        });
        if (!patchResp) {
            vscode.window.showWarningMessage("文章草稿保存失败：网络请求失败，未收到响应，已停止发布。");
            return;
        }
        if (!isSuccessStatus(patchResp.statusCode)) {
            vscode.window.showWarningMessage(
                `文章草稿保存失败，未触发发布。错误代码 ${patchResp.statusCode}`
            );
            return;
        }

        let resp = await sendRequest({
            uri: `${ZhuanlanAPI}/${postResp.id}/publish`,
            json: true,
            method: "put",
            body: { column: column, commentPermission: "anyone" },
            headers: {},
            resolveWithFullResponse: true,
        });
        if (!resp) {
            vscode.window.showWarningMessage("文章发布失败：网络请求失败，未收到响应。");
            return;
        }
        if (resp.statusCode < 300) {
            const newUrl = `${ZhuanlanURL}${postResp.id}`;
            if (editor && editor.document) {
                editor.edit((e) => {
                    e.insert(
                        new vscode.Position(0, 0),
                        `#! ${newUrl}\n`
                    );
                });
            }
            this.promptSuccessMsg(newUrl, title);
        } else {
            vscode.window.showWarningMessage(
                `文章发布失败，错误代码${resp.statusCode}`
            );
        }
        return resp;
    }

    /**
     * Update an existing article: strictly PATCH the draft first and only
     * PUT publish after the PATCH returns 2xx. Any failure keeps the local
     * Markdown intact for a retry and never creates a new article.
     */
    public async putArticle(payload: ArticlePublishPayload): Promise<boolean> {
        let title = payload.title;
        if (!title) {
            title = await vscode.window.showInputBox({
                ignoreFocusOut: true,
                prompt: "修改文章标题：",
                placeHolder: "",
            });
            if (!title) return false;
        }

        const result = await submitArticleUpdate({ ...payload, title }, sendRequest);
        if (result.ok) {
            this.promptSuccessMsg(`${ZhuanlanURL}${payload.articleId}`, title);
            return true;
        }
        this.promptArticleFailure(result);
        return false;
    }

    private promptArticleFailure(result: ArticleUpdateResult) {
        const stageLabel = result.stage === "patch"
            ? "文章草稿保存失败（未触发发布）"
            : "文章发布失败";
        let hint = "";
        if (result.statusCode === 401) {
            hint = "：未登录或 Cookie 已失效，请重新登录。";
        } else if (result.statusCode === 403) {
            hint = "：没有权限，只能修改自己的文章。";
        } else if (result.statusCode === 404) {
            hint = "：文章不存在或已被删除。";
        }
        const statusText = result.statusCode ? ` 错误代码 ${result.statusCode}` : "";
        const detail = result.errorSummary ? `（接口消息：${result.errorSummary}）` : "";
        Output(`${stageLabel}${hint}${statusText}${detail}`, "warn");
        vscode.window.showWarningMessage(
            `${stageLabel}${hint}${statusText}${detail}，本地内容已保留，可稍后重试。`
        );
    }

    private promptSuccessMsg(url: string, title?: string) {
        vscode.window
            .showInformationMessage(
                `${title ? '"' + title + '"' : ""} 发布成功！\n`,
                { modal: true },
                previewActions.openInBrowser
            )
            .then((r) =>
                r ? vscode.env.openExternal(vscode.Uri.parse(url)) : undefined
            );
    }

    shebangParser(text: string): URL {
        let shebangRegExp = /#[!！]\s*((https?:\/\/)?(.+))$/i;
        let lf = text.indexOf("\n");
        if (lf < 0) lf = text.length;
        let link = text.slice(0, lf);
        link = link.indexOf("\r") > 0 ? link.slice(0, link.length - 1) : link;
        if (!shebangRegExp.test(link)) return undefined;
        let url: URL;
        try {
            url = new URL(link.replace(shebangRegExp, "$1"));
        } catch (error) {
            return undefined;
        }
        if (/^(\w)+\.zhihu\.com$/.test(url.host)) return url;
        else return undefined;
        // shebangRegExp = /(https?:\/\/)/i
    }
}
