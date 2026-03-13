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
