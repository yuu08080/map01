// ===================================================================
// マップ初期化
// ===================================================================
const map = L.map('map', {
    maxZoom: 21,
    minZoom: 11,
    zoomControl: false,
    maxBounds: [[35.60, 139.70], [36.08, 140.25]],
    maxBoundsViscosity: 1.0,
    // ズームを細かい単位で行えるようにする（＋ボタン／ホイール1回あたりの拡大率を抑える）
    zoomSnap: 0.8,
    zoomDelta: 0.8,
    // ホイール1notchあたりに必要なスクロール量を増やし、慣性スクロールで一気に拡大されすぎるのを防ぐ
    wheelPxPerZoomLevel: 120
}).setView([35.8500, 140.0000], 12);

L.control.zoom({ position: 'topright' }).addTo(map);

// === タイルレイヤー（CartoDB Positron・淡色シンプルマップ） ===
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 21,
    maxNativeZoom: 19
}).addTo(map);

// ===================================================================
// 重なり順（Pane）の明示的な階層化
// 上から: ラーメン店ピン(shopPane) > 駅ピン(stationPane) > 路線（basePane、タイルの直上）
// ===================================================================
map.createPane('shopPane');
map.getPane('shopPane').style.zIndex = 650;

map.createPane('stationPane');
map.getPane('stationPane').style.zIndex = 620;

map.createPane('basePane');
map.getPane('basePane').style.zIndex = 410;

// ===================================================================
// アイコン定義（絵文字ピン。他の検索中心ピン「📍」と同じdivIcon方式）
// ===================================================================

// ラーメン店用（🍜を丸いバッジで囲んだアイコン）
function createShopIcon() {
    return L.divIcon({
        className: 'shop-marker-pin',
        html: '<div class="marker-emoji-circle marker-emoji-circle--shop">🍜</div>',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -18]
    });
}
let _shopIcon = null;
function getIcon() {
    return _shopIcon || (_shopIcon = createShopIcon());
}

// 駅用（🚉を丸いバッジで囲んだアイコン。ラーメン店より目立たないよう一回り小さくする）
function createStationIcon() {
    return L.divIcon({
        className: 'station-marker-pin-icon',
        html: '<div class="marker-emoji-circle marker-emoji-circle--station">🚉</div>',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -16]
    });
}
let _stationIcon = null;
function getSmallIcon() {
    return _stationIcon || (_stationIcon = createStationIcon());
}

// ===================================================================
// スプレッドシートデータ関連
// ===================================================================

// 公開されたGoogleスプレッドシートのCSV出力URL（このURLからデータを都度取得する）
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQHcC7BRftze6VGcNKcGoFGjd_0hSwkkchUqU4qVfwb8uUjrp0cShLY1ifvkKCmsqJFgUkOrYps5zaG/pub?gid=0&single=true&output=csv';

// 個人店・チェーン店の区別はせず、駅以外はすべて「ラーメン店」として扱う
const RAMEN_CATEGORY_LABEL = 'ラーメン店';

// RFC4180準拠の簡易CSVパーサー（引用符・カンマ・改行を含むセルに対応）
function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else { inQuotes = false; }
            } else {
                field += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(field); field = '';
        } else if (c === '\n') {
            row.push(field); rows.push(row); row = []; field = '';
        } else if (c === '\r') {
            // 無視（\r\n の \r 分）
        } else {
            field += c;
        }
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

// スプレッドシートのCSVを取得し、店舗オブジェクトの配列に変換する
async function loadShopsFromSheet() {
    const res = await fetch(SHEET_CSV_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const rows = parseCSV(text);
    if (rows.length < 2) return [];

    const header = rows[0].map(h => h.trim().toLowerCase());
    return rows.slice(1).map(cols => {
        const rec = {};
        header.forEach((h, i) => { rec[h] = (cols[i] ?? '').trim(); });
        return {
            name: rec.name || '(名称不明)',
            lat: parseFloat(rec.lat),
            lon: parseFloat(rec.lng ?? rec.lon),
            // 個人店・チェーン店の区別はせず、駅以外はすべて「ラーメン店」として扱う
            category: rec.category === '駅' ? '駅' : RAMEN_CATEGORY_LABEL,
            address: rec.address || '',
            openingHours: rec.opening_hours || rec.openinghours || '',
            parking: rec.parking || '',
            imageUrl: rec.image_url || rec.imageurl || rec.image || ''
        };
    }).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon) && s.name);
}

// データ取得に失敗した場合の通知バナー
function showDataError() {
    const div = document.createElement('div');
    div.textContent = '⚠️ 店舗データの取得に失敗しました。しばらくしてから再読み込みしてください。';
    div.style.cssText = 'position:absolute;top:70px;left:50%;transform:translateX(-50%);' +
        'background:#fdecea;color:#c0392b;border:1px solid #e74c3c;padding:8px 16px;' +
        'border-radius:6px;font-size:12px;font-weight:bold;z-index:2000;box-shadow:0 4px 12px rgba(0,0,0,0.2);';
    document.body.appendChild(div);
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===================================================================
// 営業時間パーサー（今日の曜日・現在時刻に基づく営業状況を判定）
// ===================================================================
const _JP_DAY       = { '月':1,'火':2,'水':3,'木':4,'金':5,'土':6,'日':0 };
const _JP_DAY_NAMES = ['日','月','火','水','木','金','土'];

function _expandDayRange(from, to) {
    const order = [1,2,3,4,5,6,0]; // 月→日
    const fi = order.indexOf(_JP_DAY[from] ?? -1);
    const ti = order.indexOf(_JP_DAY[to]   ?? -1);
    if (fi < 0 || ti < 0) return [];
    const days = [];
    if (fi <= ti) { for (let i=fi; i<=ti; i++) days.push(order[i]); }
    else          { for (let i=fi; i<7;  i++) days.push(order[i]); for (let i=0; i<=ti; i++) days.push(order[i]); }
    return days;
}

function _parseDaySpec(spec, today) {
    spec = spec.replace(/[祝前]/g,'').trim();
    if (!spec) return false;
    if (spec === '平日') return today >= 1 && today <= 5;
    if (spec === '土日') return today === 0 || today === 6;
    if (spec === '毎日' || spec === '無休') return true;
    if (spec === '日祝') return today === 0;
    if (spec === '土日祝') return today === 0 || today === 6;
    const daySet = [];
    for (let i = 0; i < spec.length; i++) {
        const ch = spec[i];
        if (!(ch in _JP_DAY)) continue;
        if (spec[i+1] === '-' && spec[i+2] in _JP_DAY) {
            daySet.push(..._expandDayRange(ch, spec[i+2]));
            i += 2;
        } else {
            daySet.push(_JP_DAY[ch]);
        }
    }
    return daySet.includes(today);
}

function _toMin(t) {
    const next  = t.startsWith('翌');
    const parts = t.replace('翌','').replace('頃','').split(':');
    if (parts.length < 2) return null;
    const h = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
    return (isNaN(h) || isNaN(m)) ? null : (next ? 24 : 0)*60 + h*60 + m;
}

function _fmtMin(min) {
    const h = Math.floor(min/60), m = min % 60;
    const pad = v => String(v).padStart(2,'0');
    return h >= 24 ? `翌${h-24}:${pad(m)}` : `${h}:${pad(m)}`;
}

function _parseTimePeriods(str) {
    const periods = [];
    for (const part of str.split(/[\/、]/).map(s => s.trim())) {
        const m = part.match(/(翌?\d{1,2}:\d{2})\s*[-〜～]\s*(翌?\d{1,2}:\d{2})/);
        if (!m) continue;
        const s = _toMin(m[1]), e = _toMin(m[2]);
        if (s !== null && e !== null) periods.push({ start: s, end: e });
    }
    return periods;
}

// 戻り値: { state: 'open'|'outside'|'closed', todayHoursStr, statusText } または null（判定不能）
function getShopStatus(hoursStr) {
    if (!hoursStr) return null;
    if (/店舗情報参照|施設に準ずる|不明/.test(hoursStr)) return null;

    const now    = new Date();
    const today  = now.getDay();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    if (/24時間/.test(hoursStr)) {
        return { state: 'open', todayHoursStr: '24時間営業', statusText: '🟢 営業中' };
    }

    // 定休日チェック（第N曜日・不定 は「確定休み」とみなさない）
    const closedM = hoursStr.match(/定休[日:：]?\s*([月火水木金土日・第\d不定夜\s]{1,20})/);
    if (closedM) {
        const closedParts = closedM[1].split(/[・、,，\s]+/).filter(Boolean);
        for (const part of closedParts) {
            if (/^第\d/.test(part)) continue;   // 第1火、第3月 など → スキップ
            if (/不定/.test(part))  continue;   // 木不定 など → スキップ
            for (const ch of [...part]) {
                if ((_JP_DAY[ch] ?? -1) === today) {
                    return { state: 'closed', todayHoursStr: null, statusText: '🔴 定休日' };
                }
            }
        }
    }

    // セグメント解析（括弧内の注記を除去してから分割）
    const cleaned  = hoursStr.replace(/（[^）]{0,40}）/g,' ').replace(/\([^)]{0,40}\)/g,' ');
    const segments = cleaned.split(/\s*\/\s*/).map(s=>s.trim()).filter(Boolean);

    const todayPeriods = [];
    let hasDayPrefix   = false;

    for (const seg of segments) {
        const dpM = seg.match(/^([月火水木金土日平毎祝・\-]+)\s+(.+)/);
        if (dpM) {
            hasDayPrefix = true;
            if (_parseDaySpec(dpM[1], today)) {
                todayPeriods.push(..._parseTimePeriods(dpM[2]));
            }
        } else if (!hasDayPrefix) {
            todayPeriods.push(..._parseTimePeriods(seg));
        }
    }

    if (todayPeriods.length === 0) {
        if (hasDayPrefix) return { state: 'closed', todayHoursStr: null, statusText: '🔴 定休日' };
        return null;
    }

    const todayHoursStr = todayPeriods.map(p => `${_fmtMin(p.start)}〜${_fmtMin(p.end)}`).join('・');
    const isOpen        = todayPeriods.some(p => nowMin >= p.start && nowMin < p.end);

    return {
        state: isOpen ? 'open' : 'outside',
        todayHoursStr,
        statusText: isOpen ? '🟢 営業中' : '⚠️ 営業時間外'
    };
}

