# 支持修改知乎文章的设计方案

## 1. 结论

可以支持，而且仓库已经具备一部分后端能力：

- `src/service/publish.service.ts` 已经识别首行 `#! https://zhuanlan.zhihu.com/p/<id>`。
- 识别到文章链接后，现有发布流程会调用 `putArticle`。
- `putArticle` 已经按知乎专栏接口执行 `PATCH /api/articles/<id>/draft`，再执行 `PUT /api/articles/<id>/publish`。
- 新文章发布也已经采用“创建草稿、PATCH 正文、发布”的接口顺序。

因此问题不是“完全没有修改 API”，而是当前实现没有形成完整、可发现、可靠的“浏览文章 -> 打开 Markdown 编辑 -> 更新原文章”闭环。用户必须自己准备带文章链接的 Markdown 文件，且更新流程还有若干可能导致数据丢失或错误发布的缺陷。

推荐的产品形态是：

1. 从文章阅读 Webview、推荐/热榜/收藏树，或命令面板选择一篇文章。
2. 插件读取文章正文和元数据，创建一个新的 Markdown 编辑器。
3. 自动在首行写入文章链接，保留标题和封面，正文转换成可编辑 Markdown。
4. 用户修改后执行现有的 `Zhihu: Publish Current Markdown`。
5. 发布服务根据首行链接进入“更新文章”分支，先 PATCH 草稿，再 PUT 发布，文章 URL 和 ID 保持不变。

不建议在 Webview 内另做一套富文本编辑器。项目已有 Markdown 发布链路，复用它可以减少两套内容格式和上传图片逻辑之间的不一致。

## 2. 当前实现审计

| 位置 | 当前行为 | 对修改文章的影响 |
| --- | --- | --- |
| `src/service/publish.service.ts:158-333` | 解析首行 `#!`，将 Markdown 转为知乎 HTML；文章链接进入 `putArticle` | 已有“按已知 URL 更新”的隐式入口，但没有引导用户获得这份 Markdown |
| `src/service/publish.service.ts:637-684` | PATCH 文章草稿后 PUT 发布 | 基本接口顺序正确，但没有检查 PATCH 是否成功，失败时仍可能继续发布 |
| `src/service/webview.service.ts:102-141` | 获取文章并渲染阅读 Webview | 没有编辑按钮或编辑事件 |
| `res/template/article.pug` | 只有收藏、分享、浏览器打开按钮 | 用户无法从文章阅读页进入编辑 |
| `src/treeview/*` | 文章条目只绑定 `zhihu.openWebView` | 树视图没有“修改文章”上下文菜单 |
| `package.json` | 没有 `zhihu.editArticle` 命令 | 命令面板也没有文章编辑入口 |
| `src/service/codex-export.service.ts:221-258` | 有一个私有 HTML -> Markdown 转换器 | 可以复用方向，但当前转换器会破坏 Markdown 链接，列表/代码/知乎特殊 HTML 也不够可靠 |
| `src/service/event.service.ts` 与 `PublishService.registerPublishEvents` | 定时任务只持久化内容，恢复时统一调用 `postArticle` | 定时更新文章在重启后可能被错误地当成新文章发布，不能直接沿用 |
| `src/service/pipe.service.ts` | 非 `pic4.zhimg.com` 图片会重新上传 | 编辑已有文章时可能重复上传知乎图片，应扩大知乎图床识别范围 |

仓库文档和 `CHANGELOG.md` 已经描述过“首行文章链接可更新文章”，这说明功能意图曾经存在；但现版本缺少可发现的编辑入口，也缺少从远端 HTML 生成 Markdown 草稿的实现，所以用户会认为插件不支持修改文章。

## 3. 目标与非目标

### 3.1 目标

- 支持从文章阅读页、侧边栏文章条目和命令面板开始修改自己的知乎文章。
- 生成一个可以保存为普通 `.md` 文件的草稿，首行携带原文章 URL。
- 保留文章 ID、标题、封面图和正文中的常见格式。
- 更新时不创建新文章，成功后仍使用原文章 URL。
- 默认保留文章原专栏和评论权限；用户明确选择时才改变归属。
- PATCH 失败时不执行 PUT；网络或权限错误要给出可理解的提示。
- 保留现有 Markdown 发布、知乎图片上传、预览和定时发布能力。
- 通过纯函数测试内容转换和发布请求决策，不依赖真实账号运行自动化测试。

