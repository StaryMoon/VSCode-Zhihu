import * as cheerio from "cheerio";

/**
 * Shared lossless-first HTML -> Markdown converter for zhihu article and
 * answer content. Pure function: no vscode or network access, so it can be
 * unit tested with html fixtures.
 *
 * Rules (see plan.md 5.2):
 * - paragraphs, headings, emphasis, inline code, links as `[text](url)`;
 * - images via `data-original` > `data-original-src` > `data-actualsrc` > `src`;
 * - fenced code blocks with language from `lang-xx` / `language-xx` / `lang`;
 * - ordered / unordered / nested lists, blockquotes, hr, tables;
 * - zhihu formula images (`/equation?tex=...`) are restored as `$tex$`;
 * - `noscript` lazy-load fallbacks never duplicate an image;
 * - unknown zhihu-specific html is preserved as raw html, never dropped.
 */

export interface HtmlToMarkdownOptions {
    /** Hook to report lossy steps such as unrestorable formulas. */
    onWarn?: (message: string) => void;
}

interface DomNode {
    type?: string;
    name?: string;
    data?: string;
    attribs?: { [key: string]: string };
    children?: DomNode[];
}

const BLOCK_TAGS = [
    "address", "blockquote", "center", "details", "dialog", "div", "dl", "dd", "dt",
    "fieldset", "figcaption", "figure", "form", "h1", "h2", "h3", "h4", "h5", "h6",
    "hr", "li", "ol", "p", "pre", "section", "table", "tbody", "td", "tfoot", "th",
    "thead", "tr", "ul",
];

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"];

const DROP_TAGS = ["script", "style", "link", "meta"];

const VOID_TAGS = ["img", "br", "hr", "input", "source", "track", "wbr", "area", "col", "embed"];

/** Image attributes ordered by reliability for lazily loaded zhihu pictures. */
const IMAGE_SRC_ATTRS = ["data-original", "data-original-src", "data-actualsrc", "data-actual-src", "src"];

const ROOT_ID = "zmd-root";

/**
 * Private-use placeholder for `<br>`: raw text whitespace is collapsed to
 * single spaces, so line breaks must survive as a sentinel and are restored
 * when an inline run is finished.
 */
const BR_MARK = "\uE000";

function normalizeInline(text: string, keepLineBreaks?: boolean): string {
    return text
        .replace(/\s+/g, " ")
        .replace(/\uE000/g, keepLineBreaks === false ? " " : "\n")
        .trim();
}

/**
 * Convert zhihu article/answer html into editable Markdown.
 */