const STATUS_THEME = {
    open:    { bg: '#eafaf1', border: '#27ae60' },
    outside: { bg: '#fff9e6', border: '#f1c40f' },
    closed:  { bg: '#fdecea', border: '#e74c3c' }
};

function buildStatusBoxHtml(hoursStr) {
    const status = getShopStatus(hoursStr);
    if (!status) return '';
    const theme = STATUS_THEME[status.state];
    const todayName = _JP_DAY_NAMES[new Date().getDay()];
    const subLine = status.todayHoursStr
        ? `本日(${todayName})の営業: ${escapeHtml(status.todayHoursStr)}`
        : `本日(${todayName})は定休日です`;

    return `
        <div class="popup-status-box" style="background:${theme.bg};border-left:3px solid ${theme.border};">
            <span class="popup-status-text">${status.statusText}</span><br>
            <span class="popup-status-sub">${subLine}</span>
        </div>
    `;
}

function renderOpeningHours(hoursStr) {
    if (!hoursStr) return '<span class="popup-muted">情報なし</span>';
    const isLateNight = /翌|24:00|25:00|24時間/.test(hoursStr);
    const badge = isLateNight ? ' <span class="popup-badge-night">🌙深夜営業</span>' : '';
    return `${escapeHtml(hoursStr)}${badge}`;
}

function renderParking(parkingStr) {
    if (!parkingStr) return '<span class="popup-muted">情報なし</span>';
    if (/なし/.test(parkingStr)) return `<span class="popup-parking-no">❌ なし</span>`;
    if (/あり/.test(parkingStr)) return `<span class="popup-parking-yes">✅ ${escapeHtml(parkingStr)}</span>`;
    return escapeHtml(parkingStr);
}

// ===================================================================
// 管理者モード（SHA-256ハッシュ照合・LocalStorage永続化）
// ===================================================================
// パスワード「08080819」のSHA-256ハッシュ値。平文はコードに残さない。
const ADMIN_PASS_HASH = 'e3ab5aa0433bf98881bfe4745029541658b3d05ff32cc8f30d4ac27bc02c9811';
const ADMIN_STORAGE_KEY = 'isAdmin';

// 端末（ブラウザ）ごとの匿名IDを1つ発行して保持する（レビューの投稿者識別用）
function getDeviceId() {
    const KEY = 'ramenMapDeviceId';
    try {
        let id = localStorage.getItem(KEY);
        if (!id) {
            id = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
            localStorage.setItem(KEY, id);
        }
        return id;
    } catch (e) {
        return 'dev-anonymous';
    }
}
const DEVICE_ID = getDeviceId();

function isAdminLoggedIn() {
    return localStorage.getItem(ADMIN_STORAGE_KEY) === 'true';
}

// Web Crypto APIでテキストをSHA-256ハッシュ化し、16進文字列で返す
async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// prompt()は平文入力しか出せないため、type="password"（入力中は●で伏字）の
// 専用モーダルを使ってパスワードを入力させる
function openAdminPasswordModal() {
    const overlay = document.getElementById('adminPasswordModal');
    const input   = document.getElementById('adminPasswordInput');
    if (!overlay || !input) return;
    input.value = '';
    overlay.classList.add('open');
    setTimeout(() => input.focus(), 50);
}

function closeAdminPasswordModal() {
    const overlay = document.getElementById('adminPasswordModal');
    if (overlay) overlay.classList.remove('open');
}

async function submitAdminPassword() {
    const input = document.getElementById('adminPasswordInput');
    if (!input || !input.value) return;

    const hash = await sha256Hex(input.value);
    if (hash === ADMIN_PASS_HASH) {
        closeAdminPasswordModal();
        localStorage.setItem(ADMIN_STORAGE_KEY, 'true');
        alert('管理者権限を有効化しました');
        location.reload();
    } else {
        alert('パスワードが違います。');
        input.value = '';
        input.focus();
    }
}

function adminLogout() {
    localStorage.removeItem(ADMIN_STORAGE_KEY);
    location.reload();
}

function updateAdminBadge() {
    const loggedIn  = isAdminLoggedIn();
    const badge     = document.getElementById('adminModeBadge');
    const reviewsBtn = document.getElementById('adminReviewsBtn');
    if (badge)      badge.style.display = loggedIn ? 'block' : 'none';
    if (reviewsBtn) reviewsBtn.style.display = loggedIn ? 'block' : 'none';
}

// LocalStorageに保存された全店舗ぶんの `ramenMapReviews:店舗名` を横断して集約する
function collectAllReviews() {
    const all = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('ramenMapReviews:')) continue;
        const shopName = key.slice('ramenMapReviews:'.length);
        let list;
        try {
            list = JSON.parse(localStorage.getItem(key));
        } catch (e) {
            continue;
        }
        if (!Array.isArray(list)) continue;
        list.forEach(r => all.push({ ...r, shopName }));
    }
    return all.sort((a, b) => b.savedAt - a.savedAt);
}