### 3.2 非目标

- 不在本次设计中实现知乎 Web 写作页的完整富文本克隆。
- 不修改回答的编辑流程；回答更新继续使用现有 `#!` 逻辑。
- 不同步知乎草稿箱、版本历史、评论或赞同数据。
- 不把远端文章自动覆盖用户已有的本地文件；首次编辑使用新的 Markdown 文档，用户自行保存到工作区。
- 不承诺知乎未公开接口长期稳定；接口变化需要通过登录后的手工冒烟测试发现并修复。

## 4. 推荐用户流程

### 4.1 从阅读 Webview 编辑

1. 用户在推荐、热榜、收藏、搜索结果中打开文章。
2. 文章 Webview 顶部增加“编辑文章”按钮。
3. 点击后执行 `zhihu.editArticle`，传入文章 ID 或目标对象。
4. 插件请求文章详情，确认正文、标题和文章作者信息存在，并检查当前登录用户是否为作者；最终权限仍由知乎接口判断。
5. 插件创建一个非预览的 Markdown 编辑器并聚焦。
6. 用户修改内容后，点击 `Zhihu: Publish Current Markdown`。
7. 因为首行是文章链接，发布服务直接进入更新文章分支，不再询问发布为新文章。

### 4.2 从树视图编辑

文章条目的右键菜单增加 `Zhihu: Edit Article`。回答和问题条目不显示该菜单。

当前不同树视图对文章类型的保存方式不完全一致：

- 推荐树的 `FeedTreeItem` 保留了文章类型。
- 热榜树目前把部分条目的 type 设为空字符串，需要保留 `story.target.type`。
- 收藏树有 `MediaTypes.article`，但所有叶子节点共用 `collect-item` context value。

实现时为文章叶子节点设置明确的 `article` 或 `collect-article` context value，使用 `package.json` 的 `view/item/context` 精确控制菜单显示，而不是给所有内容条目显示后再在运行时拒绝。

### 4.3 从命令面板编辑

命令面板执行 `Zhihu: Edit Article` 且没有传入目标时，弹出 URL 输入框。只接受文章链接或纯数字文章 ID；链接应支持：

```text
https://zhuanlan.zhihu.com/p/123456
https://zhuanlan.zhihu.com/p/123456/
```

URL 校验应限制为知乎文章路径，并统一提取数字 ID。不能把任意 `*.zhihu.com` URL 当成文章更新目标。

### 4.4 生成的 Markdown 格式

生成内容的最小格式如下：

```markdown
#! https://zhuanlan.zhihu.com/p/123456

![文章封面](https://pic4.zhimg.com/80/example.png)

# 原文章标题

这里是转换后的正文。
```

约定如下：

- `#!` 必须是第一行，作为文章身份，不参与发布正文。
- 封面图放在第一个 H1 之前，复用现有文章发布逻辑的“首个 H1 前图片是封面”规则。
- 第一个 H1 是文章标题；用户可以直接修改它。
- 如果原文章没有封面，则不生成占位图片。
- 不写入隐藏的专栏元数据注释。发布更新时重新读取当前文章元数据，避免用户保存文件后元数据过期。
- 生成的是 Untitled Markdown 文档，不覆盖已有文件；用户可以使用 VSCode 的保存操作将其纳入工作区。

## 5. 技术方案

### 5.1 新增文章编辑服务

新增 `src/service/article-edit.service.ts`，只负责“取得可编辑文章并打开 Markdown 草稿”，不负责发布。

建议接口：

