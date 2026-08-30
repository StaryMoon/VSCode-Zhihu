import * as vscode from "vscode";
import { HotStory } from "../model/hot-story.model";
import { IStoryTarget } from "../model/target/target";
import { HotStoryAPI } from "../const/URL";
import { sendRequest } from "../service/http.service";
import { Output } from "../global/logger";
import { withResolvedTargetId } from "../util/zhihu-id";

export interface StoryType {
    storyType?: string;
    ch?: string;
    keywords?: string[];
    fallbackOffset?: number;
}

const CATEGORY_ITEM_LIMIT = 12;
const CATEGORY_TYPES = ["sport", "science", "fashion", "film", "digital"];

export const STORY_TYPES: StoryType[] = [
    { storyType: "total", ch: "全站" },
    {
        storyType: "sport",
        ch: "运动",
        fallbackOffset: 0,
        keywords: [
            "运动",
            "体育",
            "比赛",
            "联赛",
            "篮球",
            "足球",
            "NBA",
            "CBA",
            "欧冠",
            "世界杯",
            "球员",
            "教练",
            "守门员",
            "退役",
            "霍华德",
        ],
    },
    {
        storyType: "science",
        ch: "科学",
        fallbackOffset: 1,
        keywords: [
            "科学",
            "研究",
            "实验",
            "航天",
            "宇宙",
            "物理",
            "化学",
            "生物",
            "医学",
            "医院",
            "核磁",
            "能源",
            "石油",
            "防空",
            "健康",
        ],
    },
    {
        storyType: "fashion",
        ch: "时尚",
        fallbackOffset: 2,
        keywords: [
            "时尚",
            "穿搭",
            "美妆",
            "护肤",
            "化妆",
            "发型",
            "审美",
            "家居",
            "家庭",
            "生活",
            "电视",
            "空调",
            "汽车",
            "买车",
        ],
    },
    {
        storyType: "film",
        ch: "影视",
        fallbackOffset: 3,
        keywords: [
            "影视",
            "电影",
            "剧本",
            "电视剧",
            "综艺",
            "演员",
            "导演",
            "动漫",
            "漫画",
            "番剧",
            "短剧",
            "漫剧",
            "内娱",
            "章子怡",
            "一人之下",
        ],
    },
    {
        storyType: "digital",
        ch: "数码",
        fallbackOffset: 4,
        keywords: [
            "数码",
            "科技",
            "AI",
            "人工智能",
            "大模型",
            "token",
            "芯片",
            "硬件",
            "软件",
            "苹果",
            "App Store",
            "电脑",
            "手机",
            "Claude",
            "游戏",
            "steam",
        ],
    },
];

