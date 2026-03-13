import { ITarget } from "../target/target";

export interface IArticle extends ITarget {
    title: string,
    excerpt_title: "",
    image_url: "",
    title_image: "",
    excerpt: string,
    content: string,
    voteup_count?: number,
    comment_count?: number,
    favlists_count?: number,
    thanks_count?: number,
}
