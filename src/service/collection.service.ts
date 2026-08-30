import * as fs from "fs";
import * as httpClient from "request-promise";
import { CollectionPath } from "../const/PATH";
import { MediaTypes } from "../const/ENUM";
import { sendRequest } from "./http.service";
import { AnswerAPI, QuestionAPI, SelfProfileAPI, ZhuanlanAPI } from "../const/URL";
import { ITarget } from "../model/target/target";
import { getStorageFilePath } from "../global/globa-var";
import { Output } from "../global/logger";
import { getRawCookieHeader } from "../global/cookie";

export interface ICollectionItem {
	type: MediaTypes,
	id: string
}

interface ICollectionSnapshot {
	collectionId: string;
	headers: Record<string, string>;
}

export class CollectionService {
	public collection: ICollectionItem[];
	private collectionId: string;
	private collectionItemCount = 0;
	private readonly collectionReadHeaders = {
		"Accept": "application/json, text/plain, */*",
		"Accept-Language": "en-US,en;q=0.9",
		"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
		"sec-ch-ua": "\"Not:A-Brand\";v=\"99\", \"Google Chrome\";v=\"145\", \"Chromium\";v=\"145\"",
		"sec-ch-ua-mobile": "?0",
		"sec-ch-ua-platform": "\"Windows\""
	};
	private readonly collectionToggleHeaders = {
		...this.collectionReadHeaders,
		"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
		"origin": "https://www.zhihu.com",
		"referer": "https://www.zhihu.com/",
		"x-requested-with": "fetch"
	};

	constructor () {
		const collectionPath = getStorageFilePath(CollectionPath);
		if (fs.existsSync(collectionPath)) {
			this.collection = JSON.parse(fs.readFileSync(collectionPath, "utf8"));
		} else {
			this.collection = [];
		}
	}

	async addItem(item: ICollectionItem) {
		const collectionId = await this.getDefaultCollectionId();
		if (!collectionId) {
			return false;
		}
		const response = await this.sendCollectionHttp({
			uri: `https://api.zhihu.com/collections/contents/${this.getCollectionContentType(item.type)}/${item.id}`,
			method: "PUT",
			headers: this.collectionToggleHeaders,
			body: `add_collections=${collectionId}`
		});
		if (!response || response.statusCode != 200) {
			Output(`Collect failed: status=${response && response.statusCode}, body=${JSON.stringify(response && response.body)}`, "warn");
			return false;
		}
		await this.ensureRemoteCollectionLoaded();
		return true;
	}

	async deleteCollectionItem(item: ICollectionItem) {
		const collectionId = await this.getDefaultCollectionId();
		if (!collectionId) {
			return;
		}
		const response = await this.sendCollectionHttp({
			uri: `https://api.zhihu.com/collections/contents/${this.getCollectionContentType(item.type)}/${item.id}`,
			method: "PUT",
			headers: this.collectionToggleHeaders,
			body: `remove_collections=${collectionId}`
		});
		if (!response || response.statusCode != 200) {
			Output(`Delete collect failed: status=${response && response.statusCode}, body=${JSON.stringify(response && response.body)}`, "warn");
			return;
		}
		await this.ensureRemoteCollectionLoaded();
	}

	async getTargets(type?: MediaTypes): Promise<(ITarget & any)[]> {
		await this.ensureRemoteCollectionLoaded();
		const selected = type ? this.collection.filter(c => c.type == type) : this.collection;
		const targets: ITarget[] = [];
		for (const item of selected) {
			let target;
			if (item.type == MediaTypes.answer) {
				target = await sendRequest({
					uri: `${AnswerAPI}/${item.id}?include=content,excerpt,voteup_count,comment_count`,
					json: true,
					gzip: true
				});
			} else if (item.type == MediaTypes.question) {
				target = await sendRequest({
					uri: `${QuestionAPI}/${item.id}?include=detail,excerpt`,
					json: true,
					gzip: true
				});
			} else if (item.type == MediaTypes.article) {
				// `www.zhihu.com/api/v4/articles` is risk-controlled (403 code 10003);
				// the zhuanlan endpoint returns the same browse fields — live verified.
				target = await sendRequest({
					uri: `${ZhuanlanAPI}/${item.id}`,
					json: true,
					gzip: true
				});
			}
			if (target && !target.error) {
				targets.push(target);
			} else {
				Output(`Collection target fetch failed: type=${item.type}, id=${item.id}`, "warn");
			}
		}
		Output(`Collection targets loaded: ${targets.length}/${selected.length}`);
		return Promise.resolve(targets);
	}

	private async ensureRemoteCollectionLoaded() {
		const snapshot = await this.loadDefaultCollectionSnapshot();
		if (!snapshot) {
			return;
		}
		const response = await this.loadRemoteCollectionItems(snapshot);
		if (!response || !response.data) {
			Output(`Load remote collection failed: body=${JSON.stringify(response)}`, "warn");
			return;
		}
		this.collection = response.data
			.map(item => this.normalizeCollectionItem(item))
			.filter(item => !!item);
		Output(`Loaded remote collection items: ${this.collection.length} (remote=${response.data.length}, total=${response.paging && response.paging.totals}, declared=${this.collectionItemCount}, sync=v3)`);
		this.persist();
	}

