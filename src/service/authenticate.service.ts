import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as zhihuEncrypt from "zhihu-encrypt";
import * as cheerio from "cheerio";
import { DefaultHTTPHeader, LoginPostHeader, QRCodeOptionHeader, WeixinLoginHeader } from "../const/HTTP";
import { TemplatePath } from "../const/PATH";
import { CaptchaAPI, CaptchaV2API, LoginAPI, SMSAPI, QRCodeAPI, UDIDAPI, WeixinLoginPageAPI, WeixinLoginQRCodeAPI, WeixinState, WeixinLoginRedirectAPI, JianshuWeixinLoginRedirectAPI } from "../const/URL";
import { ILogin, ISmsData } from "../model/login.model";
import { FeedTreeViewProvider } from "../treeview/feed-treeview-provider";
import { LoginEnum, SettingEnum, JianshuLoginTypes } from "../const/ENUM";
import { getCookieJar } from "../global/cookie";
import { AccountService } from "./account.service";
import { HttpService, clearCookie, sendRequest } from "./http.service";
import { ProfileService } from "./profile.service";
import { WebviewService } from "./webview.service";
import { getExtensionPath } from "../global/globa-var";
import { Output } from "../global/logger";

var formurlencoded = require('form-urlencoded').default;
var QRCode = require('qrcode');

export class AuthenticateService {
	constructor(
		protected profileService: ProfileService,
		protected accountService: AccountService,
		protected feedTreeViewProvider: FeedTreeViewProvider,
		protected webviewService: WebviewService) {
	}
	public logout() {
		try {
			clearCookie();
			this.feedTreeViewProvider.refresh();
			// fs.writeFileSync(path.join(getExtensionPath(), 'cookie.txt'), '');
		} catch (error) {
			console.log(error);
		}
		vscode.window.showInformationMessage('注销成功！');
	}

	public async login() {
		if (await this.accountService.isAuthenticated()) {
			vscode.window.showInformationMessage(`你已经登录了哦~ ${this.profileService.name}`);
			return;
		}
		clearCookie();
		this.qrcodeLoginV2();
	}

	public async jianshuLogin() {
		const selectedLoginType: LoginEnum = await vscode.window.showQuickPick<vscode.QuickPickItem & { value: LoginEnum }>(
			JianshuLoginTypes.map(type => ({ value: type.value, label: type.ch, description: '' })),
			{ placeHolder: "选择登录方式: " }
		).then(item => item.value);

		if (selectedLoginType == LoginEnum.weixin) {
			this.jianshuWeixinLogin();
		}
	}

