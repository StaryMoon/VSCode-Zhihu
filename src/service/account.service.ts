import { getCookieJar } from "../global/cookie";
import { SelfProfileAPI } from "../const/URL";
import { IProfile } from "../model/target/target";
import { sendRequest } from "./http.service";

export class AccountService {
	public profile: IProfile;

	constructor () {}

	async fetchProfile() {
		this.profile  = await sendRequest({
			uri: SelfProfileAPI,
			json: true
		});
	}

	async isAuthenticated(): Promise<boolean> {
		const cookieString = this.getZhihuCookieString();
		if (!cookieString || !cookieString.includes('z_c0=')) {
			return false;
		}

		try {
			const checkIfSignedIn = await sendRequest({
				uri: SelfProfileAPI,
				json: true,
				resolveWithFullResponse: true,
				gzip: true,
				simple: false
			});
			if (!checkIfSignedIn || checkIfSignedIn.statusCode != 200) {
				return false;
			}
			const profile = checkIfSignedIn.body;
			return !!(profile && profile.id && profile.url_token);
		} catch (err) {
			console.error('Http error', err);
			return false;
		}
	}

	private getZhihuCookieString(): string {
		try {
			return getCookieJar().getCookieStringSync('https://www.zhihu.com');
		} catch (error) {
			console.error('Cookie error', error);
			return '';
		}
	}
}
