import { DefaultHTTPHeader } from "../const/HTTP";
import { ZhuanlanAPI } from "../const/URL";
import { ArticlePublishPayload, IArticleDetailResponse } from "../model/article/article-edit";
import { IColumn } from "../model/publish/column.model";

/**
 * Edit read endpoint: `GET https://zhuanlan.zhihu.com/api/articles/<id>`.
 * Verified live against a logged-in account: it returns the full editable
 * fields (`content`, `title`, `title_image`, `comment_permission`, `column`,
 * `author`) without needing an `include`. The public v4 endpoint is rejected
 * with 403 code 10003 for these callers, so it must not be used for editing.
 */
export const ARTICLE_EDIT_HEADERS = {
    "referer": "https://zhuanlan.zhihu.com/write",
    "origin": "https://zhuanlan.zhihu.com",
    "x-requested-with": "fetch",
};

/**
 * Injectable transport so request sequencing can be unit tested without a
 * real account. Matches the signature of `sendRequest` from http.service.
 */
export type ArticleRequest = (options: any) => Promise<any>;

export interface HttpResponseLike {
    statusCode?: number;
    body?: any;
}

export interface ArticleUpdateResult {
    ok: boolean;
    /** Which request failed; `publish` is only reached after a 2xx patch. */
    stage: "patch" | "publish";
    statusCode?: number;
    errorSummary?: string;
}

/**
 * Fetch the raw article detail for editing. Returns `undefined` when the
 * request fails, the article is missing or the payload carries an API error;
 * callers validate the individual fields.
 */
export async function fetchArticleDetail(articleId: string, request: ArticleRequest): Promise<IArticleDetailResponse | undefined> {
    const response: IArticleDetailResponse = await request({
        uri: `${ZhuanlanAPI}/${articleId}`,
        json: true,
        gzip: true,
        headers: { ...DefaultHTTPHeader, ...ARTICLE_EDIT_HEADERS },
    });
    if (!response || response.error) {
        return undefined;
    }
    return response;
}

/**
 * The detail endpoint reports comment permission as `all`/`followees`/
 * `no_one`, but the publish endpoint only accepts its own enum (`anyone`/
 * `followees`/`no_one`) and answers 500 for unknown values — live verified.
 * Unknown values fall back to the previous hard-coded behaviour.
 */
export const COMMENT_PERMISSION_PUBLISH_MAP: { [key: string]: string } = {
    all: "anyone",
    anyone: "anyone",
    followees: "followees",
    no_one: "no_one",
};

/**
 * Update an existing article: `PATCH /articles/<id>/draft` first, and only
 * then `PUT /articles/<id>/publish`. A failed (or missing) PATCH never
 * reaches the publish call, so a draft error can not half-publish an article.
 */
export async function submitArticleUpdate(payload: ArticlePublishPayload, request: ArticleRequest): Promise<ArticleUpdateResult> {
    const articleId = payload.articleId;
    if (!articleId) {
        return { ok: false, stage: "patch", errorSummary: "缺少文章 ID" };
    }
    const patchResponse: HttpResponseLike = await request({
        uri: `${ZhuanlanAPI}/${articleId}/draft`,
        method: "patch",
        json: true,
        resolveWithFullResponse: true,
        headers: {},
        body: {
            content: payload.content,
            title: payload.title,
            // `null` means "clear the cover": send an explicit empty value so
            // JSON serialization does not silently drop the field.
            titleImage: payload.titleImage === undefined ? undefined : payload.titleImage === null ? "" : payload.titleImage,
            isTitleImageFullScreen: payload.isTitleImageFullScreen,
        },
    });
    if (!patchResponse) {
        return { ok: false, stage: "patch", errorSummary: "网络请求失败，未收到响应" };
    }
    if (!isSuccessStatus(patchResponse.statusCode)) {
        return {
            ok: false,
            stage: "patch",
            statusCode: patchResponse.statusCode,
            errorSummary: extractErrorSummary(patchResponse.body),
        };
    }

    const publishBody: { column?: IColumn; commentPermission: string } = {
        commentPermission: COMMENT_PERMISSION_PUBLISH_MAP[payload.commentPermission || ""] || "anyone",
    };
    // Live-tested: the publish endpoint 500s on `column: null`; without a
    // column the key must be omitted entirely (matches the web flow).
    if (payload.column) {
        publishBody.column = payload.column;
    }
    const publishResponse: HttpResponseLike = await request({
        uri: `${ZhuanlanAPI}/${articleId}/publish`,
        method: "put",
        json: true,
        resolveWithFullResponse: true,
        headers: {},
        body: publishBody,
    });
    if (!publishResponse) {
        return { ok: false, stage: "publish", errorSummary: "网络请求失败，未收到响应" };
    }
    if (!isSuccessStatus(publishResponse.statusCode)) {
        return {
            ok: false,
            stage: "publish",
            statusCode: publishResponse.statusCode,
            errorSummary: extractErrorSummary(publishResponse.body),
        };
    }
    return { ok: true, stage: "publish", statusCode: publishResponse.statusCode };
}

export function isSuccessStatus(statusCode?: number): boolean {
    return statusCode !== undefined && statusCode >= 200 && statusCode < 300;
}

export function extractErrorSummary(body?: any): string {
    if (!body) {
        return "";
    }
    if (typeof body === "string") {
        return body.slice(0, 200);
    }
    const message = body.error && body.error.message ? String(body.error.message) : "";
    return (message || JSON.stringify(body)).slice(0, 200);
}
