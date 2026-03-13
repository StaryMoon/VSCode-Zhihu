import { getStorageFilePath } from "./globa-var";
import * as FileCookieStore from "tough-cookie-filestore";
import { CookieJar, Store } from "tough-cookie";
import { existsSync, readFileSync, writeFileSync } from "fs";

var store: Store;
var cookieJar: CookieJar;

export function getCookieStore() {
    loadCookie()
    return store
}

export function clearCookieStore() {
    writeFileSync(getStorageFilePath('cookie.json'), '{}');
}

export function getCookieJar() {
    loadCookie()
    return cookieJar
}

export function getRawCookieHeader(): string {
    const cookiePath = getStorageFilePath('cookie.json');
    if (!existsSync(cookiePath)) {
        return '';
    }
    try {
        const cookies = JSON.parse(readFileSync(cookiePath, 'utf8'));
        const parts = [];
        for (const domain of Object.keys(cookies)) {
            for (const pathKey of Object.keys(cookies[domain] || {})) {
                for (const name of Object.keys(cookies[domain][pathKey] || {})) {
                    const cookie = cookies[domain][pathKey][name];
                    if (cookie && cookie.key && typeof cookie.value !== 'undefined') {
                        parts.push(`${cookie.key}=${cookie.value}`);
                    }
                }
            }
        }
        return [...new Set(parts)].join('; ');
    } catch (error) {
        return '';
    }
}

function loadCookie() {
    const cookiePath = getStorageFilePath('cookie.json');
    if (!existsSync(cookiePath)) {
        writeFileSync(cookiePath, '{}');
    }
    if (!store) {
        store = new FileCookieStore(cookiePath);    
    }
    if (!cookieJar) {
        cookieJar = new CookieJar(store);
    }
}