	private async getDefaultCollectionId(): Promise<string> {
		const snapshot = await this.loadDefaultCollectionSnapshot();
		return snapshot ? snapshot.collectionId : undefined;
	}

	private async loadDefaultCollectionSnapshot(): Promise<ICollectionSnapshot | undefined> {
		const headers = this.buildCollectionReadHeaders();
		const profile = await this.sendCollectionJson({
			uri: SelfProfileAPI,
			headers
		});
		if (!profile || !profile.url_token) {
			Output("Load collections skipped: profile unavailable", "warn");
			return undefined;
		}
		const response = await this.sendCollectionJson({
			uri: `https://www.zhihu.com/api/v4/people/${profile.url_token}/collections?limit=50`,
			headers
		});
		if (!response || !response.data || !response.data.length) {
			Output(`Load collections failed: body=${JSON.stringify(response)}`, "warn");
			return undefined;
		}
		const defaultCollection = response.data.find(item => item && item.title == "我的收藏")
			|| response.data.find(item => item && item.title == "鎴戠殑鏀惰棌")
			|| response.data[0];
		this.collectionId = defaultCollection && defaultCollection.id ? defaultCollection.id.toString() : undefined;
		this.collectionItemCount = defaultCollection && typeof defaultCollection.item_count == "number"
			? defaultCollection.item_count
			: (defaultCollection && typeof defaultCollection.answer_count == "number" ? defaultCollection.answer_count : 0);
		Output(`Using default collection: ${this.collectionId} (declared=${this.collectionItemCount}, sync=v3)`);
		return this.collectionId ? { collectionId: this.collectionId, headers } : undefined;
	}

	private async loadRemoteCollectionItems(snapshot: ICollectionSnapshot) {
		const candidates = [
			`https://api.zhihu.com/collections/${snapshot.collectionId}/items?offset=0&limit=100`,
			`https://api.zhihu.com/collections/${snapshot.collectionId}/contents?offset=0&limit=100`,
			`https://www.zhihu.com/api/v4/collections/${snapshot.collectionId}/items?include=data[*].content&offset=0&limit=100`
		];
		for (const uri of candidates) {
			const response = await this.sendCollectionJson({
				uri,
				headers: snapshot.headers
			});
			const remoteCount = response && response.data ? response.data.length : -1;
			Output(`Collection items probe: uri=${uri}, remote=${remoteCount}, total=${response && response.paging ? response.paging.totals : "n/a"}`);
			if (response && response.data && response.data.length) {
				return response;
			}
			if (response && response.data && this.collectionItemCount === 0) {
				return response;
			}
		}
		return null;
	}

	private async sendCollectionJson(options) {
		try {
			return await httpClient({
				gzip: true,
				json: true,
				...options
			});
		} catch (error) {
			Output(`Collection JSON error: status=${error && error.statusCode}, body=${JSON.stringify(error && error.error)}, message=${error && error.message ? error.message : error}`, "warn");
			return null;
		}
	}

	private async sendCollectionHttp(options) {
		const cookie = getRawCookieHeader();
		try {
			return await httpClient({
				resolveWithFullResponse: true,
				simple: false,
				gzip: true,
				...options,
				headers: {
					...options.headers,
					cookie
				}
			});
		} catch (error) {
			Output(`Collection HTTP error: ${error && error.message ? error.message : error}`, "warn");
			return null;
		}
	}

	private buildCollectionReadHeaders(): Record<string, string> {
		return {
			...this.collectionReadHeaders,
			cookie: getRawCookieHeader()
		};
	}

	private getCollectionContentType(type: MediaTypes): string {
		return type;
	}

	private normalizeCollectionItem(item: any): ICollectionItem | undefined {
		if (!item) {
			return undefined;
		}
		const content = item.content ? item.content : item;
		const type = (content.type || (item.attachment && item.attachment.type) || "").toString().toLowerCase();
		const id = this.extractExactContentId(content, type);
		if (!id || !this.isSupportedType(type)) {
			return undefined;
		}
		return {
			type: type as MediaTypes,
			id
		};
	}

	private extractExactContentId(content: any, type: string): string {
		const exactId = this.extractIdFromUrl(content && content.url, type)
			|| this.extractIdFromUrl(content && content.question && content.question.url, MediaTypes.question);
		if (exactId) {
			return exactId;
		}
		return content && typeof content.id !== "undefined" ? content.id.toString() : "";
	}

	private extractIdFromUrl(url: string, type: string): string | undefined {
		if (!url) {
			return undefined;
		}
		let match;
		if (type == MediaTypes.answer) {
			match = url.match(/\/answer\/(\d+)/);
		} else if (type == MediaTypes.article) {
			match = url.match(/\/p\/(\d+)/);
		} else if (type == MediaTypes.question) {
			match = url.match(/\/question\/(\d+)/);
		}
		return match && match[1] ? match[1] : undefined;
	}

	private isSupportedType(type: string): boolean {
		return [MediaTypes.answer, MediaTypes.article, MediaTypes.question].includes(type as MediaTypes);
	}

	private persist() {
		fs.writeFileSync(getStorageFilePath(CollectionPath), JSON.stringify(this.collection), "utf8");
	}
}