function renderAdminReviewsList() {
    const container = document.getElementById('adminReviewsListItems');
    const summary   = document.getElementById('adminReviewsSummary');
    if (!container) return;

    const all = collectAllReviews();
    if (summary) summary.textContent = `合計 ${all.length} 件のレビューがあります。`;

    container.innerHTML = all.length === 0
        ? '<div class="popup-review-empty">レビューはありません</div>'
        : all.map(r => {
            const date  = new Date(r.savedAt).toLocaleDateString('ja-JP');
            const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
            return `
                <div class="popup-review-entry">
                    <div class="admin-review-shop">🍜 ${escapeHtml(r.shopName)}</div>
                    <div class="popup-review-entry-stars">${stars}</div>
                    <div class="popup-review-entry-date">${date}</div>
                    <div class="popup-review-entry-comment">${escapeHtml(r.comment || '（コメントなし）')}</div>
                    <div class="popup-review-entry-actions">
                        <button type="button" class="popup-btn popup-btn-red admin-review-delete"
                                data-shop="${escapeHtml(r.shopName)}" data-id="${escapeHtml(r.id)}">🗑️ 削除</button>
                    </div>
                </div>`;
        }).join('');
}

function openAdminReviewsModal() {
    if (!isAdminLoggedIn()) return;
    renderAdminReviewsList();
    const overlay = document.getElementById('adminReviewsModal');
    if (overlay) overlay.classList.add('open');
}

function closeAdminReviewsModal() {
    const overlay = document.getElementById('adminReviewsModal');
    if (overlay) overlay.classList.remove('open');
}

function initAdminMode() {
    const dot       = document.getElementById('adminHiddenDot');
    const badge     = document.getElementById('adminModeBadge');
    const overlay   = document.getElementById('adminPasswordModal');
    const closeBtn  = document.getElementById('adminPasswordCloseBtn');
    const submitBtn = document.getElementById('adminPasswordSubmitBtn');
    const input     = document.getElementById('adminPasswordInput');

    if (dot)   dot.addEventListener('click', openAdminPasswordModal);
    if (badge) badge.addEventListener('click', adminLogout);
    if (closeBtn) closeBtn.addEventListener('click', closeAdminPasswordModal);
    if (submitBtn) submitBtn.addEventListener('click', submitAdminPassword);
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitAdminPassword();
        });
    }
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeAdminPasswordModal();
        });
    }

    // 管理者限定: 全店舗のレビュー一覧モーダル
    const reviewsBtn       = document.getElementById('adminReviewsBtn');
    const reviewsOverlay   = document.getElementById('adminReviewsModal');
    const reviewsCloseBtn  = document.getElementById('adminReviewsCloseBtn');
    const reviewsListItems = document.getElementById('adminReviewsListItems');

    if (reviewsBtn) reviewsBtn.addEventListener('click', openAdminReviewsModal);
    if (reviewsCloseBtn) reviewsCloseBtn.addEventListener('click', closeAdminReviewsModal);
    if (reviewsOverlay) {
        reviewsOverlay.addEventListener('click', (e) => {
            if (e.target === reviewsOverlay) closeAdminReviewsModal();
        });
    }
    if (reviewsListItems) {
        reviewsListItems.addEventListener('click', (e) => {
            const btn = e.target.closest('.admin-review-delete');
            if (!btn) return;
            if (!confirm('本当に削除しますか？')) return;
            removeReview(btn.dataset.shop, btn.dataset.id);
            renderAdminReviewsList();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (overlay && overlay.classList.contains('open')) closeAdminPasswordModal();
        if (reviewsOverlay && reviewsOverlay.classList.contains('open')) closeAdminReviewsModal();
    });

    updateAdminBadge();
}

// ===================================================================
// レビュー機能（LocalStorage保存・店舗ごとに複数件のレビューを配列で保持）
// ===================================================================
function reviewsStorageKey(name) {
    return `ramenMapReviews:${name}`;
}

function loadReviews(name) {
    try {
        const raw = localStorage.getItem(reviewsStorageKey(name));
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

function saveReviews(name, list) {
    try {
        localStorage.setItem(reviewsStorageKey(name), JSON.stringify(list));
    } catch (e) {
        console.warn('[ラーメンマップ] レビューの保存に失敗しました:', e.message);
    }
}

function addReview(name, rating, comment) {
    const list = loadReviews(name);
    list.push({
        id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2),
        rating, comment, savedAt: Date.now(), authorId: DEVICE_ID
    });
    saveReviews(name, list);
}

// 編集時は投稿者IDを維持する（管理者が他人のレビューを編集しても投稿者は変わらない）
function updateReview(name, id, rating, comment) {
    const list = loadReviews(name);
    const idx = list.findIndex(r => r.id === id);
    if (idx === -1) return;
    list[idx] = { ...list[idx], rating, comment, savedAt: Date.now() };
    saveReviews(name, list);
}

// 通常は投稿者本人のブラウザからのみ削除できるが、管理者モードなら誰の投稿でも削除できる
function removeReview(name, id) {
    saveReviews(name, loadReviews(name).filter(r => r.id !== id));
}

function buildReviewViewHtml(shop) {
    const stars = [1, 2, 3, 4, 5].map(n => `<span class="popup-star" data-value="${n}">☆</span>`).join('');
    return `
        <div class="popup-review-title">📝 ${escapeHtml(shop.name)} のレビュー</div>
        <div class="popup-review-list">
            <div class="popup-review-list-items"></div>
            <button type="button" class="popup-btn popup-btn-grey popup-review-list-back">戻る</button>
        </div>
        <div class="popup-review-form">
            <div class="popup-star-row">${stars}</div>
            <textarea class="popup-review-comment" rows="3" placeholder="コメントを入力してください..."></textarea>
            <div class="popup-review-actions">
                <button type="button" class="popup-btn popup-btn-orange popup-review-submit">送信</button>
                <button type="button" class="popup-btn popup-btn-grey popup-review-back-form">戻る</button>
            </div>
        </div>
    `;
}

function wireUpReviewEvents(root, shop) {
    const infoView    = root.querySelector('.popup-info-view');
    const reviewView  = root.querySelector('.popup-review-view');
    const listView    = root.querySelector('.popup-review-list');
    const formView    = root.querySelector('.popup-review-form');
    const writeBtn    = root.querySelector('.popup-review-write-toggle');
    const viewBtn     = root.querySelector('.popup-review-view-toggle');
    const listItemsEl = root.querySelector('.popup-review-list-items');
    const listBackBtn = root.querySelector('.popup-review-list-back');
    const backFormBtn = root.querySelector('.popup-review-back-form');
    const submitBtn   = root.querySelector('.popup-review-submit');
    const commentEl   = root.querySelector('.popup-review-comment');
    const starEls     = root.querySelectorAll('.popup-star');

    let selectedRating = 0;
    let editingId = null; // null = 新規投稿 / 文字列 = そのIDのレビューを編集中

    function renderStars() {
        starEls.forEach(star => {
            const v = Number(star.dataset.value);
            star.textContent = v <= selectedRating ? '★' : '☆';
        });
    }

    function showInfoView() {
        reviewView.style.display = 'none';
        infoView.style.display = 'block';
    }

    // 自分（同じ端末）または管理者モードのときだけ、そのレビューの編集・削除を許可する
    function canManage(review) {
        const isOwner = !review.authorId || review.authorId === DEVICE_ID;
        return isAdminLoggedIn() || isOwner;
    }

    function showList() {
        const list = loadReviews(shop.name).slice().sort((a, b) => b.savedAt - a.savedAt);
        listItemsEl.innerHTML = list.length === 0
            ? '<div class="popup-review-empty">レビューはありません</div>'
            : list.map(r => {
                const isOwner = !r.authorId || r.authorId === DEVICE_ID;
                const date = new Date(r.savedAt).toLocaleDateString('ja-JP');
                const starStr = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
                const actionsHtml = canManage(r) ? `
                    <div class="popup-review-entry-actions">
                        <button type="button" class="popup-btn popup-btn-blue popup-review-entry-edit" data-id="${escapeHtml(r.id)}">✏️ 編集</button>
                        <button type="button" class="popup-btn popup-btn-red popup-review-entry-delete" data-id="${escapeHtml(r.id)}">🗑️ 削除</button>
                    </div>` : '';
                return `
                    <div class="popup-review-entry">
                        <div class="popup-review-entry-stars">${starStr}</div>
                        <div class="popup-review-entry-date">${date}${isOwner ? '（あなたの投稿）' : ''}</div>
                        <div class="popup-review-entry-comment">${escapeHtml(r.comment || '（コメントなし）')}</div>
                        ${actionsHtml}
                    </div>`;
            }).join('');

        formView.style.display = 'none';
        listView.style.display = 'block';
    }

    // editingReview: null = 新規投稿フォーム / レビューオブジェクト = そのレビューを編集
    function showForm(editingReview) {
        editingId = editingReview ? editingReview.id : null;
        selectedRating  = editingReview ? editingReview.rating : 0;
        commentEl.value = editingReview ? (editingReview.comment || '') : '';
        submitBtn.textContent = editingReview ? '保存' : '送信';
        renderStars();
        listView.style.display = 'none';
        formView.style.display = 'block';
    }

    starEls.forEach(star => {
        star.addEventListener('click', () => {
            selectedRating = Number(star.dataset.value);
            renderStars();
        });
    });

    writeBtn.addEventListener('click', () => {
        infoView.style.display   = 'none';
        reviewView.style.display = 'block';
        showForm(null);
    });

    viewBtn.addEventListener('click', () => {
        infoView.style.display   = 'none';
        reviewView.style.display = 'block';
        showList();
    });

    // 一覧内の「編集」「削除」ボタンはイベント委譲で処理する
    listItemsEl.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.popup-review-entry-edit');
        const deleteBtn = e.target.closest('.popup-review-entry-delete');
        if (editBtn) {
            const review = loadReviews(shop.name).find(r => r.id === editBtn.dataset.id);
            if (review && canManage(review)) showForm(review);
        } else if (deleteBtn) {
            const review = loadReviews(shop.name).find(r => r.id === deleteBtn.dataset.id);
            if (!review || !canManage(review)) return;
            if (!confirm('本当に削除しますか？')) return;
            removeReview(shop.name, review.id);
            showList();
        }
    });

    listBackBtn.addEventListener('click', showInfoView);

    backFormBtn.addEventListener('click', () => {
        // 編集中にキャンセルした場合は一覧へ、新規投稿中は情報カードへ戻る
        editingId ? showList() : showInfoView();
    });

    submitBtn.addEventListener('click', () => {
        if (selectedRating === 0) {
            alert('星評価を選択してください。');
            return;
        }
        if (editingId) {
            updateReview(shop.name, editingId, selectedRating, commentEl.value.trim());
        } else {
            addReview(shop.name, selectedRating, commentEl.value.trim());
        }
        editingId = null;
        showList();
    });
}