```ts
interface ArticleEditTarget {
    id?: string;
    url?: string;
    type?: string;
}

interface EditableArticle {
    id: string;
    title: string;
    content: string;
    titleImage?: string;
    isTitleImageFullScreen?: boolean;
    commentPermission?: string;
    column?: IColumn;
    author?: IAuthorTarget;
}

class ArticleEditService {
    public async editArticle(target?: ArticleEditTarget): Promise<void>;
    private async fetchArticleForEdit(articleId: string): Promise<EditableArticle | undefined>;
    private buildMarkdown(article: EditableArticle): string;
}
```

具体职责：

1. 从传入树条目、Webview 事件或用户输入中解析文章 ID，统一使用现有 `resolveTargetId`，不要在多个入口各写一套正则。
2. 使用现有 `sendRequest` 和 Cookie/XSRF 机制请求文章详情。优先使用已有的 `ArticleAPI`，请求中明确包含 `content`、`title`、`title_image`、`column`、`comment_permission`、`is_title_image_full_screen` 和 `author` 等编辑所需字段。
3. 对响应进行字段校验。没有正文或标题时终止，不要生成空草稿。
4. 使用当前登录 profile 与文章 author 做前置归属提示。不能把这个检查当成权限保证，PATCH 返回 403/404 时仍要正确处理。
5. 调用共享的 HTML -> Markdown 转换器，拼接 `#!`、封面、H1 和正文。
6. 通过 `vscode.workspace.openTextDocument({ language: "markdown", content })` 打开文档，并使用 `preview: false`，避免新草稿被 VSCode 当作临时预览标签复用。

知乎的文章详情接口是非公开使用方式，正式实现前需要用当前登录状态手工确认实际字段名和返回内容。若当前 `www.zhihu.com/api/v4/articles/<id>` 响应缺少正文，应在接口验证阶段确定唯一的正式读取端点，然后固定下来；不要在运行时静默尝试多个不确定端点。

### 5.2 HTML -> Markdown 转换

新增 `src/util/html-to-markdown.ts`，将 `CodexExportService` 中的私有转换逻辑提升为共享能力，并修正其不适合回写文章的问题。

推荐优先使用成熟的 HTML -> Markdown 库（例如 Turndown），再增加知乎格式规则；如果根据当前依赖和 TypeScript 版本验证后认为引入库的成本过高，则使用现有 `cheerio` 实现同等规则，但不能直接复用当前的有损实现。

至少需要覆盖：

- `p`、换行和常见标题。
- 粗体、斜体、删除线、行内代码。
- 正确的 Markdown 链接 `[文字](URL)`，不能转换成 `文字 (URL)`。
- 图片 `src`、`data-original`、`data-original-src`、`data-actualsrc` 的优先级处理。
- 有语言标识的代码块，例如 `lang-java` 或 `language-java`。
- 有序列表、无序列表和嵌套列表。
- 引用、分隔线和表格。
- 知乎公式图片：保留其公式语义，不能变成无意义的图片链接；如果无法可靠还原为公式，保留原始 HTML 作为可编辑内容并在日志中记录。
- `noscript`、懒加载属性和知乎展示用的非正文节点清理。
- 不认识的知乎专用 HTML 尽可能原样保留，而不是静默丢弃。

转换器应是纯函数，输入 HTML 和可选封面信息，输出 Markdown。`CodexExportService` 也改用该共享函数，避免两个转换器逐渐产生不同结果。

编辑已有文章时，图片策略需要和发布策略配套：

- 将 `pic*.zhimg.com`、`zhimg.com` 的合法图片识别为知乎图床，避免每次修改都重复上传。
- 其他外链和本地图片继续交给 `PipeService` 处理。
- 如果用户删除封面，更新请求必须显式发送清空值，而不是让 `undefined` 在 JSON 序列化时被省略。

### 5.3 重构文章发布参数

在 `PublishService` 中抽取结构化的文章发布数据，避免继续依赖 token 下标和多个可选参数：

```ts
interface ArticlePublishPayload {
    articleId?: string;
    title: string;
    content: string;
    titleImage?: string | null;
    isTitleImageFullScreen: boolean;
    column?: IColumn | null;
    commentPermission?: string;
}
```

建议步骤：