	public async passwordLogin() {
		let resp = await sendRequest({
			uri: CaptchaAPI,
			method: 'get',
			gzip: true,
			json: true
		});

		if (resp.show_captcha) {
			let captchaImg = await sendRequest({
				uri: CaptchaAPI,
				method: 'put',
				json: true,
				gzip: true
			});
			let base64Image = captchaImg['img_base64'].replace('\n', '');
			fs.writeFileSync(path.join(getExtensionPath(), './captcha.jpg'), base64Image, 'base64');
			const panel = vscode.window.createWebviewPanel("zhihu", "验证码", { viewColumn: vscode.ViewColumn.One, preserveFocus: true });
			const imgSrc = panel.webview.asWebviewUri(vscode.Uri.file(
				path.join(getExtensionPath(), './captcha.jpg')
			));

			this.webviewService.renderHtml({
				title: '验证码',
				showOptions: {
					viewColumn: vscode.ViewColumn.One,
					preserveFocus: true
				},
				pugTemplatePath: path.join(
					getExtensionPath(),
					TemplatePath,
					'captcha.pug'
				),
				pugObjects: {
					title: '验证码',
					captchaSrc: imgSrc.toString(),
					useVSTheme: vscode.workspace.getConfiguration('zhihu').get(SettingEnum.useVSTheme)
				}
			}, panel)

			do {
				var captcha: string | undefined = await vscode.window.showInputBox({
					prompt: "输入验证码",
					placeHolder: "",
					ignoreFocusOut: true
				});
				if (!captcha) return
				let headers = DefaultHTTPHeader;
				headers['cookie'] = fs.readFileSync
				resp = await sendRequest({
					method: 'POST',
					uri: CaptchaAPI,
					form: {
						input_text: captcha
					},
					json: true,
					simple: false,
					gzip: true,
					resolveWithFullResponse: true,
				});
				if (resp.statusCode != 201) {
					vscode.window.showWarningMessage('请输入正确的验证码')
				}
			} while (resp.statusCode != 201);
			Output('验证码正确。', 'info')
			panel.dispose()
		}

		const phoneNumber: string | undefined = await vscode.window.showInputBox({
			ignoreFocusOut: true,
			prompt: "输入手机号或邮箱",
			placeHolder: "",
		});
		if (!phoneNumber) return;

		const password: string | undefined = await vscode.window.showInputBox({
			ignoreFocusOut: true,
			prompt: "输入密码",
			placeHolder: "",
			password: true
		});
		if (!password) return

		let loginData: ILogin = {
			'client_id': 'c3cef7c66a1843f8b3a9e6a1e3160e20',
			'grant_type': 'password',
			'source': 'com.zhihu.web',
			'username': '+86' + phoneNumber,
			'password': password,
			'lang': 'en',
			'ref_source': 'homepage',
			'utm_source': '',
			'captcha': captcha,
			'timestamp': Math.round(new Date().getTime()),
			'signature': ''
		};

		loginData.signature = crypto.createHmac('sha1', 'd1b964811afb40118a12068ff74a12f4')
			// .update(loginData.grant_type + loginData.client_id + loginData.source + loginData.timestamp.toString())
			.update("password" + loginData.client_id + loginData.source + loginData.timestamp.toString())
			.digest('hex');

		let encryptedFormData = zhihuEncrypt.loginEncrypt(formurlencoded(loginData));

		var loginResp = await sendRequest(
			{
				uri: LoginAPI,
				method: 'post',
				body: encryptedFormData,
				gzip: true,
				resolveWithFullResponse: true,
				simple: false,
				headers: LoginPostHeader
			});

		this.profileService.fetchProfile().then(() => {
			if (loginResp.statusCode == '201') {
				Output(`你好，${this.profileService.name}`, 'info');
				this.feedTreeViewProvider.refresh();
			} else if (loginResp.statusCode == '401') {
				Output('密码错误！' + loginResp.statusCode, 'warn');
			} else {
				Output('登录失败！错误代码' + loginResp.statusCode, 'warn');
			}
		})
	}

	public async smsLogin() {
		await sendRequest({
			uri: 'https://www.zhihu.com/signin'
		})
		const phoneNumber: string | undefined = await vscode.window.showInputBox({
			ignoreFocusOut: true,
			prompt: "输入手机号或邮箱",
			placeHolder: "",
		});
		if (!phoneNumber) {
			return;
		}
		let smsData: ISmsData = {
			phone_no: '+86' + phoneNumber,
			sms_type: 'text'
		};

		let encryptedFormData = zhihuEncrypt.smsEncrypt(formurlencoded(smsData));

		// phone_no%3D%252B8618324748963%26sms_type%3Dtext
		var loginResp = await sendRequest(
			{
				uri: SMSAPI,
				method: 'post',
				body: encryptedFormData,
				gzip: true,
				resolveWithFullResponse: true,
				simple: false,
				json: true
			});
		console.log(loginResp);
		const smsCaptcha: string | undefined = await vscode.window.showInputBox({
			ignoreFocusOut: true,
			prompt: "输入短信验证码：",
			placeHolder: "",
		});
	}

