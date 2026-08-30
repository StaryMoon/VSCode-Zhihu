# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Maintained fork

- 新增 `Zhihu: Edit Article`：文章阅读 Webview 顶部“编辑文章”按钮、推荐/热榜/收藏文章条目右键菜单、命令面板粘贴文章链接或文章 ID 三个入口，把已有知乎文章拉成可编辑的 Markdown 草稿（首行 `#!` 携带原文章 URL，封面图在首个 H1 之前）。
- 首行是文章链接时执行 `Zhihu: Publish Current Markdown` 会更新原文章：发布前重新读取原文章，默认保持原专栏和评论权限；删除 H1 前封面图会显式清空封面；文章 URL 和 ID 保持不变。
- 文章更新严格执行 PATCH 草稿 → PUT 发布：PATCH 非 2xx 或无响应时绝不触发发布，并对 401/403/404、网络失败给出可理解的提示，本地内容保留可重试。
- 定时发布任务改为可序列化操作模型（`postArticle`/`updateArticle`/`postAnswer`/`updateAnswer` + 目标 ID）：重启后按原操作恢复，文章更新不会再退化成新建文章；无法恢复的旧任务会被丢弃并提示重新安排。
- HTML → Markdown 转换器提升为共享模块并修复：链接转为 `[文字](URL)`、懒加载图片优先级、代码块语言、嵌套列表/引用/表格、知乎公式图片还原为 TeX、`noscript` 去重、未知知乎卡片保留原始 HTML；Codex 导出同步复用。
- 扩大知乎图床识别（`*.zhimg.com` 等），编辑已有文章不再重复上传知乎图片；文章 ID 解析严格校验 `zhuanlan.zhihu.com/p/<id>`（支持尾部斜杠），问题/回答链接不会被误判为文章。
- 新增转换器、草稿生成、URL 解析、发布路由、PATCH→PUT 请求顺序和定时任务恢复的自动化测试。

## [0.6.4]

### Maintained fork

- 新增 `Zhihu: Export Question for Codex`，可粘贴知乎问题链接，将问题详情和回答正文导出到 `~/Downloads/zhihu-drafts/zhihu-question-<id>.md`。
- 新增 `Zhihu: Search Question for Codex`，可输入关键词搜索知乎问题，选择结果后直接导出问题和回答。
- 导出命令复用插件已有知乎登录态，不导出 cookie，只保存问题、回答、作者、赞同数、评论数和正文内容，便于后续交给 Codex 分析。

## [0.6.3]

### Maintained fork

- 将 `Zhihu: Write Answer for This Question` 从树条目的行内按钮改为右键菜单动作，点击推荐、热榜、收藏条目会继续打开原知乎阅读页。
- 从推荐、热榜、收藏创建回答草稿时，只生成首行 `#! https://www.zhihu.com/question/...` 目标链接，不再插入 TL;DR、正文、小结等引导模板。
- README 首页更新为 0.6.3 教程，明确区分“左键浏览”和“右键写回答”。

## [0.6.2]

### Maintained fork

- 新增 `Zhihu: Publish Markdown as Answer`，Markdown 编辑器右键即可将当前文档发布为知乎回答。
- 若当前 Markdown 没有首行 `#!` 目标链接，发布回答时会主动询问知乎问题链接并写入文档头部。
- 新增 `Zhihu: Write Answer for This Question`，支持从推荐、热榜、收藏条目直接生成回答草稿。
- README 首页增加大字版文章/回答发布教程，方便 VSIX 使用者快速上手。

## [0.6.1]

### Maintained fork

- 基于上游 PR #211 合入新版二维码登录、Cookie 存储、收藏同步和热榜修复。
- 恢复 `Zhihu: Preview` 命令，并在 Markdown 编辑器右键菜单和标题栏展示预览入口。
- 新增 `Zhihu: Publish Current Markdown` 命令，并在 Markdown 编辑器右键菜单和标题栏展示发布入口。
- 新增 `Zhihu: New Draft` 命令，可直接创建知乎文章/回答 Markdown 草稿模板。
- 维护版 VSIX 保持原扩展标识 `niudai.vscode-zhihu`，便于升级已有安装并复用原插件的登录/存储状态。

## [0.3.0]

### 文章/答案发布后自动生成头部链接

在以往的版本中，发布一篇新文章，新答案，就会产生新的链接，但是如果想修改这篇文章或答案，就需要用 `#! https://zhuanlan.zhihu.com/p/126167760` 形式的链接置于文章顶部，在 0.3 版本中，该操作插件会替你自动完成，也就是说，一份源 markdown 文件，发布后会自动指向对应的文章和答案，修改后再发布，即可修改源文章。

### 域外图片缓存加速

上一个版本中，插件支持了域外链接和本地链接的图片，但是使用起来会发现，发布的时间比较长，尤其是有域外链接的图片时，插件会先把域外的图片下载到本地，再传到知乎图床上，完成链接的替换，在 0.3 版本中，已经上传过的域外链接，插件会有缓存记录，再次发布时，会直接完成链接替换，跳过下载和上传过程。

如要清理缓存，请使用 `zhihu.clearCache` 命令。

### 支持本地绝对路径

上一个版本，图片链接只支持本地相对路径和域外 https 链接，新版本支持本地的绝对路径。（请注意 http:// 协议仍然不支持，请保证域外图片为 https://)

## [0.2.3]

众所周知，一个来自外域的图片链接，是不一定能在知乎平台上正常显示的，因为会涉及到跨域问题，为了安全起见，原则上所有答案/文章中的图片，都要上传至知乎的图床，然后将链接放在答案中，这样才能正常显示。