// 駅用のポップアップ（駅名とGoogleマップ経路検索のみ）
function buildStationPopupElement(shop) {
    const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${shop.lat},${shop.lon}`;
    const root = document.createElement('div');
    root.className = 'popup-card';
    root.innerHTML = `
        <div class="popup-title popup-station-title">${escapeHtml(shop.name)}</div>
        <div class="popup-actions">
            <a href="${gmapsUrl}" target="_blank" class="popup-btn popup-btn-green">🗺️ Google Mapで経路を検索</a>
        </div>
    `;
    return root;
}

// 全カテゴリ共通のリッチなポップアップカードを組み立てる（駅は簡易版に分岐）
function buildRichPopupElement(shop) {
    if (shop.category === '駅') return buildStationPopupElement(shop);

    const gmapsUrl  = `https://www.google.com/maps/dir/?api=1&destination=${shop.lat},${shop.lon}`;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(shop.name + ' ラーメン')}`;
    const imageHtml = shop.imageUrl
        ? `<img src="${escapeHtml(shop.imageUrl)}" alt="${escapeHtml(shop.name)}" class="popup-photo" onerror="this.style.display='none';">`
        : '';

    const root = document.createElement('div');
    root.className = 'popup-card';
    root.innerHTML = `
        <div class="popup-info-view">
            ${imageHtml}
            <div class="popup-header">
                <div class="popup-title">${escapeHtml(shop.name)}</div>
                <span class="popup-category-badge">${escapeHtml(shop.category)}</span>
            </div>
            <div class="popup-field"><b>📍 住所:</b> ${shop.address ? escapeHtml(shop.address) : '<span class="popup-muted">情報なし</span>'}</div>
            <div class="popup-field"><b>🕒 営業時間:</b> ${renderOpeningHours(shop.openingHours)}</div>
            ${buildStatusBoxHtml(shop.openingHours)}
            <div class="popup-parking-box"><b>🚗 駐車場:</b> ${renderParking(shop.parking)}</div>
            <div class="popup-actions">
                <a href="${gmapsUrl}" target="_blank" class="popup-btn popup-btn-green">🗺️ Google Mapで経路を検索</a>
                <a href="${searchUrl}" target="_blank" class="popup-btn popup-btn-blue">🔍 詳細を検索</a>
                <button type="button" class="popup-btn popup-btn-orange popup-review-write-toggle">✍️ レビューを書く</button>
                <button type="button" class="popup-btn popup-btn-grey popup-review-view-toggle">👀 レビューを見る（${loadReviews(shop.name).length}件）</button>
            </div>
        </div>
        <div class="popup-review-view" style="display:none;">
            ${buildReviewViewHtml(shop)}
        </div>
    `;

    wireUpReviewEvents(root, shop);
    return root;
}

// ===================================================================
// 道路ネットワーク（OSRM 実道路 + 直線フォールバック）
// ===================================================================
async function fetchRouteCoords(waypoints) {
    const coordStr = waypoints.map(([lat, lon]) => `${lon},${lat}`).join(';');
    const res = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.code !== 'Ok') throw new Error(data.message);
    return data.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
}

const roadDefs = [
    { id: 'road6',   src: typeof route6Coords   !== 'undefined' ? route6Coords   : [], color: '#3498db', label: '国道6号',  popup: '<b class="popup-label-nowrap">国道6号線</b>' },
    { id: 'road16',  src: typeof route16Coords  !== 'undefined' ? route16Coords  : [], color: '#e67e22', label: '国道16号', popup: '<b class="popup-label-nowrap">国道16号線</b>' },
    { id: 'road5',   src: typeof route5Coords   !== 'undefined' ? route5Coords   : [], color: '#9b59b6', label: '流山街道', popup: '<b class="popup-label-nowrap">流山街道 (県道5号)</b>' },
    { id: 'road464', src: typeof route464Coords !== 'undefined' ? route464Coords : [], color: '#e84393', label: '国道464号', popup: '<b class="popup-label-nowrap">国道464号線</b>' },
    { id: 'road294', src: typeof route294Coords !== 'undefined' ? route294Coords : [], color: '#27ae60', label: '国道294号', popup: '<b class="popup-label-nowrap">国道294号線</b>' },
];

roadDefs.forEach(road => { road.layer = L.layerGroup().addTo(map); });