	public async qrcodeLogin() {
		await sendRequest({
			uri: UDIDAPI,
			method: 'post'
		});
		let resp = await sendRequest({
			uri: QRCodeAPI,
			method: 'post',
			json: true,
			gzip: true,
			header: QRCodeOptionHeader
		});
		let qrcode = await sendRequest({
			uri: `${QRCodeAPI}/${resp.token}/image`,
			encoding: null
		});
		fs.writeFileSync(path.join(getExtensionPath(), 'qrcode.png'), qrcode);
		const panel = vscode.window.createWebviewPanel("zhihu", "验证码", { viewColumn: vscode.ViewColumn.One, preserveFocus: true });
		const imgSrc = panel.webview.asWebviewUri(vscode.Uri.file(
			path.join(getExtensionPath(), './qrcode.png')
		))
		this.webviewService.renderHtml(
			{
				title: '二维码',
				showOptions: {
					viewColumn: vscode.ViewColumn.One,
					preserveFocus: true
				},
				pugTemplatePath: path.join(
					getExtensionPath(),
					TemplatePath,
					'qrcode.pug'
				),
				pugObjects: {
					title: '打开知乎 APP 扫一扫',
					qrcodeSrc: imgSrc.toString(),
					useVSTheme: vscode.workspace.getConfiguration('zhihu').get(SettingEnum.useVSTheme)
				}
			},
			panel
		);
		let intervalId = setInterval(() => {
			sendRequest({
				uri: `${QRCodeAPI}/${resp.token}/scan_info`,
				json: true,
				gzip: true
			}).then(
				r => {
					if (r.status == 1) {
						vscode.window.showInformationMessage('请在手机上确认登录！');
					} else if (r.user_id) {
						clearInterval(intervalId);
						panel.dispose();
						this.profileService.fetchProfile().then(() => {
							vscode.window.showInformationMessage(`你好，${this.profileService.name}`);
							this.feedTreeViewProvider.refresh();
						})
					}
				}
			);
		}, 1000)
		panel.onDidDispose(() => {
			console.log('Window is disposed')
			clearInterval(intervalId)
		})
	}