不仅如此，知乎服务端也不允许上传的答案或文章中的图片的来源为非知乎的源，即便我们试图这样做，其实也是不可行的。

所以在图片链接上这点，用户需要用插件自身提供的图片上传功能，上传至知乎图床，插件也会自动在 Markdown 文本里插入图片链接，其实已经比较方便了，但不能算作“非侵入式”，因为这改变了用户本来的习惯。

于是小岱开始开发了一个新 Feature，这个 Feature 可以让用户无需在意图片链接是否是来自知乎图床，这个链接可以是本地的相对路径，也可以来自于知乎域外，发布至知乎时，所有的图片都能够正常显示。

也就是说，随便在你的电脑中拿出一个你以前写好的某个 README，就算这个 README 里面有一堆相对路径的图片，或来自奇奇怪怪的图床的图片，只需右键点击发布，it just works。

比如：

![Image](https://pic4.zhimg.com/80/v2-0b00790259520bdbda398cd05731b06b.png)

源 Markdown 中的所有图片都是相对路径或来自外链。

发布后的效果：

![Image](https://pic4.zhimg.com/80/v2-22d902f8c869bc61c44c7711fa8e4e00.png)


## [0.2.2]

### 专栏管理

为了让创作者群体更好地创作，在发布文章的时候，用户可以直接选择发布至自己的专栏下：

![Image](https://pic4.zhimg.com/80/v2-b6358e6d673e5feb84dd0ad0bd4d52e4.png)

### 文章标题智能识别

文章标题无需手动输入，插件会自动检测文本的第一个一级头标签：

```
# 这是一个标题（必须只是一个#）
```

然后将其作为标题，改行的内容也不会进入到正文中，如果没有检测到，还需用户手动输入。

### 背景图片智能识别

插件会自动扫描文本第一个一级头标签之前的内容，将第一个发现的图片链接作为背景图片：

```
![Image](https://pic4.zhimg.com/80/v2-157583e100e9e181191d285355332ebf.png)
```
```
# 标题在这, 上面的链接会变成背景图片, 不会进入正文
```

### Html 支持

可以在正常的 Markdown 文本中插入 html 文本, 扩展了写作能力。

>绝大多数 html 标签为非法标签，包括 table 在内，会被服务端过滤掉，只有 \<p\>, \<div>, \<img> 等合法标签才会被服务端存储，具体使用时小伙伴们可以自己尝试。

### 增加 Zhihu: Is Title Image Full Screen 配置项

用户可以在设置中找到 `Zhihu: Is Title Image Full Screen` 配置项，勾选后，知乎文章的背景图片会变为全屏模式。

## [0.2.1]

### 可以查看点赞数，并给喜欢的内容点赞

![Image](https://pic4.zhimg.com/80/v2-d8f61703c731711fe3a3585122c0d676_hd.png)

点击按钮点赞。

### 显示作者头像，名字，个性签名

![Image](https://pic4.zhimg.com/80/v2-157583e100e9e181191d285355332ebf_hd.png)

点击头像，可以在浏览器打开该作者的个人主页。

### 修改文章

发布后的文章，按照和答案相同的方式，将文章的链接以形如：

```
#! https://zhuanlan.zhihu.com/p/107810342
```

复制至文章顶部，发布即可对原文章进行修改。

### 行内latex

现在创作的时候，可以直接用 `$\sqrt5$` 的方式写行内 latex, 而块latex还是原来的 `$$\sqrt$$` 语法。

### 优化了图标样式

![Image](https://pic4.zhimg.com/80/v2-b293132e3d47d8cd48394caf78611bd2_hd.png)

## [0.2.0] - 2020-02-17

### Webview 默认使用 VSCode 主题色

板块是透明的，会看起来像透明亚克力：

![](https://raw.githubusercontent.com/niudai/ImageHost/master/zhihu/2020-02-16-11-11-22.png)

>可以在 VSCode 的设置栏中找到 `Use VSTheme` 设置项，取消打勾后，会开启知乎默认的白蓝主题。

### 支持定时发布

所有的答案，文章发布时，均会多一次询问，用户须选择是稍后发布还是马上发布，如果选择稍后发布，需要输入发布的时间，比如 “5:30 pm”，"9:45 am" 等，目前仅支持当天的时间选择，输入后，你就会在个人中心的“安排”处看到你将发布的答案和发布的时间（需要手动点击刷新）：

![](https://raw.githubusercontent.com/niudai/ImageHost/master/zhihu/2020-02-16-11-20-14.png)

定时发布采用 prelog 技术，中途关闭 VSCode，关机不影响定时发布，只需保证发布时间 VSCode 处于打开状态 && 知乎插件激活状态即可。

时间到了之后，你会收到答案发布的通知，该事件也会从“安排”中移除。

如果想取消发布，则点击 ❌ 按钮即可：

![](https://raw.githubusercontent.com/niudai/ImageHost/master/zhihu/2020-02-16-15-56-31.png)

>发布事件采用 md5 完整性校验，不允许用户同时预发两篇内容一摸一样的答案或文章。

### 增加“分享”和“在浏览器打开”两个按钮

由于插件自身轻量的定位，Webview 的内容没有浏览器端更全面，而且为了保证大家可以更方便地将内容分享给其他人，增加了如下两个按钮：

![](https://raw.githubusercontent.com/niudai/ImageHost/master/zhihu/2020-02-16-15-29-09.png)

点击左侧按钮会在浏览器中打开该页面，点击中间的会将页面的链接复制至粘贴板中。

## [0.1.0] - 2020-02-10

### Added

- 二维码/账密登录
- 内容创作
- 内容发布
- 一键上传图片
- 个性推荐
- 实时热榜
- 搜索全站
- 收藏夹

### Changed

### Removed