(async () => {
    for (const road of roadDefs) {
        if (road.src.length < 2) continue;
        const style = { pane: 'basePane', color: road.color, weight: 3, opacity: 0.55 };
        // ピン刺しモード中に道路をクリックしても、地図への click イベント伝播で
        // 誤って中心ピンが刺さらないよう stopPropagation しておく
        // 道路名はただの小さなラベルなので閉じるボタンは表示しない（地図の他の場所を
        // クリックすれば自動的に閉じる）
        const popupOptions = { closeButton: false };
        try {
            const coords = await fetchRouteCoords(road.src);
            L.polyline(coords, style).bindPopup(road.popup, popupOptions).on('click', L.DomEvent.stopPropagation).addTo(road.layer);
        } catch (e) {
            console.warn('OSRMルート取得失敗（直線で代替）:', road.popup, e.message);
            L.polyline(road.src, style).bindPopup(road.popup, popupOptions).on('click', L.DomEvent.stopPropagation).addTo(road.layer);
        }
        await new Promise(r => setTimeout(r, 250));
    }
})();

// ===================================================================
// 駅一覧パネル
// スプレッドシートの category="駅" 行を駅として扱う（駅レイヤー自体は
// カテゴリ別クラスターの一つとして initShopData 内で構築される）
// ===================================================================
const stationMarkerMap = new Map();  // 駅名 → marker（パネルクリック時のポップアップ用）

// 駅一覧（凡例と同じ折りたたみ式ドロップダウン）のリストを動的に生成
// スプレッドシートからの店舗データ取得完了後に shops を渡して呼び出す
function buildStationList(shops) {
    const body = document.getElementById('stationListBody');
    if (!body) return;
    body.innerHTML = '';

    const stationShops = shops.filter(s => s.category === '駅');

    stationShops.forEach(st => {
        const item = document.createElement('div');
        item.className = 'station-list-item';
        item.textContent = `🚉 ${st.name}`;
        item.addEventListener('click', () => {
            closeSidebar();
            // 単に地図を移動するだけでなく、その駅にピンを刺したのと同じ状態にする
            // （検索中心をその駅にし、半径1km以内で再描画・表示切り替えは無効化）
            setSearchPin(st.lat, st.lon);
            // クリック直後は再描画でマーカーが作り直されているため、ここで参照を取り直す
            setTimeout(() => {
                const marker = stationMarkerMap.get(st.name);
                if (marker) marker.openPopup();
            }, 1300);
        });
        body.appendChild(item);
    });
}

// 駅一覧ドロップダウンの開閉制御（凡例と同じく、開いたまま地図を操作できる）
function setStationListOpen(isOpen) {
    const body = document.getElementById('stationListBody');
    const btn  = document.getElementById('stationToggleBtn');
    if (!body || !btn) return;
    body.classList.toggle('open', isOpen);
    btn.textContent = isOpen ? '🚉 駅一覧 ▲' : '🚉 駅一覧 ▼';
}
function closeSidebar() { setStationListOpen(false); }

document.getElementById('stationToggleBtn').addEventListener('click', function() {
    setStationListOpen(!document.getElementById('stationListBody').classList.contains('open'));
});

// ===================================================================
// 現在地ロジック
// ===================================================================

const MAP_BOUNDS = [[35.60, 139.70], [36.08, 140.25]];

// 現在地の取得に失敗した場合のフォールバック中心地点（対象4市のほぼ中央）
const DEFAULT_CENTER = { lat: 35.8500, lng: 140.0000 };

let locationMarker    = null; // 現在地マーカー（青丸）。検索ピンの状態に関わらず常に表示され続ける
let locationCircle    = null; // 現在地の精度円
let searchCenterMarker = null; // 検索中心（📍）を示すマーカー。ピン刺し／駅選択／現在地選択のたびに置き直す

// ---- 現在地マーカーを地図に表示する（検索ピンとは独立して常に残り続ける） ----
function showUserMarker(lat, lng, accuracy) {
    if (locationMarker) { map.removeLayer(locationMarker); locationMarker = null; }
    if (locationCircle) { map.removeLayer(locationCircle); locationCircle = null; }

    locationMarker = L.circleMarker([lat, lng], {
        radius: 9, color: '#fff', weight: 2.5, fillColor: '#2979FF', fillOpacity: 1
    })
    .addTo(map)
    .bindPopup('📍 現在地');

    if (accuracy) {
        locationCircle = L.circle([lat, lng], {
            radius: accuracy, color: '#2979FF', fillColor: '#2979FF',
            fillOpacity: 0.12, weight: 1
        }).addTo(map);
    }
}

// ---- 検索中心ピン（📍）だけを消す。現在地マーカーには触れない ----
function clearSearchPinMarker() {
    if (searchCenterMarker) { map.removeLayer(searchCenterMarker); searchCenterMarker = null; }
}

// ---- 中心点へ地図を移動する（maxBounds を一時解除して飛ぶ、共通処理） ----
// 固定ズームレベルではなく、検索半径1kmの円がちょうど画面に収まるズームへ飛ぶ
function flyToArea(lat, lng, opts) {
    opts = opts || {};
    map.setMaxBounds(null);

    // L.circle().getBounds() は地図に追加されていないと使えないため、
    // 地図非依存で計算できる LatLng.toBounds() で半径1kmの矩形範囲を求める
    const bounds = L.latLng(lat, lng).toBounds(SEARCH_RADIUS_M * 2);
    map.flyToBounds(bounds, { duration: opts.duration ?? 1.5, padding: [24, 24] });

    map.once('moveend', function() {
        if (L.latLngBounds(MAP_BOUNDS).contains([lat, lng])) {
            map.setMaxBounds(MAP_BOUNDS);
        }
    });
}

// ---- 現在地を検索中心として初期化（成功・フォールバック共通エントリポイント） ----
// 現在地ボタン／初期エリア選択モーダルの両方から呼ばれる。
// 現在地マーカー（青丸）を表示したうえで、同じ地点に検索ピン（📍）を刺す。
// 現在地マーカーはピンが消えても残り続ける、ピンとは独立した表示。
function initUserPosition(lat, lng, accuracy) {
    showUserMarker(lat, lng, accuracy);
    setSearchPin(lat, lng);
}

// ---- 駅選択／ピン刺しモードで指定した地点を検索中心にする ----
// 現在地マーカーとは見た目を変え、専用の📍アイコンを立てる。現在地マーカーには触れない。
// 連続してピンを刺した場合も、直前のピンを消してから描画し直す。
function setSearchPin(lat, lng) {
    clearSearchPinMarker();

    searchCenterMarker = L.marker([lat, lng], {
        icon: L.divIcon({
            className: 'search-center-pin',
            html: '📍',
            iconSize: [30, 30],
            iconAnchor: [15, 28]
        }),
        zIndexOffset: 1000
    }).addTo(map);

    currentCenter = { lat, lng };
    enterPinMode();
    applyAreaFilter(lat, lng);
    flyToArea(lat, lng, { duration: 1.2 });
}

// ===================================================================
// ラーメン店マーカー（クラスター化はせず、常に個々のピンをそのまま表示する）
// ===================================================================

// カテゴリ名 → { cluster } を保持する
const categoryClusters = new Map();

function getOrCreateCategoryCluster(category) {
    if (categoryClusters.has(category)) return categoryClusters.get(category);

    const entry = { cluster: L.layerGroup() };
    categoryClusters.set(category, entry);
    return entry;
}

// 凡例用：絵文字アイコン + カテゴリ名の表示アイテム（地図上のピンと同じ絵文字を使う）
function buildCategoryLegendItem(category) {
    const div = document.createElement('div');
    div.className = 'legend-item';
    const emoji = category === '駅' ? '🚉' : '🍜';
    div.innerHTML = `
        <span class="legend-emoji">${emoji}</span>
        <span style="font-size:12px; color:#333;">${escapeHtml(category)}</span>
    `;
    return div;
}