1. 将首行 shebang、H1、H1 前封面和正文解析成结构化结果。
2. 文章更新和新文章发布共用 Markdown 解析、图片上传和 HTML 生成逻辑。
3. 文章链接存在时设置 `articleId`，进入更新路径；无链接时进入新文章路径。
4. 更新时先读取当前文章的专栏、评论权限和封面元数据。
5. 默认选择“保持原专栏”，同时提供“选择其他专栏”和“不归属专栏”选项。只有用户明确选择后才改变文章归属。
6. `putArticle` 先以 `resolveWithFullResponse: true` 执行 PATCH，并确认状态码为 2xx；失败时显示状态码和接口错误摘要，立即返回。
7. PATCH 成功后才执行 PUT 发布；PUT 成功后提示原 URL。
8. 文章更新成功不插入第二个 `#!` 行，也不创建新的文章 ID。
9. 新文章发布仍保留现有行为，但应把编辑器作为参数传给发布函数，不能依赖发布完成时的 `vscode.window.activeTextEditor`。
10. 删除当前 `if (!column) { vscode.window; }` 这种无实际效果的分支；用户取消选择或必需字段缺失时直接终止操作。

错误处理至少区分：

- 未登录或 Cookie 失效：提示重新登录。
- 文章不存在：提示文章 ID 无效或文章已删除。
- 非作者/无权限：提示只能修改自己的文章。
- PATCH 失败：显示“草稿保存失败”，绝不调用发布接口。
- PUT 失败：显示“文章发布失败”，保留本地 Markdown 供重试。
- 网络请求返回空值：不能继续访问 `response.id` 或 `response.statusCode` 造成未捕获异常。

### 5.4 定时发布任务

当前文章更新分支也会显示“稍后发布”，但 `EventService` 持久化后没有保存操作类型，插件重启时 `registerPublishEvents` 会统一调用 `postArticle`。这对文章更新是高风险行为：用户以为会修改旧文，实际可能生成新文。

推荐在本次实现中一并改为可序列化发布任务：

```ts
type PublishOperation =
    | "postArticle"
    | "updateArticle"
    | "postAnswer"
    | "updateAnswer";

interface IEvent {
    operation: PublishOperation;
    targetId?: string;
    content: string;
    title?: string;
    titleImage?: string | null;
    column?: IColumn | null;
    date: Date;
    hash: string;
    timeoutId?: NodeJS.Timeout;
}
```

- 注册任务时保存 `operation`、`targetId` 和更新所需参数。
- 启动恢复时根据 `operation` 分派到 `postArticle` 或 `putArticle`。
- 不把闭包函数作为恢复任务的唯一行为来源。
- 任务哈希应包含操作类型和目标 ID，避免不同文章或“新建/更新”任务发生内容哈希冲突。
- 旧的、缺少可恢复操作信息的任务不能默认为 `postArticle`；应记录警告并要求用户重新安排，避免误发新文章。

如果实现阶段需要严格缩小首个版本范围，可以先对文章更新禁用“稍后发布”，但必须给出明确提示，不能沿用当前会在重启后误发新文章的路径。完整方案优先采用上面的可序列化任务模型。

### 5.5 Webview 与命令接线

改动点：

- `src/const/ENUM.ts`：增加 `WebviewEvents.editArticle`。
- `res/template/article.pug`：在顶部操作区增加编辑按钮，使用现有 Webview 按钮风格，并提供可识别的 tooltip/title。
- `res/template/js/global.js`：让编辑按钮发送 `editArticle` 消息。
- `src/service/webview.service.ts`：文章页面注册编辑消息，调用 `vscode.commands.executeCommand("zhihu.editArticle", { type: "article", id, url })`。WebviewService 不直接依赖 ArticleEditService，避免服务初始化顺序和循环依赖。
- `src/extension.ts`：实例化并注册 `zhihu.editArticle`，处理来自树节点、Webview 和命令面板的不同参数形态。
- `package.json`：增加 activation event、command、编辑图标以及文章条目的 context menu。
- `src/treeview/feed-treeview-provider.ts`、`src/treeview/hotstory-treeview-provider.ts`、`src/treeview/collection-treeview-provider.ts`：为文章节点设置明确的 context value，并保留文章类型和 ID。

