"use strict";

import * as fs from "fs";
import * as MarkdownIt from "markdown-it";
import * as markdown_it_zhihu from "markdown-it-zhihu";
import * as path from "path";
import { CookieJar } from "tough-cookie";
import * as FileCookieStore from "tough-cookie-filestore";
import * as vscode from "vscode";
import { AccountService } from "./service/account.service";
import { AuthenticateService } from "./service/authenticate.service";
import { CollectionService } from "./service/collection.service";
import { EventService } from "./service/event.service";
import { DraftService } from "./service/draft.service";
import { HttpService, clearCache } from "./service/http.service";
import { PasteService } from "./service/paste.service";
import { PipeService } from "./service/pipe.service";
import { ProfileService } from "./service/profile.service";
import { PublishService } from "./service/publish.service";
import { showReleaseNote } from "./service/release-note.service";
import { SearchService } from "./service/search.service";
import { WebviewService } from "./service/webview.service";
import { CollectionItem, CollectionTreeviewProvider } from "./treeview/collection-treeview-provider";
import { EventTreeItem, FeedTreeItem, FeedTreeViewProvider } from "./treeview/feed-treeview-provider";
import { HotStoryTreeViewProvider } from "./treeview/hotstory-treeview-provider";
import { getStorageFilePath, setContext } from "./global/globa-var";
import { Output } from "./global/logger";
import * as CacheManager from "./global/cache"
import { ZhihuCompletionProvider, AtPeople } from "./lang/completion-provider";
import { mermaiSupport } from "./util/mermai-support";

export async function activate(context: vscode.ExtensionContext) {
	Output('Extension Activated')
	setContext(context);
	const cookiePath = getStorageFilePath('cookie.json');
	const legacyCookiePath = path.join(context.extensionPath, './cookie.json');
	if(!fs.existsSync(cookiePath)) {
		if (fs.existsSync(legacyCookiePath)) {
			fs.copyFileSync(legacyCookiePath, cookiePath);
		} else {
			fs.writeFileSync(cookiePath, '{}')
		}
	} else {
		try {
			const cookieContent = fs.readFileSync(cookiePath, 'utf8').trim();
			if (!cookieContent) {
				fs.writeFileSync(cookiePath, '{}')
			} else {
				JSON.parse(cookieContent);
			}
		} catch (error) {
			fs.writeFileSync(cookiePath, '{}')
		}
	}
	// Dependency Injection
	showReleaseNote()
	const zhihuMdParser = new MarkdownIt({ html: true }).use(markdown_it_zhihu);
	zhihuMdParser.renderer.rules.table_open = () => `<table data-draft-node="block" data-draft-type="table" data-size="normal" data-row-style="striped"><tbody>`;
	zhihuMdParser.renderer.rules.table_close = () => "</tbody></table>";
	zhihuMdParser.renderer.rules.thead_open = () => "";
	zhihuMdParser.renderer.rules.thead_close = () => "";
	zhihuMdParser.renderer.rules.tbody_open = () => "";
	zhihuMdParser.renderer.rules.tbody_close = () => "";
	const defualtMdParser = new MarkdownIt();
	const accountService = new AccountService();
	const profileService = new ProfileService(accountService);
	await profileService.fetchProfile();
	const collectionService = new CollectionService();
	const hotStoryTreeViewProvider = new HotStoryTreeViewProvider();
	const collectionTreeViewProvider = new CollectionTreeviewProvider(profileService, collectionService)
	const webviewService = new WebviewService(collectionService, collectionTreeViewProvider);
	const eventService = new EventService();
	const feedTreeViewProvider = new FeedTreeViewProvider(accountService, profileService, eventService);
	const searchService = new SearchService(webviewService);
	const authenticateService = new AuthenticateService(profileService, accountService, feedTreeViewProvider, webviewService);
	const draftService = new DraftService();
	const pasteService = new PasteService();
	const pipeService = new PipeService(pasteService);
	const publishService = new PublishService(zhihuMdParser, defualtMdParser, webviewService, collectionService, eventService, profileService, pasteService, pipeService);


	context.subscriptions.push(
		vscode.commands.registerCommand("zhihu.openWebView", async (object) => {
			await webviewService.openWebview(object);
		}
		));
	vscode.commands.registerCommand("zhihu.search", async () =>
		await searchService.getSearchItems()
	);
	vscode.commands.registerCommand("zhihu.clearCache", () => {
		clearCache()
		CacheManager.clearCache()
	})
	vscode.commands.registerCommand("zhihu.login", () =>
		authenticateService.login()
	);
	vscode.commands.registerCommand("zhihu.jianshuLogin", () => {
		authenticateService.jianshuLogin()
	});
	vscode.commands.registerCommand("zhihu.logout", () =>
		authenticateService.logout()
	);
	vscode.window.registerTreeDataProvider(
		"zhihu-feed",
		feedTreeViewProvider
	);
	vscode.window.registerTreeDataProvider(
		"zhihu-hotStories",
		hotStoryTreeViewProvider
	);
	vscode.window.registerTreeDataProvider(
		"zhihu-collection",
		collectionTreeViewProvider,
	)
	vscode.commands.registerTextEditorCommand('zhihu.publish', (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit) => {
		publishService.publish(textEditor, edit);
	})
	vscode.commands.registerTextEditorCommand('zhihu.preview', (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit) => {
		publishService.preview(textEditor, edit);
	})
	vscode.commands.registerCommand("zhihu.newDraft", () =>
		draftService.createDraft()
	);
	vscode.commands.registerCommand('zhihu.uploadImageFromClipboard', async () => {
		pasteService.uploadImageFromClipboard()
	})

	vscode.commands.registerCommand('zhihu.uploadImageFromPath', (uri: vscode.Uri) => {
		pasteService.uploadImageFromPath(uri)
	})

	vscode.commands.registerCommand('zhihu.uploadImageFromExplorer', () => {
		pasteService.uploadImageFromExplorer()
	})
	vscode.commands.registerCommand("zhihu.refreshFeed", () => {
		feedTreeViewProvider.refresh();
	}
	);
	vscode.commands.registerCommand("zhihu.refreshHotstories", () => {
		hotStoryTreeViewProvider.refresh();
	})
	vscode.commands.registerCommand("zhihu.refreshCollection", () => {
		collectionTreeViewProvider.refresh();
	})
	vscode.commands.registerCommand("zhihu.atPeople", () => {
		AtPeople()
	})
	context.subscriptions.push(vscode.languages.registerCompletionItemProvider('markdown', new ZhihuCompletionProvider
	, '@'));

	vscode.commands.registerCommand(
		"zhihu.deleteCollectionItem",
		async (node: CollectionItem) => {
			await collectionService.deleteCollectionItem(node.item);
			collectionTreeViewProvider.refresh(node.parent);
			vscode.window.showInformationMessage('已从收藏夹移除');
		}
	)
	vscode.commands.registerCommand(
		"zhihu.deleteEventItem",
		(node: EventTreeItem) => {
			eventService.destroyEvent(node.event.hash);
			vscode.window.showInformationMessage(`已取消发布！`);
			feedTreeViewProvider.refresh(node.parent);
		}
	)
	vscode.commands.registerCommand(
		"zhihu.nextPage",
		(node: FeedTreeItem) => {
			node.page++;
			feedTreeViewProvider.refresh(node);
		}
	)
	vscode.commands.registerCommand(
		"zhihu.previousPage",
		(node: FeedTreeItem) => {
			node.page--;
			feedTreeViewProvider.refresh(node);
		}
	)


	return {
        extendMarkdownIt(md: any) {
			return mermaiSupport(md)
        }
    }
}