// 凡例（右下・表示のみ）を生成する
function buildCategoryLegend() {
    const legendContainer = document.getElementById('legendCategoryItems');
    if (!legendContainer) return;
    legendContainer.innerHTML = '';

    categoryClusters.forEach((_, category) => {
        legendContainer.appendChild(buildCategoryLegendItem(category));
    });
}

// ===================================================================
// エリア検索（中心点から半径1km以内のみを表示）
// スプレッドシートの全件は allShops に保持しておき、中心点が決まるたびに
// applyAreaFilter() で距離計算をやり直して該当するピンだけを描画し直す
// ===================================================================
let allShops     = [];   // スプレッドシートの全件（フィルタなし）
let currentCenter = null; // { lat, lng } 現在の検索中心（未選択なら null）
const SEARCH_RADIUS_M = 1000;
const NEAR_STATION_RADIUS_M = 500; // 「駅前・徒歩圏内」の判定基準

// 現在描画されている店舗・駅ピンをすべてクリアする（クラスター自体は残す）
function clearAllShopMarkers() {
    categoryClusters.forEach(({ cluster }) => cluster.clearLayers());
    stationMarkerMap.clear();
}

// 1件ぶんの店舗マーカーを生成し、該当カテゴリのクラスターに追加する
function addShopMarker(shop) {
    const { cluster } = getOrCreateCategoryCluster(shop.category);
    const isStation = shop.category === '駅';
    const icon = isStation ? getSmallIcon() : getIcon();
    const marker = L.marker([shop.lat, shop.lon], { icon, pane: isStation ? 'stationPane' : 'shopPane' });

    // 関数を渡すことで、ポップアップを開くたびに最新のレビュー内容を反映する
    marker.bindPopup(() => buildRichPopupElement(shop));

    marker.on('click', function(e) {
        // ピン刺しモード中に店舗ピンをクリックしても、その場所に新しい中心ピンが
        // 刺さってしまわないよう、地図への click イベントの伝播を止める
        L.DomEvent.stopPropagation(e);
        map.flyTo([shop.lat, shop.lon], Math.max(map.getZoom(), 16), { duration: 0.7 });
    });

    cluster.addLayer(marker);
    if (isStation) {
        stationMarkerMap.set(shop.name, marker);
        // ピン刺しモード中に生成された駅ピンは、最初からクリック不可にしておく
        // （駅の位置にも検索ピンを刺せるよう、駅ピン自身のクリックを地図クリックとして扱わせる）
        if (pinDropMode) {
            const el = marker.getElement();
            if (el) el.style.pointerEvents = 'none';
        }
    }
}

// ===================================================================
// 表示切り替え（生存戦略フィルター）
// 「最寄り駅からの距離」「駐車場の有無」「深夜営業か」を店舗ごとに事前計算し、
// 左側パネルのチェックボックスで絞り込めるようにする。
// ===================================================================

// 全店舗ぶんの最寄り駅距離・駐車場有無・深夜営業フラグを一括で事前計算する。
// 描画のたびに計算し直すと重いため、データ取得直後に一度だけ実行してプロパティに持たせる。
function computeDerivedShopProps(shops) {
    const stations = shops.filter(s => s.category === '駅');

    shops.forEach(shop => {
        if (shop.category === '駅') return; // 駅自体には適用しない

        let nearestStationDist = Infinity;
        const from = L.latLng(shop.lat, shop.lon);
        stations.forEach(st => {
            const d = map.distance(from, L.latLng(st.lat, st.lon));
            if (d < nearestStationDist) nearestStationDist = d;
        });

        shop.nearestStationDist = nearestStationDist;
        shop.parkingAvailable   = shopHasParking(shop.parking);
        shop.isLateNight        = isLateNightOpen(shop.openingHours);
    });
}

// parking列の文字列から駐車場の有無を判定する（renderParking() の判定基準と揃える）
function shopHasParking(parkingStr) {
    if (!parkingStr) return false;             // 空欄 → なし扱い
    if (/なし/.test(parkingStr)) return false;
    if (/あり/.test(parkingStr)) return true;
    return false;                               // どちらの語も含まない場合は「なし」扱い
}

// opening_hours列の文字列から「22:00以降も営業する時間帯」を含むかを判定する。
// 既存の営業状況判定（getShopStatus）が使っている時刻抽出ロジック（_parseTimePeriods /
// _toMin）をそのまま利用する: 正規表現で "HH:MM-HH:MM" 形式の時間帯を曜日指定に関わらず
// すべて抜き出し、いずれかの終了時刻が22:00（=1320分）以降かどうかを見る。
// 「翌」が付いた終了時刻（例: 18:00-翌2:00）は _toMin() 側で24時間加算されるため、
// 日をまたぐ深夜営業も自動的に判定対象に含まれる。
function isLateNightOpen(hoursStr) {
    if (!hoursStr) return false;
    if (/24時間/.test(hoursStr)) return true;
    const periods = _parseTimePeriods(hoursStr);
    return periods.some(p => p.end >= 22 * 60);
}

// 表示切り替えパネルのチェックボックス状態
const displayFilterState = {
    showStations: true,  // 駅を表示（地図表示グループ・初期値はON＝従来通り常に表示）
    nearStation:  false, // 駅前・徒歩圏内（駅から500m以内）
    farStation:   false, // ロードサイド・郊外型（駅から500m超）
    parkingYes:   false, // 駐車場あり
    parkingNo:    false, // 駐車場なし
    lateNight:    false  // 深夜営業型（22時以降も営業）
};

// チェックが入った条件を店舗が満たすか判定する。
// 「駅前⇔郊外」「駐車場あり⇔なし」はそれぞれ二者択一の軸なので、同じ軸の中は
// OR（どちらかにチェックが入っていれば一致で表示）、軸をまたぐ場合はAND（すべての
// アクティブな軸を満たす店舗だけ表示）という複合ロジックにする。両方チェックすると
// 常に非表示になってしまう単純なAND全条件方式より、直感的に操作できるための工夫。
function passesDisplayFilters(shop) {
    if (shop.category === '駅') return displayFilterState.showStations; // 駅は「駅を表示」チェックのみで判定

    const locationActive = displayFilterState.nearStation || displayFilterState.farStation;
    if (locationActive) {
        const matchesNear = displayFilterState.nearStation && shop.nearestStationDist <= NEAR_STATION_RADIUS_M;
        const matchesFar  = displayFilterState.farStation  && shop.nearestStationDist >  NEAR_STATION_RADIUS_M;
        if (!matchesNear && !matchesFar) return false;
    }

    const parkingActive = displayFilterState.parkingYes || displayFilterState.parkingNo;
    if (parkingActive) {
        const matchesYes = displayFilterState.parkingYes && shop.parkingAvailable;
        const matchesNo  = displayFilterState.parkingNo  && !shop.parkingAvailable;
        if (!matchesYes && !matchesNo) return false;
    }

    if (displayFilterState.lateNight && !shop.isLateNight) return false;

    return true;
}

let areaFilteredShops = []; // 現在の検索エリア内の店舗＋駅全件（ピン刺しモード中の描画対象）

// 中心点(lat, lng)から半径1km以内の店舗だけを対象にする。駅は距離に関係なく常に全件対象。
// 実際の描画は renderFilteredShops() が行う（ピン刺しモード中はこの結果をそのまま使う）。
function applyAreaFilter(lat, lng) {
    if (!allShops.length) { areaFilteredShops = []; renderFilteredShops(); return; }

    const center = L.latLng(lat, lng);
    areaFilteredShops = allShops.filter(s => {
        if (s.category === '駅') return true;
        return map.distance(center, L.latLng(s.lat, s.lon)) <= SEARCH_RADIUS_M;
    });
    renderFilteredShops();
}