命令处理器应统一解包：

```ts
const target = node && node.target ? node.target : node;
```

这样树节点和 Webview 传来的简单对象都可以走同一个 `ArticleEditService.editArticle`。

## 6. 文件级改动清单

### 新增

- `src/service/article-edit.service.ts`：读取文章、归属校验、创建 Markdown 草稿。
- `src/util/html-to-markdown.ts`：共享 HTML -> Markdown 转换器及知乎特殊节点规则。
- `test/suite/article-edit.service.test.ts`：文章草稿生成和输入校验测试。
- `test/fixtures/article-edit/`：包含正文、链接、图片、代码、列表、公式和表格的 HTML fixture。
- `res/media/light/edit.svg`、`res/media/dark/edit.svg`：文章阅读页和命令图标（如果现有图标规范要求）。

### 修改

- `src/service/publish.service.ts`：结构化文章 payload、更新请求校验、原专栏保留、定时任务参数。
- `src/service/codex-export.service.ts`：改用共享 HTML -> Markdown 转换器。
- `src/service/event.service.ts`：保存并恢复可序列化操作信息。
- `src/model/article/article-detail.ts` 或新增文章编辑模型：补齐 `column`、`title_image`、评论权限、正文等字段的可选/正确类型。
- `src/model/publish/column.model.ts`：如接口验证需要，补充文章更新所需的最小专栏字段类型。
- `src/util/zhihu-id.ts`、`src/const/REG.ts`：统一文章 ID 提取，并支持规范的尾部斜杠；严格验证文章 host/path。
- `src/service/pipe.service.ts`：扩大知乎图床识别范围，避免重复上传。
- `src/const/ENUM.ts`：增加 Webview 编辑事件。
- `src/service/webview.service.ts`、`res/template/article.pug`、`res/template/js/global.js`：接通 Webview 编辑入口。
- `src/treeview/*`：文章 context value 和右键菜单参数。
- `src/extension.ts`、`package.json`：注册命令、菜单、激活事件和图标。
- `README.md`、`CHANGELOG.md`、`release_notes/`：说明文章编辑入口、Markdown 格式、权限和接口限制。
- `package.json`、`package-lock.json`：如果最终采用 Turndown，则增加依赖和锁文件变更；否则保持现有依赖不变。

## 7. 测试计划

### 7.1 纯函数/单元测试

1. 文章 URL 解析：标准 URL、尾部斜杠、带 query/hash、纯数字 ID、问题/回答链接误判。
2. Markdown 草稿生成：
   - `#!` 在第一行。
   - 标题转为第一个 H1。
   - 封面存在时位于 H1 前，缺失时不生成占位内容。
   - 正文为空或标题为空时拒绝生成。
3. HTML -> Markdown：
   - 段落、强调、链接、图片、代码块和语言标识。
   - 嵌套列表、引用、表格和分隔线。
   - 懒加载图片属性和 `noscript`。
   - 知乎公式/未知 HTML 的保留策略。
4. 发布路由：有文章 ID 进入 update，无 ID 进入 create；不会把文章链接路由到回答或新建文章。
5. 请求顺序：PATCH 返回非 2xx 时，PUT 不应被调用；PATCH 成功后才允许 PUT。
6. 更新 payload：保留原专栏、评论权限和封面；显式删除封面时发送清空值。
7. 定时任务恢复：`updateArticle` 只调用 `putArticle`，不会调用 `postArticle`。

### 7.2 VSCode 集成/手工测试

自动测试不应使用真实 Cookie。需要通过可注入的 request 函数或纯函数测试请求决策，真实 API 通过手工冒烟验证：

1. 已登录用户从文章阅读页点击编辑，生成 Markdown 草稿。
2. 从推荐、热榜和收藏的文章节点右键编辑；问题和回答节点不出现编辑菜单。
3. 修改标题、段落、链接、图片、代码和公式后立即发布，确认原 URL 内容更新且没有新文章。
4. 删除封面后发布，确认知乎文章封面被清除或按接口定义处理。
5. 使用非本人文章测试，确认编辑入口或 PATCH 返回明确权限错误。
6. PATCH 接口失败时确认不会触发 PUT，且本地文档仍可重试。
7. 关闭并重新打开 VSCode 后执行定时文章更新，确认目标 ID 不变。
8. Cookie 失效、接口返回空 body、429、403、404 时确认不会出现未捕获异常。