export class HotStoryTreeViewProvider
    implements vscode.TreeDataProvider<ZhihuTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<
        ZhihuTreeItem | undefined
    > = new vscode.EventEmitter<ZhihuTreeItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<ZhihuTreeItem | undefined> =
        this._onDidChangeTreeData.event;

    refresh(node?: ZhihuTreeItem): void {
        this._onDidChangeTreeData.fire(node);
    }

    getTreeItem(element: ZhihuTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ZhihuTreeItem): Thenable<ZhihuTreeItem[]> {
        if (element) {
            return new Promise(async (resolve) => {
                try {
                    const questions = await this.loadStories(element.type);
                    resolve(
                        questions
                            .filter((story) => story && story.target)
                            .map((story) => {
                                return new ZhihuTreeItem(
                                    story.target.title ? story.target.title : "",
                                    story.target.type ? story.target.type : "",
                                    vscode.TreeItemCollapsibleState.None,
                                    {
                                        command: "zhihu.openWebView",
                                        title: "openWebView",
                                        arguments: [story.target],
                                    },
                                    story.target
                                );
                            })
                    );
                } catch (error) {
                    Output(
                        `Hot stories load failed: ${
                            error && error.stack ? error.stack : error
                        }`,
                        "warn"
                    );
                    resolve([]);
                }
            });
        }
        return Promise.resolve(this.getHotStoriesType());
    }

    private async loadStories(type: string): Promise<HotStory[]> {
        const stories = await this.fetchTotalStories();
        if (type === "total") {
            return stories;
        }
        const derivedStories = this.deriveCategoryStories(type, stories);
        Output(
            `Hot category derived: type=${type}, total=${stories.length}, derived=${derivedStories.length}`
        );
        return derivedStories;
    }

    private async fetchTotalStories(): Promise<HotStory[]> {
        const body = await sendRequest({
            uri: `${HotStoryAPI}/total?desktop=true`,
            json: true,
            gzip: true,
            enableCache: true,
        });
        const stories: HotStory[] = body && body.data ? body.data : [];
        return stories
            .filter((story) => story && story.target)
            .map((story) => this.normalizeStory(story));
    }

    private normalizeStory(story: HotStory): HotStory {
        return Object.assign({}, story, {
            target: story.target ? withResolvedTargetId(story.target) : story.target,
        });
    }

    private deriveCategoryStories(type: string, stories: HotStory[]): HotStory[] {
        const storyType = STORY_TYPES.find((item) => item.storyType === type);
        if (!storyType || !storyType.keywords || !storyType.keywords.length) {
            return stories;
        }

        const scoredStories = stories
            .map((story) => ({
                story,
                score: this.getCategoryScore(story.target, storyType.keywords || []),
            }))
            .filter((item) => item.score > 0)
            .sort((left, right) => right.score - left.score);

        const selectedStories: HotStory[] = [];
        const usedIds = new Set<string>();

        for (const item of scoredStories) {
            const targetId = this.getStoryTargetId(item.story);
            if (!targetId || usedIds.has(targetId)) {
                continue;
            }
            selectedStories.push(item.story);
            usedIds.add(targetId);
            if (selectedStories.length >= CATEGORY_ITEM_LIMIT) {
                return selectedStories;
            }
        }

        const fallbackStories = this.buildFallbackStories(
            stories,
            usedIds,
            storyType.fallbackOffset || 0
        );
        return selectedStories.concat(fallbackStories).slice(0, CATEGORY_ITEM_LIMIT);
    }

    private buildFallbackStories(
        stories: HotStory[],
        usedIds: Set<string>,
        fallbackOffset: number
    ): HotStory[] {
        const fallbackStories: HotStory[] = [];
        for (
            let index = fallbackOffset;
            index < stories.length && fallbackStories.length < CATEGORY_ITEM_LIMIT;
            index += CATEGORY_TYPES.length
        ) {
            const story = stories[index];
            const targetId = this.getStoryTargetId(story);
            if (!targetId || usedIds.has(targetId)) {
                continue;
            }
            fallbackStories.push(story);
            usedIds.add(targetId);
        }

        if (fallbackStories.length >= CATEGORY_ITEM_LIMIT) {
            return fallbackStories;
        }

        for (const story of stories) {
            const targetId = this.getStoryTargetId(story);
            if (!targetId || usedIds.has(targetId)) {
                continue;
            }
            fallbackStories.push(story);
            usedIds.add(targetId);
            if (fallbackStories.length >= CATEGORY_ITEM_LIMIT) {
                break;
            }
        }

        return fallbackStories;
    }

    private getCategoryScore(target: IStoryTarget, keywords: string[]): number {
        const text = [target && target.title ? target.title : "", target && target.excerpt ? target.excerpt : ""]
            .join(" ")
            .toLowerCase();
        let score = 0;
        for (const keyword of keywords) {
            const keywordText = keyword.toLowerCase();
            if (text.indexOf(keywordText) >= 0) {
                score += keywordText.length > 2 ? 3 : 2;
            }
        }
        return score;
    }

    private getStoryTargetId(story: HotStory): string {
        return story && story.target && story.target.id !== undefined
            ? String(story.target.id)
            : "";
    }

    private getHotStoriesType(): ZhihuTreeItem[] {
        return STORY_TYPES.map((type) => {
            return new ZhihuTreeItem(
                type.ch || "",
                type.storyType || "",
                vscode.TreeItemCollapsibleState.Collapsed
            );
        });
    }
}

export class LinkableTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public collapsibleState: vscode.TreeItemCollapsibleState,
        public link: string | undefined
    ) {
        super(label, collapsibleState);
    }
}

export class ZhihuTreeItem extends LinkableTreeItem {
    constructor(
        public readonly label: string,
        public type: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command,
        public target?: IStoryTarget,
        public page?: number
    ) {
        super(label, collapsibleState, target && target.url ? target.url : "");
    }

    get tooltip(): string {
        return this.target && this.target.excerpt ? this.target.excerpt : "";
    }

    get description(): string {
        return this.target && this.target.excerpt ? this.target.excerpt : "";
    }

    contextValue = this.type == "feed" ? "feed" : this.type === "article" ? "article" : "dependency";
}
