import { ITarget } from "../model/target/target";

type PartialTarget = Partial<ITarget> & {
    question?: Partial<ITarget>;
};

const TargetIdPatterns: { [key: string]: RegExp[] } = {
    question: [/\/questions?\/(\d+)/i, /\/question\/(\d+)/i],
    answer: [/\/answers?\/(\d+)/i, /\/answer\/(\d+)/i],
    article: [/\/articles?\/(\d+)/i, /\/p\/(\d+)/i],
};

const GenericPatterns = [
    /\/questions?\/(\d+)/i,
    /\/question\/(\d+)/i,
    /\/answers?\/(\d+)/i,
    /\/answer\/(\d+)/i,
    /\/articles?\/(\d+)/i,
    /\/p\/(\d+)/i,
];

/**
 * Host whose article pages live at `https://zhuanlan.zhihu.com/p/<id>`.
 */
const ZhuanlanHost = "zhuanlan.zhihu.com";

/**
 * Strictly extract a zhihu article id from user input. Accepts a pure numeric
 * article id or an article page url (trailing slash, query and hash are
 * tolerated). Never accepts question/answer urls, so an article link can not
 * be mistaken for other content types.
 */
export function extractArticleId(input?: string): string | undefined {
    if (!input) {
        return undefined;
    }
    const trimmed = input.trim();
    if (/^\d+$/.test(trimmed)) {
        return trimmed;
    }
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch (error) {
        return undefined;
    }
    if (parsed.hostname.toLowerCase() !== ZhuanlanHost) {
        return undefined;
    }
    const matched = /^\/p\/(\d+)\/?$/i.exec(parsed.pathname);
    return matched && matched[1] ? matched[1] : undefined;
}

/**
 * Resolve the article id from a tree node target, webview payload or simple
 * `{ id, url }` object. Only strict article ids are returned: a target that
 * carries a non-article url or type never falls back to its raw `id`.
 */
export function resolveArticleIdFromTarget(target?: PartialTarget): string {
    if (!target) {
        return "";
    }
    if (target.type && target.type !== "article") {
        return "";
    }
    if (target.url) {
        return extractArticleId(target.url) || "";
    }
    if (target.id !== undefined && target.id !== null && /^\d+$/.test(String(target.id))) {
        return String(target.id);
    }
    return "";
}

export function extractZhihuIdFromUrl(url?: string, type?: string): string | undefined {
    if (!url) {
        return undefined;
    }
    const patterns = type && TargetIdPatterns[type]
        ? [...TargetIdPatterns[type], ...GenericPatterns]
        : GenericPatterns;
    for (const pattern of patterns) {
        const matched = pattern.exec(url);
        if (matched && matched[1]) {
            return matched[1];
        }
    }
    return undefined;
}

export function resolveTargetId(target?: PartialTarget): string {
    if (!target) {
        return "";
    }
    const exactId = extractZhihuIdFromUrl(target.url, target.type);
    if (exactId) {
        return exactId;
    }
    if (target.id !== undefined && target.id !== null) {
        return String(target.id);
    }
    const questionId = extractZhihuIdFromUrl(
        target.question ? target.question.url : undefined,
        target.question ? target.question.type : undefined
    );
    if (questionId) {
        return questionId;
    }
    if (target.question && target.question.id !== undefined && target.question.id !== null) {
        return String(target.question.id);
    }
    return "";
}

export function withResolvedTargetId<T extends PartialTarget>(target: T): T {
    if (!target) {
        return target;
    }
    const exactId = resolveTargetId(target);
    if (!exactId || (target.id !== undefined && String(target.id) === exactId)) {
        return target;
    }
    return Object.assign({}, target, { id: exactId });
}