// ===================================================================
// モード排他制御（ピン刺しモード ⇔ 表示切り替えフィルターモード）
// 検索中心ピンによる半径1km絞り込みと、表示切り替えチェックボックスによる全エリア
// 絞り込みは同時には効かせない。isPinModeActive が唯一の真偽の切り替えポイントで、
// ピンが消えたら自動的にフィルター再評価（renderFilteredShops）が走り、ピンが刺さって
// いる間はチェックボックスの状態そのものを無視して距離条件だけで描画する。
// ===================================================================
let isPinModeActive = false;

// 検索中心ピンが確定した瞬間（setSearchPin / initUserPosition）に呼ぶ。
function enterPinMode() {
    isPinModeActive = true;
    setDisplayFilterEnabled(false);
    updatePinClearBtn();
}

// ピンを消してフィルターモードに戻す。「📍ボタンをOFF」「ピンをクリア」の両方から呼ばれる。
// 現在地マーカーはピンとは独立した表示のため、ここでは消さずそのまま残す。
function exitPinMode() {
    isPinModeActive = false;
    currentCenter = null;
    areaFilteredShops = [];
    clearSearchPinMarker();
    setDisplayFilterEnabled(true);
    updatePinClearBtn();
    renderFilteredShops();
}

// 表示切り替えパネルのチェックボックス群を一括で有効／無効化し、視覚的にもグレーアウトさせる
function setDisplayFilterEnabled(enabled) {
    const body = document.getElementById('displayFilterBody');
    if (body) body.classList.toggle('disabled', !enabled);
    const notice = document.getElementById('displayFilterNotice');
    if (notice) notice.style.display = enabled ? 'none' : 'block';
    ['filterNearStation', 'filterFarStation', 'filterParkingYes', 'filterParkingNo', 'filterLateNight']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = !enabled;
        });
}

function updatePinClearBtn() {
    const btn = document.getElementById('pinClearBtn');
    if (btn) btn.disabled = !isPinModeActive;
}

// 表示切り替えのチェックボックスが1つでもONになっているかどうか
function isAnyDisplayFilterActive() {
    return displayFilterState.nearStation || displayFilterState.farStation ||
           displayFilterState.parkingYes  || displayFilterState.parkingNo  ||
           displayFilterState.lateNight;
}

// 描画の分岐点: ピン刺しモード中は店舗の絞り込みチェックボックスを一切見ず、検索中心
// から半径1km以内（＋駅全件）だけを描画する。フィルターモード中は全エリアの店舗に
// チェックボックス条件（AND/ORの複合ロジック）を適用して描画する。チェックボックスが
// 1つも選ばれていない場合は「全店舗表示」にはせず、駅ピンだけを残して空の地図にする。
// 「駅を表示」チェックボックスだけは地図表示グループに属し、駅の絞り込みではないため
// ピン刺しモード中も含め常に効かせる。
function renderFilteredShops() {
    clearAllShopMarkers();
    if (isPinModeActive) {
        areaFilteredShops
            .filter(s => s.category !== '駅' || displayFilterState.showStations)
            .forEach(addShopMarker);
    } else if (isAnyDisplayFilterActive()) {
        allShops.filter(passesDisplayFilters).forEach(addShopMarker);
    } else {
        allShops.filter(s => s.category === '駅' && displayFilterState.showStations).forEach(addShopMarker);
    }
}

// 表示切り替えパネルのチェックボックスと状態を結びつける
function initDisplayFilterControls() {
    const bindings = [
        ['filterNearStation', 'nearStation'],
        ['filterFarStation',  'farStation'],
        ['filterParkingYes',  'parkingYes'],
        ['filterParkingNo',   'parkingNo'],
        ['filterLateNight',   'lateNight']
    ];
    bindings.forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', () => {
            // ピン刺しモード中はdisabledで操作不可のはずだが、念のため状態変化を無視する
            if (isPinModeActive) return;
            displayFilterState[key] = el.checked;
            renderFilteredShops();
        });
    });
}
initDisplayFilterControls();

// 「駅を表示」チェックボックス（地図表示グループ）。店舗の絞り込みとは無関係なので、
// 「駅500m圏内の円」と同様にピン刺しモード中でも常に操作可能にしてある。
const filterShowStationsEl = document.getElementById('filterShowStations');
if (filterShowStationsEl) {
    filterShowStationsEl.addEventListener('change', () => {
        displayFilterState.showStations = filterShowStationsEl.checked;
        renderFilteredShops();
    });
}

// ===================================================================
// 駅500m圏内の円（表示切り替えパネルの「地図表示」トグル）
// 店舗の絞り込みとは無関係な純粋な地図オーバーレイなので、ピン刺しモード中でも
// 常に操作可能（表示切り替えのdisabled化の対象外）にしてある。
// ===================================================================
let stationRadiusLayer = null;

// 駅データ取得後に一度だけ呼び、駅ごとの500m円をレイヤーグループとして構築しておく
// （デフォルトでは地図に追加しない。チェックボックスON時のみ addLayer する）
function buildStationRadiusCircles(shops) {
    if (stationRadiusLayer) map.removeLayer(stationRadiusLayer);
    stationRadiusLayer = L.layerGroup(
        shops.filter(s => s.category === '駅').map(st => L.circle([st.lat, st.lon], {
            radius: NEAR_STATION_RADIUS_M,
            color: '#7f8c8d',
            weight: 1.5,
            dashArray: '4 4',
            fillColor: '#7f8c8d',
            fillOpacity: 0.06,
            interactive: false
        }))
    );
}

document.getElementById('filterShowStationRadius').addEventListener('change', function() {
    if (!stationRadiusLayer) return;
    if (this.checked) {
        stationRadiusLayer.addTo(map);
    } else {
        map.removeLayer(stationRadiusLayer);
    }
});

document.getElementById('displayFilterToggleBtn').addEventListener('click', function() {
    const body = document.getElementById('displayFilterBody');
    const btn  = this;
    const isOpen = !body.classList.contains('open');
    body.classList.toggle('open', isOpen);
    btn.textContent = isOpen ? '🔍 表示切り替え ▲' : '🔍 表示切り替え ▼';
});

// スプレッドシートからデータを取得し、凡例・駅一覧・エリア選択モーダルの駅プルダウンを構築する
// （ピン自体は検索中心が決まってから applyAreaFilter() が描画する）
(async function initShopData() {
    try {
        allShops = await loadShopsFromSheet();
    } catch (e) {
        console.error('[ラーメンマップ] スプレッドシートの取得に失敗しました:', e);
        showDataError();
        allShops = [];
    }

    // 表示切り替えフィルターで使う派生プロパティ（最寄り駅距離・駐車場有無・深夜営業）を一括計算
    computeDerivedShopProps(allShops);

    // クラスター・色の登録だけ先に済ませておく（ピンはまだ追加しない）
    allShops.forEach(shop => getOrCreateCategoryCluster(shop.category));
    categoryClusters.forEach(({ cluster }) => cluster.addTo(map));

    buildCategoryLegend();
    buildStationList(allShops);
    buildStationRadiusCircles(allShops);
    populateAreaStationSelect(allShops);

    // ユーザーがデータ取得完了より先に検索中心を選び終えていた場合に備えて、再計算する
    if (currentCenter) applyAreaFilter(currentCenter.lat, currentCenter.lng);
})();

// タイトル枠 → 駅一覧ドロップダウンの順に、上から詰めて配置する。
// （表示切り替えパネルは右上の「ピンをクリア」ボタン下に固定配置のため、ここでは扱わない）
function layoutLeftStack() {
    const infoPanel = document.querySelector('.info-panel');
    const stationWrapper = document.getElementById('stationListWrapper');
    if (!infoPanel || !stationWrapper) return;

    const gap = 12;
    const infoBottom = infoPanel.getBoundingClientRect().bottom;
    stationWrapper.style.top = `${infoBottom + gap}px`;
}
layoutLeftStack();
window.addEventListener('resize', layoutLeftStack);