	public async qrcodeLoginV2() {
		await this.prefetchQrcodeLoginContext();
		const qrcodeResp = await sendRequest({
			uri: QRCodeAPI,
			method: 'post',
			body: {},
			json: true,
			gzip: true,
			resolveWithFullResponse: true,
			simple: false,
			headers: this.createZhihuLoginHeaders('https://www.zhihu.com/signin')
		});
		const resp = qrcodeResp && qrcodeResp.body ? qrcodeResp.body : qrcodeResp;
		if (resp && !resp.token && resp.qrcode_token) {
			resp.token = resp.qrcode_token;
		}
		if (!resp || !resp.token || !resp.link) {
			Output(`二维码请求失败：status=${qrcodeResp && qrcodeResp.statusCode}, body=${JSON.stringify(resp)}`, 'warn');
			vscode.window.showWarningMessage('二维码获取失败，请稍后重试。');
			return;
		}

		const qrcodeSrc = await QRCode.toDataURL(resp.link, {
			margin: 1,
			width: 360
		});
		const panel = vscode.window.createWebviewPanel("zhihu", "二维码登录", { viewColumn: vscode.ViewColumn.One, preserveFocus: true });
		this.webviewService.renderHtml(
			{
				title: '二维码登录',
				showOptions: {
					viewColumn: vscode.ViewColumn.One,
					preserveFocus: true
				},
				pugTemplatePath: path.join(
					getExtensionPath(),
					TemplatePath,
					'qrcode.pug'
				),
				pugObjects: {
					title: '打开知乎 APP 扫一扫',
					qrcodeSrc,
					useVSTheme: vscode.workspace.getConfiguration('zhihu').get(SettingEnum.useVSTheme)
				}
			},
			panel
		);

		Output(`二维码已就绪：token=${resp.token}`);
		let hasPromptedConfirm = false;
		let hasPromptedRiskControl = false;
		let isPolling = false;
		let hasFinished = false;
		const deadline = Date.now() + 120000;
		const intervalId = setInterval(() => undefined, 1000)
		const pollLogin = async () => {
			Output(`二维码轮询开始：token=${resp.token}`);
			if (Date.now() > deadline) {
				hasFinished = true;
				clearInterval(intervalId);
				panel.dispose();
				vscode.window.showWarningMessage('二维码已过期，请重新登录。');
				return;
			}
			try {
				const scanResp = await sendRequest({
					uri: `${QRCodeAPI}/${resp.token}/scan_info`,
					json: true,
					gzip: true,
					resolveWithFullResponse: true,
					headers: this.createZhihuLoginHeaders('https://www.zhihu.com/signin?next=%2F', true)
				});
				const scanInfo = scanResp && scanResp.body ? scanResp.body : scanResp;
				this.syncCookiesFromResponse(scanResp);
				this.syncCookiesFromScanInfo(scanInfo);
				Output(`二维码扫码轮询：status=${scanResp && scanResp.statusCode}, body=${JSON.stringify(scanInfo)}, cookies=${this.getCurrentZhihuCookies()}`);
				if (this.isRiskControlResponse(scanResp, scanInfo)) {
					const redirect = this.getRiskControlRedirect(scanInfo);
					if (!hasPromptedRiskControl) {
						hasPromptedRiskControl = true;
						const action = redirect ? '打开验证' : undefined;
						const selected = await vscode.window.showWarningMessage(
							'知乎需要进行网络环境验证，完成后扩展会继续等待扫码结果。',
							...(action ? [action] : [])
						);
						if (selected == action && redirect) {
							await vscode.env.openExternal(vscode.Uri.parse(redirect));
						}
					}
					await new Promise(resolve => setTimeout(resolve, 1500));
					return pollLogin();
				}
				if (scanInfo && scanInfo.status == 1 && !hasPromptedConfirm) {
					hasPromptedConfirm = true;
					vscode.window.showInformationMessage('请在知乎 APP 上确认登录！');
				}
				if (!this.isQrcodeLoginSuccessful(scanInfo) && !this.hasZhihuCookie('z_c0')) {
					await new Promise(resolve => setTimeout(resolve, 500));
					return pollLogin();
				}
				if (!this.hasZhihuCookie('z_c0')) {
					const meResp = await sendRequest({
						uri: 'https://www.zhihu.com/api/v4/me',
						json: true,
						gzip: true,
						resolveWithFullResponse: true,
						simple: false,
						headers: this.createZhihuLoginHeaders('https://www.zhihu.com/signin?next=%2F', true)
					});
					this.syncCookiesFromResponse(meResp);
					const meBody = meResp && meResp.body ? meResp.body : meResp;
					Output(`二维码登录校验：status=${meResp && meResp.statusCode}, body=${JSON.stringify(meBody)}, cookies=${this.getCurrentZhihuCookies()}`);
				}
				if (!this.hasZhihuCookie('z_c0')) {
					await new Promise(resolve => setTimeout(resolve, 500));
					return pollLogin();
				}
				hasFinished = true;
				clearInterval(intervalId);
				panel.dispose();
				await this.profileService.fetchProfile();
				vscode.window.showInformationMessage(`你好，${this.profileService.name || '知乎用户'}`);
				this.feedTreeViewProvider.refresh();
			} catch (error) {
				Output(`二维码扫码异常：${error && error.stack ? error.stack : error}`, 'warn');
			}
			await new Promise(resolve => setTimeout(resolve, 500));
			if (!hasFinished) {
				return pollLogin();
			}
		}
		pollLogin();
		panel.onDidDispose(() => {
			hasFinished = true;
			clearInterval(intervalId)
		})
	}

	private async prefetchQrcodeLoginContext() {
		await sendRequest({
			uri: 'https://www.zhihu.com/signin?next=%2F',
			gzip: true,
			headers: {
				...DefaultHTTPHeader,
				Referer: 'https://www.zhihu.com/'
			}
		});
		try {
			await sendRequest({
				uri: UDIDAPI,
				method: 'post',
				body: {},
				json: true,
				gzip: true,
				headers: this.createZhihuLoginHeaders('https://www.zhihu.com/signin')
			});
		} catch (error) {
			console.log(error);
		}
		try {
			await sendRequest({
				uri: CaptchaV2API,
				method: 'get',
				json: true,
				gzip: true,
				simple: false,
				headers: this.createZhihuLoginHeaders('https://www.zhihu.com/signin')
			});
		} catch (error) {
			console.log(error);
		}
	}