export function htmlToMarkdown(html?: string, options?: HtmlToMarkdownOptions): string {
    if (!html || !html.trim()) {
        return "";
    }
    const $ = cheerio.load(`<div id="${ROOT_ID}">${html}</div>`, { decodeEntities: true });
    const root = $("#" + ROOT_ID);
    normalizeNoscript($);
    const blocks = renderBlocks($, root.contents().toArray(), options);
    return blocks
        .join("\n\n")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/**
 * Zhihu wraps lazy-loaded images in `<noscript>` fallbacks. When the real
 * `<img>` is already present drop the fallback; otherwise hoist the fallback
 * content so the image is not lost.
 */
function normalizeNoscript($: CheerioStatic): void {
    $("noscript").each((_, el) => {
        const $el = $(el);
        const innerHtml = $el.html() || "";
        const parent = $el.parent();
        const hasRealImage = parent.length > 0 && parent.children("img").length > 0;
        if (hasRealImage && /<img\b/i.test(innerHtml)) {
            $el.remove();
            return;
        }
        if (!innerHtml.trim()) {
            $el.remove();
            return;
        }
        // Parse the fallback markup and splice it in place of the noscript tag.
        const fragment = $(`<div>${innerHtml}</div>`).contents();
        $el.replaceWith(fragment);
    });
}

function renderBlocks($: CheerioStatic, nodes: DomNode[], options?: HtmlToMarkdownOptions): string[] {
    const parts: string[] = [];
    let paragraph = "";

    const flush = () => {
        const text = normalizeInline(paragraph);
        if (text) {
            parts.push(text);
        }
        paragraph = "";
    };

    for (const node of nodes) {
        if (node.type === "text") {
            paragraph += node.data || "";
            continue;
        }
        if (node.type !== "tag") {
            continue;
        }
        const tag = (node.name || "").toLowerCase();
        if (DROP_TAGS.indexOf(tag) >= 0) {
            continue;
        }
        if (tag === "p") {
            flush();
            const single = singleFormula(node);
            const content = single || normalizeInline(inlineNodes($, node.children || [], options));
            if (content) {
                parts.push(content);
            }
            continue;
        }
        if (HEADING_TAGS.indexOf(tag) >= 0) {
            flush();
            const level = HEADING_TAGS.indexOf(tag) + 1;
            const content = normalizeInline(inlineNodes($, node.children || [], options));
            if (content) {
                parts.push(`${"#".repeat(level)} ${content}`);
            }
            continue;
        }
        if (tag === "blockquote") {
            flush();
            const inner = renderBlocks($, node.children || [], options).join("\n\n");
            if (inner) {
                parts.push(inner.split("\n").map(line => `> ${line}`.replace(/\s+$/, "")).join("\n"));
            }
            continue;
        }
        if (tag === "pre") {
            flush();
            const fence = renderPre(node);
            if (fence) {
                parts.push(fence);
            }
            continue;
        }
        if (tag === "ul" || tag === "ol") {
            flush();
            const list = renderList($, node, 0, options);
            if (list) {
                parts.push(list);
            }
            continue;
        }
        if (tag === "hr") {
            flush();
            parts.push("---");
            continue;
        }
        if (tag === "table") {
            flush();
            const table = renderTable($, node, options);
            if (table) {
                parts.push(table);
            }
            continue;
        }
        if (tag === "figure") {
            flush();
            const figure = renderFigure($, node, options);
            if (figure) {
                parts.push(figure);
            }
            continue;
        }
        if (tag === "br") {
            flush();
            continue;
        }
        if (!isInlineNode(node)) {
            // Container (div/section) or unknown block: recurse when it
            // groups block content, keep raw html for zhihu-specific widgets.
            if (isZhihuWidget(node) && !hasBlockDescendant(node)) {
                flush();
                parts.push(outerHtml(node));
                continue;
            }
            const inner = renderBlocks($, node.children || [], options);
            if (inner.length) {
                flush();
                parts.push(...inner);
            }
            continue;
        }
        // Inline element inside flowing text.
        paragraph += inlineNodes($, [node], options);
    }
    flush();
    return parts;
}

/** Keep the raw-html append order when a raw widget follows a pending paragraph. */
function hasBlockDescendant(node: DomNode): boolean {
    for (const child of node.children || []) {
        if (child.type !== "tag") {
            continue;
        }
        const tag = (child.name || "").toLowerCase();
        if (BLOCK_TAGS.indexOf(tag) >= 0 || tag === "img") {
            return true;
        }
        if (hasBlockDescendant(child)) {
            return true;
        }
    }
    return false;
}

function renderFigure($: CheerioStatic, node: DomNode, options?: HtmlToMarkdownOptions): string {
    const images: DomNode[] = [];
    const otherInline: DomNode[] = [];
    collectFigureChildren(node, images, otherInline);
    if (!images.length) {
        // Link cards, columns cards, video cards and other zhihu-only blocks:
        // preserve them verbatim so re-publishing keeps the card.
        return isZhihuWidget(node) ? outerHtml(node) : inlineNodes($, otherInline, options).trim();
    }
    const parts = images.map(img => imageMarkdown(img, options));
    const otherText = otherInline
        .filter(child => !(child.type === "tag" && (child.name || "").toLowerCase() === "figcaption"))
        .map(child => inlineNodes($, [child], options).trim())
        .filter(text => !!text)
        .join(" ");
    if (otherText) {
        parts.push(otherText);
    }
    const captionNode = (node.children || []).find(child => child.type === "tag" && (child.name || "").toLowerCase() === "figcaption");
    if (captionNode) {
        const captionText = normalizeInline(inlineNodes($, captionNode.children || [], options), false);
        if (captionText) {
            parts.push(`*${captionText}*`);
        }
    }
    return parts.filter(part => !!part).join("\n\n");
}

function collectFigureChildren(node: DomNode, images: DomNode[], other: DomNode[]): void {
    for (const child of node.children || []) {
        if (child.type === "tag" && (child.name || "").toLowerCase() === "img") {
            images.push(child);
        } else if (child.type === "tag" && (child.name || "").toLowerCase() === "figcaption") {
            other.push(child);
        } else if (child.type === "text") {
            if ((child.data || "").trim()) {
                other.push(child);
            }
        } else if (child.type === "tag") {
            other.push(child);
        }
    }
}

function renderPre(node: DomNode): string {
    const codeNode = (node.children || []).find(child => child.type === "tag" && (child.name || "").toLowerCase() === "code");
    const source = codeNode || node;
    const code = textOf(source).replace(/\s+$/, "");
    if (!code.trim()) {
        return "";
    }
    let lang = "";
    const classAttr = `${codeNode && codeNode.attribs ? codeNode.attribs.class || "" : ""} ${node.attribs ? node.attribs.class || "" : ""}`;
    const classMatch = /lang(?:uage)?-([\w+#-]+)/i.exec(classAttr);
    if (classMatch) {
        lang = classMatch[1];
    } else if (node.attribs && node.attribs.lang) {
        lang = node.attribs.lang;
    }
    return "```" + lang + "\n" + code + "\n```";
}

function renderList($: CheerioStatic, listNode: DomNode, depth: number, options?: HtmlToMarkdownOptions): string {
    const ordered = (listNode.name || "").toLowerCase() === "ol";
    const indent = "  ".repeat(depth);
    const lines: string[] = [];
    let index = 1;
    for (const li of listNode.children || []) {
        if (li.type !== "tag" || (li.name || "").toLowerCase() !== "li") {
            continue;
        }
        const inlineParts: DomNode[] = [];
        const nestedLists: DomNode[] = [];
        for (const child of li.children || []) {
            if (child.type === "tag" && ["ul", "ol"].indexOf((child.name || "").toLowerCase()) >= 0) {
                nestedLists.push(child);
            } else {
                inlineParts.push(child);
            }
        }
        const text = normalizeInline(inlineNodes($, inlineParts, options));
        const marker = ordered ? `${index}. ` : "- ";
        lines.push(`${indent}${marker}${text}`.trimRight());
        index += 1;
        for (const nested of nestedLists) {
            const rendered = renderList($, nested, depth + 1, options);
            if (rendered) {
                lines.push(rendered);
            }
        }
    }
    return lines.join("\n");
}

function renderTable($: CheerioStatic, tableNode: DomNode, options?: HtmlToMarkdownOptions): string {
    const rows: DomNode[] = [];
    const collectRows = (node: DomNode) => {
        for (const child of node.children || []) {
            if (child.type !== "tag") {
                continue;
            }
            const tag = (child.name || "").toLowerCase();
            if (tag === "tr") {
                rows.push(child);
            } else if (tag === "thead" || tag === "tbody" || tag === "tfoot") {
                collectRows(child);
            }
        }
    };
    collectRows(tableNode);
    const renderedRows = rows
        .map(row => (row.children || [])
            .filter(cell => cell.type === "tag" && ["td", "th"].indexOf((cell.name || "").toLowerCase()) >= 0)
            .map(cell => normalizeInline(inlineNodes($, cell.children || [], options), false).replace(/\|/g, "\\|")))
        .filter(cells => cells.length > 0);
    if (!renderedRows.length) {
        return isZhihuWidget(tableNode) ? outerHtml(tableNode) : "";
    }
    const width = renderedRows.reduce((max, cells) => Math.max(max, cells.length), 0);
    const normalize = (cells: string[]) => {
        const copy = cells.slice();
        while (copy.length < width) {
            copy.push("");
        }
        return `| ${copy.join(" | ")} |`;
    };
    const lines = [normalize(renderedRows[0]), `| ${new Array(width).fill("---").join(" | ")} |`];
    for (const cells of renderedRows.slice(1)) {
        lines.push(normalize(cells));
    }
    return lines.join("\n");
}

/**
 * Render an inline context: text runs, emphasis, links, images, inline code.
 * Unknown inline tags keep their children; unknown zhihu widgets keep raw html.
 */
function inlineNodes($: CheerioStatic, nodes: DomNode[], options?: HtmlToMarkdownOptions): string {
    let out = "";
    for (const node of nodes) {
        if (node.type === "text") {
            out += node.data || "";
            continue;
        }
        if (node.type !== "tag") {
            continue;
        }
        const tag = (node.name || "").toLowerCase();
        if (DROP_TAGS.indexOf(tag) >= 0) {
            continue;
        }
        const inner = () => inlineNodes($, node.children || [], options);
        switch (tag) {
            case "br":
                out += BR_MARK;
                break;
            case "strong":
            case "b": {
                const text = inner().trim();
                out += text ? `**${text}**` : "";
                break;
            }
            case "em":
            case "i": {
                const text = inner().trim();
                out += text ? `*${text}*` : "";
                break;
            }
            case "del":
            case "s":
            case "strike": {
                const text = inner().trim();
                out += text ? `~~${text}~~` : "";
                break;
            }
            case "code": {
                const text = textOf(node).trim();
                out += text ? `\`${text}\`` : "";
                break;
            }
            case "a":
                out += linkMarkdown(node, inner());
                break;
            case "img":
                out += imageMarkdown(node, options);
                break;
            case "p":
            case "div":
            case "span":
            case "font":
            case "u":
            case "sub":
            case "sup":
            case "small":
            case "big":
            case "label":
            case "time":
                out += inner();
                break;
            default:
                if (isZhihuWidget(node)) {
                    out += outerHtml(node);
                } else {
                    out += inner();
                }
                break;
        }
    }
    return out;
}

function linkMarkdown(node: DomNode, renderedText: string): string {
    const href = node.attribs ? node.attribs.href || "" : "";
    const text = renderedText.trim();
    if (!href) {
        return text;
    }
    if (!text || text === href) {
        return href;
    }
    return `[${text}](${href})`;
}

function imageMarkdown(node: DomNode, options?: HtmlToMarkdownOptions): string {
    const attribs = node.attribs || {};
    const src = pickImageSrc(attribs);
    const formula = formulaFromSrc(src);
    if (formula) {
        return `$${formula}$`;
    }
    if (!src) {
        return "";
    }
    const alt = (attribs.alt || "").replace(/\s+/g, " ").trim();
    return `![${alt}](${src})`;
}

function pickImageSrc(attribs: { [key: string]: string }): string {
    for (const attr of IMAGE_SRC_ATTRS) {
        const value = attribs[attr];
        if (value && value.indexOf("data:") !== 0) {
            return value;
        }
    }
    return "";
}

/**
 * Zhihu renders formulas as `<img src="https://www.zhihu.com/equation?tex=...">`.
 * Restore the TeX source so re-publishing keeps the formula semantics.
 */
function formulaFromSrc(src: string): string | undefined {
    if (!src || src.indexOf("/equation?") < 0) {
        return undefined;
    }
    try {
        const parsed = new URL(src);
        const tex = parsed.searchParams.get("tex");
        if (tex) {
            return tex;
        }
    } catch (error) {
        return undefined;
    }
    return undefined;
}

/** A paragraph containing only a block formula becomes a display formula. */
function singleFormula(pNode: DomNode): string | undefined {
    const children = (pNode.children || []).filter(child =>
        !(child.type === "text" && !(child.data || "").trim()));
    if (children.length !== 1) {
        return undefined;
    }
    const only = children[0];
    if (only.type !== "tag" || (only.name || "").toLowerCase() !== "img") {
        return undefined;
    }
    const formula = formulaFromSrc(pickImageSrc(only.attribs || {}));
    return formula ? `$$${formula}$$` : undefined;
}

function isInlineNode(node: DomNode): boolean {
    const tag = (node.name || "").toLowerCase();
    return BLOCK_TAGS.indexOf(tag) < 0;
}

/** Unknown elements carrying zhihu data attributes hold cards that must survive. */
function isZhihuWidget(node: DomNode): boolean {
    const attribs = node.attribs || {};
    return Object.keys(attribs).some(key => /^data-/.test(key));
}

function textOf(node: DomNode): string {
    if (node.type === "text") {
        return node.data || "";
    }
    return (node.children || []).map(textOf).join("");
}

/** Self-contained outer-html serializer (keeps entities as authored). */
function outerHtml(node: DomNode): string {
    switch (node.type) {
        case "text":
            return node.data || "";
        case "comment":
        case "directive":
            return `<!--${node.data || ""}-->`;
        case "tag": {
            const attribs = node.attribs || {};
            const attrs = Object.keys(attribs)
                .map(key => ` ${key}="${String(attribs[key]).replace(/"/g, "&quot;")}"`)
                .join("");
            const tag = node.name || "";
            if (VOID_TAGS.indexOf(tag) >= 0 && !(node.children || []).length) {
                return `<${tag}${attrs}>`;
            }
            const inner = (node.children || []).map(outerHtml).join("");
            return `<${tag}${attrs}>${inner}</${tag}>`;
        }
        case "script":
        case "style":
            return `<${node.name || ""}>${node.data || ""}</${node.name || ""}>`;
        default:
            return "";
    }
}