## 8. 实施顺序

### 阶段 0：接口确认

- 使用当前登录态抓取一篇自己的文章详情，确认正文、标题、封面、专栏、评论权限字段。
- 用测试文章验证 PATCH 草稿和 PUT 发布的真实状态码、请求 body 和必要 headers。
- 确认正文中的公式、图片懒加载属性和知乎专用 HTML 形态。
- 将脱敏后的响应结构保存为测试 fixture，不保存 Cookie、账号信息或完整私人内容。

### 阶段 1：内容模型和转换

- 新增编辑文章类型。
- 抽取并增强 HTML -> Markdown 转换器。
- 添加 URL、草稿生成、转换器 fixture 测试。
- 先完成“从固定文章对象生成 Markdown”的闭环。

### 阶段 2：编辑服务和命令

- 实现 `ArticleEditService` 的读取、校验和打开文档。
- 注册 `zhihu.editArticle`。
- 支持 URL/ID 输入和树节点参数。
- 完成命令级单元测试。

### 阶段 3：发布更新可靠性

- 重构文章 payload 解析。
- 保留当前专栏和封面，补齐取消、权限、空响应和错误处理。
- 严格执行 PATCH -> PUT。
- 修复文章更新事件类型和可序列化定时任务。

### 阶段 4：界面入口

- 接通文章 Webview 编辑按钮。
- 接通推荐、热榜、收藏树的右键菜单。
- 增加图标、activation event 和 command contribution。

### 阶段 5：验证与文档

- 执行 `npm run compile`、`npm run lint` 和现有测试。
- 执行已登录账号的文章编辑手工冒烟测试。
- 更新 README、CHANGELOG 和 release note。
- 执行 `npm run vscode:prepublish`，检查打包结果包含模板和图标资源。

## 9. 风险与处理

| 风险 | 处理方式 |
| --- | --- |
| 知乎编辑接口是非公开接口，字段或风控策略变化 | 阶段 0 固定真实请求契约；统一封装并记录脱敏错误；不把失败当成功 |
| HTML -> Markdown 有损，重新发布改变排版 | 使用成熟转换器加知乎规则；未知节点保留 HTML；增加 fixture 和人工对比 |
| 文章图片被重复上传 | 识别完整知乎图床域名和懒加载字段；转换前后做图片链接测试 |
| 误修改他人文章 | 读取时提示作者不匹配，更新时依赖服务端权限，并展示 403/404 |
| 原文章专栏被意外清空或迁移 | 更新前读取并默认保留原专栏，只有明确选择才改变 |
| PATCH 失败后仍 PUT | 使用完整响应检查并覆盖请求顺序测试 |
| VSCode 重启后定时更新变成新建文章 | 持久化 operation/targetId；无法恢复的旧任务不默认执行 `postArticle` |
| 用户本地 Markdown 和远端文章并发修改 | 首个版本不做自动合并；每次编辑从远端生成新草稿，发布前由用户确认本地内容 |

## 10. 验收标准

功能完成后应满足：

- 用户不需要手写 `#!` 或查找文章 ID，就能从文章阅读页或文章树条目打开可编辑 Markdown。
- 生成的文档首行是原文章链接，标题、封面和常见正文格式可编辑。
- 执行 `Zhihu: Publish Current Markdown` 会更新原文章，不会新建文章。
- 更新流程在 PATCH 失败时停止，成功提示指向原文章 URL。
- 原专栏默认保持不变，封面删除和变更行为明确可验证。
- 文章编辑菜单不会出现在问题和回答条目上。
- VSCode 重启后，已安排的文章更新不会退化为新文章发布。
- 自动化测试覆盖 ID 解析、转换、发布路由、请求顺序和定时任务恢复；真实接口通过登录账号完成一次手工冒烟测试。