	private createZhihuLoginHeaders(referer: string, isPolling: boolean = false) {
		const headers: any = {
			...DefaultHTTPHeader,
			...QRCodeOptionHeader,
			Referer: referer,
			Origin: 'https://www.zhihu.com',
			'x-requested-with': 'fetch',
			'content-type': 'application/json;charset=UTF-8'
		};
		if (isPolling) {
			headers['Accept'] = '*/*';
			headers['sec-fetch-dest'] = 'empty';
			headers['sec-fetch-mode'] = 'cors';
			headers['sec-fetch-site'] = 'same-origin';
			headers['x-zse-93'] = '101_3_3.0';
		}
		const xsrfToken = this.getZhihuCookieValue('_xsrf');
		if (xsrfToken) {
			headers['x-xsrftoken'] = xsrfToken;
		}
		return headers;
	}

	private getZhihuCookieValue(cookieName: string): string {
		try {
			const cookieString = getCookieJar().getCookieStringSync('https://www.zhihu.com');
			if (!cookieString) {
				return undefined;
			}
			const matchedCookie = cookieString
				.split(';')
				.map(item => item.trim())
				.find(item => item.startsWith(`${cookieName}=`));
			return matchedCookie ? matchedCookie.substring(cookieName.length + 1) : undefined;
		} catch (error) {
			return undefined;
		}
	}

	private hasZhihuCookie(cookieName: string): boolean {
		return !!this.getZhihuCookieValue(cookieName);
	}

	private getCurrentZhihuCookies(): string {
		try {
			return getCookieJar().getCookieStringSync('https://www.zhihu.com');
		} catch (error) {
			return '';
		}
	}

	private syncCookiesFromResponse(response: any) {
		if (!response || !response.headers || !response.headers['set-cookie']) {
			return;
		}
		const cookieJar = getCookieJar();
		(response.headers['set-cookie'] as string[])
			.filter(item => !!item)
			.forEach(item => {
				try {
					cookieJar.setCookieSync(item, 'https://www.zhihu.com');
				} catch (error) {
					console.log(error);
				}
			});
	}

	private syncCookiesFromScanInfo(scanInfo: any) {
		if (!scanInfo) {
			return;
		}
		const cookieJar = getCookieJar();
		const skipCookieAttributes = new Set(['Domain', 'Path', 'Expires', 'Max-Age', 'HttpOnly', 'Secure', 'SameSite']);
		const rawCookie = [scanInfo.cookie, scanInfo.cookies]
			.filter(item => typeof item == 'string')
			.join(';');
		rawCookie
			.split(';')
			.map(item => item.trim())
			.filter(item => item.includes('='))
			.forEach(item => {
				const [name, ...valueParts] = item.split('=');
				if (!name || skipCookieAttributes.has(name)) {
					return;
				}
				const value = valueParts.join('=').trim();
				if (!value) {
					return;
				}
				cookieJar.setCookieSync(`${name}=${value}; Domain=.zhihu.com; Path=/`, 'https://www.zhihu.com');
			});
		if (scanInfo.z_c0) {
			cookieJar.setCookieSync(`z_c0=${scanInfo.z_c0}; Domain=.zhihu.com; Path=/`, 'https://www.zhihu.com');
		}
	}

	private isQrcodeLoginSuccessful(scanInfo: any): boolean {
		if (!scanInfo) {
			return false;
		}
		if (scanInfo.user_id != undefined || scanInfo.access_token || scanInfo.success === true || scanInfo.logged_in === true) {
			return true;
		}
		const loginStatus = (scanInfo.login_status || '').toString().toUpperCase();
		return ['CONFIRMED', 'LOGIN_SUCCESS', 'SUCCESS', 'OK', 'LOGGED_IN'].includes(loginStatus);
	}

	private isRiskControlResponse(response: any, scanInfo: any): boolean {
		const errorBody = scanInfo && scanInfo.error ? scanInfo.error : undefined;
		return !!(
			response
			&& response.statusCode == 403
			&& errorBody
			&& (errorBody.code == 40352 || errorBody.need_login === true)
		);
	}

	private getRiskControlRedirect(scanInfo: any): string {
		if (!scanInfo || !scanInfo.error || !scanInfo.error.redirect) {
			return undefined;
		}
		return scanInfo.error.redirect;
	}