// ===================================================================
// 凡例トグル
// ===================================================================
(function() {
    const tab  = document.getElementById('legendTab');
    const body = document.getElementById('legendBody');
    if (!tab || !body) return;
    tab.addEventListener('click', function() {
        const isOpen = body.classList.contains('open');
        body.classList.toggle('open');
        tab.textContent = isOpen ? '凡例 ▲' : '凡例 ▼';
    });
})();

// ===================================================================
// 現在地ボタン（手動で再取得）
// ===================================================================
(function() {
    const btn = document.getElementById('locate-btn');
    if (!btn) return;

    // file:// 環境では Geolocation が使えないためボタン非表示
    if (window.location.protocol === 'file:') {
        btn.style.display = 'none';
        return;
    }

    btn.addEventListener('click', function() {
        if (!navigator.geolocation) {
            alert('このブラウザは位置情報をサポートしていません。');
            return;
        }

        btn.disabled = true;
        btn.style.opacity = '0.4';

        navigator.geolocation.getCurrentPosition(
            function(pos) {
                btn.disabled = false;
                btn.style.opacity = '1';
                initUserPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
            },
            function(err) {
                btn.disabled = false;
                btn.style.opacity = '1';
                const messages = {
                    1: '位置情報の使用が拒否されました。\nアドレスバーの🔒から位置情報を「許可」してください。',
                    2: '位置情報を取得できませんでした。',
                    3: '位置情報の取得がタイムアウトしました。'
                };
                alert(messages[err.code] || '位置情報の取得に失敗しました。');
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    });
})();

// ===================================================================
// About モーダル
// ===================================================================
(function() {
    const overlay   = document.getElementById('aboutModal');
    const openBtn   = document.getElementById('about-btn');
    const closeBtn  = document.getElementById('modalCloseBtn');

    function openModal() { overlay.classList.add('open'); }
    function closeModal() { overlay.classList.remove('open'); }

    openBtn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);

    // 背景（オーバーレイ）クリックで閉じる
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeModal();
    });

    // Escape キーで閉じる
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeModal();
    });
})();

initAdminMode();

// ===================================================================
// 検索エリア選択モーダル（ページ読み込み時に必ず表示・ピン描画前の必須ステップ）
// ===================================================================

// 駅データ取得後に呼び出し、プルダウンへ駅名を並べる（駅は初期状態で選択不可のままにしない）
function populateAreaStationSelect(shops) {
    const select      = document.getElementById('areaStationSelect');
    const confirmBtn  = document.getElementById('areaStationConfirmBtn');
    if (!select || !confirmBtn) return;

    const stations = shops.filter(s => s.category === '駅');
    if (stations.length === 0) {
        select.innerHTML = '<option value="">駅データがありません</option>';
        return;
    }

    select.innerHTML = stations.map(st => `<option value="${escapeHtml(st.name)}">🚉 ${escapeHtml(st.name)}</option>`).join('');
    select.disabled = false;
    confirmBtn.disabled = false;
}

(function initAreaSelectModal() {
    const overlay      = document.getElementById('areaSelectModal');
    const currentBtn    = document.getElementById('areaCurrentLocationBtn');
    const statusEl       = document.getElementById('areaCurrentLocationStatus');
    const stationSelect  = document.getElementById('areaStationSelect');
    const stationConfirm = document.getElementById('areaStationConfirmBtn');
    if (!overlay || !currentBtn || !stationSelect || !stationConfirm) return;

    function closeModal() { overlay.classList.remove('open'); }

    // 現在地の取得に失敗した場合は、既定の中心地点にフォールバックする
    function fallbackToDefault(message) {
        if (statusEl) statusEl.textContent = message + ' 既定のエリアを表示します。';
        setSearchPin(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
        closeModal();
    }

    currentBtn.addEventListener('click', function() {
        if (window.location.protocol === 'file:' || !navigator.geolocation) {
            fallbackToDefault('このブラウザでは位置情報を取得できません。');
            return;
        }

        currentBtn.disabled = true;
        if (statusEl) statusEl.textContent = '📡 現在地を取得中...';

        try {
            navigator.geolocation.getCurrentPosition(
                function(pos) {
                    currentBtn.disabled = false;
                    initUserPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
                    closeModal();
                },
                function(err) {
                    currentBtn.disabled = false;
                    const messages = {
                        1: '位置情報の使用が拒否されました。',
                        2: '位置情報を取得できませんでした。',
                        3: '位置情報の取得がタイムアウトしました。'
                    };
                    fallbackToDefault(messages[err.code] || '位置情報の取得に失敗しました。');
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
        } catch (e) {
            // Geolocation API 自体が例外を投げるような環境（一部のWebView等）への保険
            currentBtn.disabled = false;
            fallbackToDefault('位置情報の取得中にエラーが発生しました。');
        }
    });

    stationConfirm.addEventListener('click', function() {
        const name = stationSelect.value;
        if (!name) { alert('駅を選択してください。'); return; }

        const station = allShops.find(s => s.category === '駅' && s.name === name);
        if (!station) { alert('選択した駅のデータが見つかりませんでした。'); return; }

        setSearchPin(station.lat, station.lon);
        closeModal();
    });

    // ページ読み込み完了時、ピンを描画する前に必ずこのモーダルを表示する
    overlay.classList.add('open');
})();

// ===================================================================
// ピン刺し再検索モード
// マップ上の空いている場所をクリックすると、その地点を新しい検索中心として
// 半径1km以内の店舗（駅は常に全件）を再描画する。ピンを1つ刺すたびにクロスヘアは
// 自動的に解除され、通常のカーソルに戻る（続けて別の場所に刺したい場合は
// 「📍ピンを刺して再検索」ボタンを再度押してクロスヘアを立て直す）。
// ===================================================================
let pinDropMode = false;

function setPinDropMode(active) {
    pinDropMode = active;
    const btn = document.getElementById('pinDropBtn');
    if (btn) {
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
    }
    map.getContainer().style.cursor = active ? 'crosshair' : '';
    setStationMarkersInteractive(!active);
}

// 駅ピンのクリック可否を一括で切り替える。ピン刺しモード中は駅ピン自身のクリックを
// 無効化し（pointer-events:none で地図側にクリックを素通しする）、駅の位置にも
// 検索ピンを刺せるようにする。モード解除時はクリック可能な状態に戻す。
function setStationMarkersInteractive(interactive) {
    stationMarkerMap.forEach(marker => {
        const el = marker.getElement();
        if (el) el.style.pointerEvents = interactive ? '' : 'none';
    });
}

(function initPinDropMode() {
    const btn = document.getElementById('pinDropBtn');
    if (!btn) return;

    btn.addEventListener('click', function() {
        if (pinDropMode) {
            // クロスヘアをOFFにするのと同時に、ピン刺しモード自体を終了してフィルターモードへ戻る
            setPinDropMode(false);
            exitPinMode();
        } else {
            setPinDropMode(true);
        }
    });

    map.on('click', function(e) {
        if (!pinDropMode) return;
        try {
            setSearchPin(e.latlng.lat, e.latlng.lng);
            // ピンを刺したらクロスヘアを解除し、通常のカーソルに戻す
            // （ピン自体・検索結果は残したまま、次のクリックが誤ってピンを動かさないようにする）
            setPinDropMode(false);
        } catch (err) {
            console.warn('[ラーメンマップ] ピン刺し再検索中にエラーが発生しました:', err.message);
        }
    });

    const clearBtn = document.getElementById('pinClearBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', function() {
            if (!isPinModeActive) return;
            setPinDropMode(false);
            exitPinMode();
        });
    }
})();
