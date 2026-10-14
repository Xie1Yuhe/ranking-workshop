/**
 * 从夯到拉 · 排名工坊 —— 桌面版本地服务
 *
 * 纯 Node.js 标准库实现，零第三方依赖。
 *   1. 托管 web/ 下的界面资源
 *   2. 提供榜单数据读写接口（data/state.json）
 *   3. 首次启动用 data/seed.json 初始化（默认是一份空榜单）
 *   4. 用 Edge / Chrome 的应用模式打开一个无地址栏窗口
 *   5. 窗口关闭后自动退出；重复启动时直接唤起已有窗口
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.resolve(process.env.RANKING_WEB_DIR || path.join(ROOT, 'web'));
const DATA_DIR = path.resolve(process.env.RANKING_DATA_DIR || path.join(ROOT, 'data'));
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const SEED_FILE = path.join(DATA_DIR, 'seed.json');
const LOG_FILE = path.join(DATA_DIR, 'error.log');

const BASE_PORT = Number(process.env.RANKING_PORT || 7791);
const NO_BROWSER = process.env.RANKING_NO_BROWSER === '1';
const MAX_BODY = 200 * 1024 * 1024; // 榜单可能内嵌大量 base64 图片

function logToFile(error) {
    try {
        const line = '[' + new Date().toISOString() + '] ' + (error && error.stack ? error.stack : String(error)) + '\n';
        fs.appendFileSync(LOG_FILE, line, 'utf8');
    } catch (_) {
        /* 忽略日志写入失败 */
    }
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJsonFile(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        return null;
    }
}

function writeJsonFileAtomic(file, data) {
    ensureDir(path.dirname(file));
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, file);
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, status, payload) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store'
    });
    res.end(body);
}

function sendText(res, status, text) {
    const body = Buffer.from(text, 'utf8');
    res.writeHead(status, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store'
    });
    res.end(body);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_BODY) {
                reject(new Error('请求体过大'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

/* ------------------------------------------------------------------ */
/* 状态读写                                                            */
/* ------------------------------------------------------------------ */

const EMPTY_STATE = {
    version: 3,
    boardTitle: '从夯到拉 · 排名工坊',
    settings: {},
    tiers: [],
    images: []
};

function bootstrapState() {
    ensureDir(DATA_DIR);
    if (fs.existsSync(STATE_FILE)) return;
    const seed = readJsonFile(SEED_FILE);
    writeJsonFileAtomic(STATE_FILE, seed || EMPTY_STATE);
}

function loadState() {
    bootstrapState();
    const state = readJsonFile(STATE_FILE);
    if (!state || typeof state !== 'object') return JSON.parse(JSON.stringify(EMPTY_STATE));
    if (!Array.isArray(state.images)) state.images = [];
    if (!Array.isArray(state.tiers)) state.tiers = [];
    return state;
}

/* ------------------------------------------------------------------ */
/* 静态资源                                                            */
/* ------------------------------------------------------------------ */

function serveStatic(req, res, urlPath) {
    let relative = decodeURIComponent(urlPath);
    if (relative === '/' || relative === '') relative = '/index.html';

    const target = path.join(WEB_DIR, path.normalize(relative).replace(/^([/\\])+/, ''));
    if (!target.startsWith(WEB_DIR)) {
        sendText(res, 403, '禁止访问');
        return;
    }

    fs.stat(target, (error, stat) => {
        if (error || !stat.isFile()) {
            sendText(res, 404, '未找到资源：' + relative);
            return;
        }
        const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, {
            'Content-Type': type,
            'Content-Length': stat.size,
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            Pragma: 'no-cache',
            Expires: '0'
        });
        fs.createReadStream(target).pipe(res);
    });
}

/* ------------------------------------------------------------------ */
/* HTTP 服务                                                           */
/* ------------------------------------------------------------------ */

let shuttingDown = false;

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname;

    try {
        if (pathname === '/api/state') {
            if (req.method === 'GET') {
                sendJson(res, 200, loadState());
                return;
            }
            if (req.method === 'PUT' || req.method === 'POST') {
                const raw = await readBody(req);
                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.images)) {
                    sendJson(res, 400, { ok: false, error: '数据结构不正确' });
                    return;
                }
                writeJsonFileAtomic(STATE_FILE, parsed);
                sendJson(res, 200, { ok: true, savedAt: Date.now(), images: parsed.images.length });
                return;
            }
            sendJson(res, 405, { ok: false, error: '不支持的请求方法' });
            return;
        }

        if (pathname === '/api/info') {
            sendJson(res, 200, {
                ok: true,
                app: '从夯到拉 · 排名工坊',
                version: '3.0',
                dataFile: STATE_FILE,
                port: actualPort,
                node: process.version,
                platform: os.platform()
            });
            return;
        }

        if (pathname === '/api/seed') {
            sendJson(res, 200, readJsonFile(SEED_FILE) || EMPTY_STATE);
            return;
        }

        if (pathname === '/api/ping') {
            sendJson(res, 200, { ok: true, time: Date.now() });
            return;
        }

        if (pathname === '/api/quit' && req.method === 'POST') {
            sendJson(res, 200, { ok: true });
            setTimeout(() => shutdown('界面请求退出'), 120);
            return;
        }

        if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendJson(res, 405, { ok: false, error: '不支持的请求方法' });
            return;
        }

        serveStatic(req, res, pathname);
    } catch (error) {
        logToFile(error);
        sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) });
    }
});

