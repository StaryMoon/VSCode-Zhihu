import { IAuthorTarget } from "../target/target";
import { IColumn } from "../publish/column.model";

/**
 * Raw article detail returned by the zhihu article detail API with the edit
 * fields requested by `ARTICLE_EDIT_INCLUDE`.
 */
export interface IArticleDetailResponse {
	id?: number | string;
	type?: string;
	title?: string;
	content?: string;
	title_image?: string;
	image_url?: string;
	is_title_image_full_screen?: boolean;
	comment_permission?: string;
	column?: IColumn | null;
	author?: IAuthorTarget;
	url?: string;
	error?: {
		name?: string;
		message?: string;
		code?: number;
	};
}

/**
 * Validated article content ready to be turned into an editable Markdown
 * draft.
 */
export interface EditableArticle {
	id: string;
	title: string;
	content: string;
	titleImage?: string;
	isTitleImageFullScreen?: boolean;
	commentPermission?: string;
	column?: IColumn | null;
	author?: IAuthorTarget;
}

/**
 * Structured parameters for publishing an article. When `articleId` is set
 * the publish flow updates the existing draft of that article instead of
 * creating a new one.
 *
 * `titleImage` distinguishes three states:
 * - `string`: use this url as the article cover;
 * - `null`: explicitly clear the cover;
 * - `undefined`: leave the current cover untouched.
 */
export interface ArticlePublishPayload {
	articleId?: string;
	title: string;
	content: string;
	titleImage?: string | null;
	isTitleImageFullScreen: boolean;
	column?: IColumn | null;
	commentPermission?: string;
}

/**
 * Target accepted by the `zhihu.editArticle` command. Comes from a tree node
 * target, a webview message or user input.
 */
export interface ArticleEditTarget {
	id?: string;
	url?: string;
	type?: string;
}