	public async weixinLogin() {
		await sendRequest({
			uri: 'https://www.zhihu.com/signin?next=%2F',
		});
		let uri = WeixinLoginRedirectAPI();
		let prefetch = await sendRequest({
			uri,
			gzip: true,
			followRedirect: false,
			followAllRedirects: false,
			resolveWithFullResponse: true
		})
		uri = prefetch.headers['location'];
		let html = await sendRequest({
			uri,
			gzip: true
		})
		var reg = /state=(\w+)/g;
		const state = uri.match(reg)[0].replace(reg, '$1');
		const $ = cheerio.load(html)
		const panel = vscode.window.createWebviewPanel("zhihu", "微信登录", { viewColumn: vscode.ViewColumn.One, preserveFocus: true });
		const imgSrc = WeixinLoginQRCodeAPI($('img')[0].attribs['src']);
		const uuid = imgSrc.match(/\/connect\/qrcode\/([\w\d]*)/)[1];
		this.webviewService.renderHtml(
			{
				title: '二维码',
				showOptions: {
					viewColumn: vscode.ViewColumn.One,
					preserveFocus: true
				},
				pugTemplatePath: path.join(
					getExtensionPath(),
					TemplatePath,
					'qrcode.pug'
				),
				pugObjects: {
					title: '打开微信 APP 扫一扫',
					qrcodeSrc: imgSrc,
					useVSTheme: vscode.workspace.getConfiguration('zhihu').get(SettingEnum.useVSTheme)
				}
			},
			panel
		);

		var p = "https://lp.open.weixin.qq.com";

		var intervalId = setInterval(() => {
			this.weixinPolling(p, uuid, panel, state).then(r => {
				if (r == true) {
					clearInterval(intervalId);
					panel.dispose()
				}
			})

		}, 1000)

		panel.onDidDispose(l => {
			clearInterval(intervalId);
		})

		// this.weixinPolling(p, uuid, panel, state);
	}

	public async jianshuWeixinLogin() {
		let uri = JianshuWeixinLoginRedirectAPI();
		let prefetch = await sendRequest({
			uri,
			gzip: true,
			followRedirect: false,
			followAllRedirects: false,
			resolveWithFullResponse: true
		})
		uri = prefetch.headers['location'];
		let html = await sendRequest({
			uri,
			gzip: true
		})
		var reg = /state=([\w%]+)/g;
		const state = uri.match(reg)[0].replace(reg, '$1');
		const $ = cheerio.load(html)
		const panel = vscode.window.createWebviewPanel("zhihu", "微信登录", { viewColumn: vscode.ViewColumn.One, preserveFocus: true });
		const imgSrc = WeixinLoginQRCodeAPI($('img')[0].attribs['src']);
		const uuid = imgSrc.match(/\/connect\/qrcode\/([\w\d]*)/)[1];
		this.webviewService.renderHtml(
			{
				title: '二维码',
				showOptions: {
					viewColumn: vscode.ViewColumn.One,
					preserveFocus: true
				},
				pugTemplatePath: path.join(
					getExtensionPath(),
					TemplatePath,
					'qrcode.pug'
				),
				pugObjects: {
					title: '打开微信 APP 扫一扫',
					qrcodeSrc: imgSrc,
					useVSTheme: vscode.workspace.getConfiguration('zhihu').get(SettingEnum.useVSTheme)
				}
			},
			panel
		);

		var p = "https://lp.open.weixin.qq.com";

		var intervalId = setInterval(() => {
			this.jianshuWeixinPolling(p, uuid, panel, state).then(r => {
				if (r == true) {
					clearInterval(intervalId);
					panel.dispose()
				}
			})

		}, 1000)

		panel.onDidDispose(l => {
			clearInterval(intervalId)
			panel.dispose()
		})

	}