/* ------------------------------------------------------------------ */
/* 浏览器窗口                                                          */
/* ------------------------------------------------------------------ */

function findBrowser() {
    const candidates = [
        path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(process.env['LOCALAPPDATA'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['LOCALAPPDATA'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ];
    for (const item of candidates) {
        try {
            if (item && fs.existsSync(item)) return item;
        } catch (_) {
            /* 忽略 */
        }
    }
    return null;
}

function launchWindow(url) {
    const browser = findBrowser();
    if (!browser || NO_BROWSER) {
        console.log('');
        console.log('  未找到 Edge / Chrome，请在浏览器中打开：' + url);
        console.log('');
        return null;
    }

    const profileDir = path.join(DATA_DIR, 'window-profile');
    const args = [
        '--app=' + url,
        '--user-data-dir=' + profileDir,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=Translate,msEdgeSplitScreen,msEdgeSidebar',
        '--window-size=1500,980',
        '--window-position=90,60'
    ];

    const child = spawn(browser, args, { detached: false, stdio: 'ignore' });
    child.on('exit', () => {
        setTimeout(() => shutdown('窗口已关闭'), 2000);
    });
    child.on('error', error => {
        logToFile(error);
        console.log('  启动窗口失败：' + error.message);
    });
    return child;
}

/* ------------------------------------------------------------------ */
/* 生命周期                                                            */
/* ------------------------------------------------------------------ */

let actualPort = BASE_PORT;

function shutdown(reason) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('  ' + reason + '，正在退出…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1200);
}

function listen(port) {
    if (server.listening) return;

    server.once('error', error => {
        if (error.code === 'EADDRINUSE') {
            console.error('');
            console.error('  端口 ' + port + ' 已被占用，无法启动。');
            console.error('  可以换一个端口后重试，例如：');
            console.error('      set RANKING_PORT=7800');
            console.error('      启动程序.cmd');
            console.error('');
            process.exit(1);
            return;
        }
        logToFile(error);
        console.error('  启动失败：' + error.message);
        process.exit(1);
    });

    server.listen(port, '127.0.0.1', () => {
        actualPort = port;
        const url = 'http://127.0.0.1:' + port + '/';
        bootstrapState();
        console.log('');
        console.log('  从夯到拉 · 排名工坊（桌面版）已启动');
        console.log('  地址：' + url);
        console.log('  数据：' + STATE_FILE);
        console.log('');
        if (!NO_BROWSER) launchWindow(url);
    });
}

/* 已经在运行的话，直接把窗口唤起来 */
function probeRunning(port, done) {
    const req = http.get({ host: '127.0.0.1', port: port, path: '/api/info', timeout: 900 }, res => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => done(body.indexOf('从夯到拉') >= 0));
    });
    req.on('error', () => done(false));
    req.on('timeout', () => { req.destroy(); done(false); });
}

probeRunning(BASE_PORT, running => {
    if (running) {
        const url = 'http://127.0.0.1:' + BASE_PORT + '/';
        console.log('  检测到程序已在运行，直接打开窗口：' + url);
        if (!NO_BROWSER) launchWindow(url);
        setTimeout(() => process.exit(0), 1500);
        return;
    }
    listen(BASE_PORT);
});

process.on('SIGINT', () => shutdown('收到中断信号'));
process.on('uncaughtException', error => {
    logToFile(error);
    console.error(error);
});
