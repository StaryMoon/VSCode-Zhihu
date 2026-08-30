export const QuestionPathReg = /^\/question\/(\d+)$/i

export const QuestionAnswerPathReg = /(^\/question\/(\d+))?\/answer\/(\d+)$/i

export const ArticlePathReg = /^\/p\/(\d+)\/?$/i

/**
 * Match zhihu image-host urls so editing an existing article does not
 * re-upload pictures that already live on zhihu's CDN.
 * Covers `pic*.zhimg.com`, any `*.zhimg.com` host and `*.zhihu.com`
 * (e.g. `pic1.zhimg.com`, `picx.zhimg.com`, `zhuanlan.zhihu.com`).
 */
export const ZhihuPicReg = /^https?:\/\/(?:[\w-]+\.)*(?:zhimg\.com|zhihu\.com)(?:\/|$)/i