	private async weixinPolling(p: string, uuid: string, panel: vscode.WebviewPanel, state: string): Promise<boolean> {
		let weixinResp = await sendRequest({
			uri: p + `/connect/l/qrconnect?uuid=${uuid}`,
			timeout: 6e4,
			resolveWithFullResponse: true,
			headers: WeixinLoginHeader(WeixinLoginPageAPI())
		});
		let wx_errcode = ""
		let wx_code = ""

		// if (weixinResp.body && weixinResp.body.length > 0) {
			wx_errcode = weixinResp.body.match(/window\.wx_errcode=(\d+)/)[1];
			wx_code = weixinResp.body.match(/window\.wx_code='(.*)'/)[1];
		// }
		var g = parseInt(wx_errcode);
		switch (g) {
			case 405:
				var h = "https://www.zhihu.com/oauth/callback/wechat?action=login&amp;from=";
				h = h.replace(/&amp;/g, "&"),
					h += (h.indexOf("?") > -1 ? "&" : "?") + "code=" + wx_code + `&state=${state}`;
				let r = await sendRequest({
					uri: h,
					resolveWithFullResponse: true,
					// gzip: true,
					headers: WeixinLoginHeader(WeixinLoginPageAPI())
				})
				this.profileService.fetchProfile().then(() => {
					Output(`你好，${this.profileService.name}`, 'info');
					this.feedTreeViewProvider.refresh();
				});
				panel.onDidDispose(() => {
					console.log('Window is disposed');
				});
				return Promise.resolve(true);
				break;
			case undefined:
				this.weixinPolling(p, uuid, panel, state)
				return Promise.resolve(false);
			default:
				Output('请在微信上扫码， 点击确认！', 'info');
					return Promise.resolve(false);
				// this.weixinPolling(p, uuid, panel, state)
		}
	}

	private async jianshuWeixinPolling(p: string, uuid: string, panel: vscode.WebviewPanel, state: string): Promise<boolean> {
		let weixinResp = await sendRequest({
			uri: p + `/connect/l/qrconnect?uuid=${uuid}`,
			timeout: 6e4,
			resolveWithFullResponse: true,
			headers: WeixinLoginHeader(WeixinLoginPageAPI())
		});
		let wx_code = ""
		let wx_errcode = ""
		if (weixinResp.body && weixinResp.body.length > 0) {
			wx_errcode = weixinResp.body.match(/window\.wx_errcode=(\d+)/)[1];
			wx_code = weixinResp.body.match(/window\.wx_code='(.*)'/)[1];
		}
		var g = parseInt(wx_errcode);
		switch (g) {
			// "https://open.weixin.qq.com/connect/qrconnect?appid=wxe9199d568fe57fdd&client_id=wxe9199d568fe57fdd&redirect_uri=http%3A%2F%2Fwww.jianshu.com%2Fusers%2Fauth%2Fwechat%2Fcallback&response_type=code&scope=snsapi_login&state=%257B%257D"
			case 405:
				var h = "http://www.jianshu.com/users/auth/wechat/callback";
				// "http://www.jianshu.com/users/auth/wechat/callback?code=021jPsAa1isZkM1Z5zza1turAa1jPsAi&state=%7B%7D"
				h = h.replace(/&amp;/g, "&"),
					h += (h.indexOf("?") > -1 ? "&" : "?") + "code=" + wx_code + `&state=${state}`;
				let r = await sendRequest({
					uri: h,
					resolveWithFullResponse: true,
					gzip: true,
					// headers: WeixinLoginHeader(WeixinLoginPageAPI())
				})
				// request twice, don't know why, but jianshu does this way.
				r = await sendRequest({
					uri: h,
					resolveWithFullResponse: true,
					gzip: true,
					// headers: WeixinLoginHeader(WeixinLoginPageAPI())
				})
				this.profileService.fetchProfile().then(() => {
					Output(`你好，简书登录成功`, 'info');
					this.feedTreeViewProvider.refresh();
				});
				panel.onDidDispose(() => {
					console.log('Window is disposed');
				});
				return Promise.resolve(true);
				break;
			case undefined:
				// this.weixinPolling(p, uuid, panel, state)
				return Promise.resolve(false);
			default:
				Output('请在微信上扫码， 点击确认！', 'info');
					return Promise.resolve(false);
				// this.weixinPolling(p, uuid, panel, state)
		}
	}
}


