// ===================================================================
// マップ初期化
// ===================================================================
const map = L.map('map', {
    maxZoom: 21,
    minZoom: 11,
    zoomControl: false,
    maxBounds: [[35.60, 139.70], [36.08, 140.25]],
    maxBoundsViscosity: 1.0
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
// アイコン定義
// ===================================================================

// ラーメン店用（カテゴリごとに色分け。色名は pointhi/leaflet-color-markers 準拠）
const createIcon = (color) => new L.Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.0.0/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
    shadowSize: [41, 41], shadowAnchor: [12, 41]
});
const _iconCache = {};
function getIcon(color) {
    return _iconCache[color] || (_iconCache[color] = createIcon(color));
}

// ===================================================================
// スプレッドシートデータ関連
// ===================================================================

// 公開されたGoogleスプレッドシートのCSV出力URL（このURLからデータを都度取得する）
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQHcC7BRftze6VGcNKcGoFGjd_0hSwkkchUqU4qVfwb8uUjrp0cShLY1ifvkKCmsqJFgUkOrYps5zaG/pub?gid=0&single=true&output=csv';

// カテゴリごとのピン色（未知のカテゴリはフォールバック色を順番に割り当てる）
const CATEGORY_PRESET_COLORS   = { 'チェーン店': 'red', '個人店': 'blue' };
const CATEGORY_FALLBACK_COLORS = ['green', 'orange', 'violet', 'black', 'gold'];

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
            category: rec.category || 'その他',
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
// レビュー機能（LocalStorage保存）
// ===================================================================
function reviewStorageKey(name) {
    return `ramenMapReview:${name}`;
}

function loadReview(name) {
    try {
        const raw = localStorage.getItem(reviewStorageKey(name));
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function saveReview(name, rating, comment) {
    try {
        localStorage.setItem(reviewStorageKey(name), JSON.stringify({ rating, comment, savedAt: Date.now() }));
    } catch (e) {
        console.warn('[ラーメンマップ] レビューの保存に失敗しました:', e.message);
    }
}

function buildReviewViewHtml(shop) {
    const stars = [1, 2, 3, 4, 5].map(n => `<span class="popup-star" data-value="${n}">☆</span>`).join('');
    return `
        <div class="popup-review-title">📝 ${escapeHtml(shop.name)} のレビュー</div>
        <div class="popup-review-existing"></div>
        <div class="popup-star-row">${stars}</div>
        <textarea class="popup-review-comment" rows="3" placeholder="コメントを入力してください..."></textarea>
        <div class="popup-review-actions">
            <button type="button" class="popup-btn popup-btn-orange popup-review-submit">送信</button>
            <button type="button" class="popup-btn popup-btn-grey popup-review-back">戻る</button>
        </div>
    `;
}

function wireUpReviewEvents(root, shop) {
    const infoView   = root.querySelector('.popup-info-view');
    const reviewView = root.querySelector('.popup-review-view');
    const toggleBtn  = root.querySelector('.popup-review-toggle');
    const backBtn    = root.querySelector('.popup-review-back');
    const submitBtn  = root.querySelector('.popup-review-submit');
    const commentEl  = root.querySelector('.popup-review-comment');
    const existingEl = root.querySelector('.popup-review-existing');
    const starEls    = root.querySelectorAll('.popup-star');

    let selectedRating = 0;

    function renderStars() {
        starEls.forEach(star => {
            const v = Number(star.dataset.value);
            star.textContent = v <= selectedRating ? '★' : '☆';
        });
    }

    function refreshReviewView() {
        const saved = loadReview(shop.name);
        if (saved) {
            selectedRating = saved.rating;
            commentEl.value = saved.comment || '';
            const savedDate = new Date(saved.savedAt).toLocaleDateString('ja-JP');
            existingEl.innerHTML =
                `前回の投稿（${savedDate}）：${'★'.repeat(saved.rating)}${'☆'.repeat(5 - saved.rating)}<br>${escapeHtml(saved.comment || '（コメントなし）')}`;
        } else {
            selectedRating = 0;
            commentEl.value = '';
            existingEl.innerHTML = 'まだレビューが投稿されていません。';
        }
        renderStars();
    }

    starEls.forEach(star => {
        star.addEventListener('click', () => {
            selectedRating = Number(star.dataset.value);
            renderStars();
        });
    });

    toggleBtn.addEventListener('click', () => {
        infoView.style.display = 'none';
        reviewView.style.display = 'block';
        refreshReviewView();
    });

    backBtn.addEventListener('click', () => {
        reviewView.style.display = 'none';
        infoView.style.display = 'block';
    });

    submitBtn.addEventListener('click', () => {
        if (selectedRating === 0) {
            alert('星評価を選択してください。');
            return;
        }
        saveReview(shop.name, selectedRating, commentEl.value.trim());
        refreshReviewView();
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
                <button type="button" class="popup-btn popup-btn-orange popup-review-toggle">📝 レビューを書く / 見る</button>
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
    { id: 'road6',   src: typeof route6Coords   !== 'undefined' ? route6Coords   : [], color: '#3498db', label: '国道6号',  popup: '<b>🛣️ 国道6号線</b>' },
    { id: 'road16',  src: typeof route16Coords  !== 'undefined' ? route16Coords  : [], color: '#e67e22', label: '国道16号', popup: '<b>🛣️ 国道16号線</b>' },
    { id: 'road5',   src: typeof route5Coords   !== 'undefined' ? route5Coords   : [], color: '#9b59b6', label: '流山街道', popup: '<b>🛣️ 流山街道 (県道5号)</b>' },
    { id: 'road464', src: typeof route464Coords !== 'undefined' ? route464Coords : [], color: '#e84393', label: '国道464号', popup: '<b>🛣️ 国道464号線</b>' },
    { id: 'road294', src: typeof route294Coords !== 'undefined' ? route294Coords : [], color: '#27ae60', label: '国道294号', popup: '<b>🛣️ 国道294号線</b>' },
];

roadDefs.forEach(road => { road.layer = L.layerGroup().addTo(map); });

// ===================================================================
// 駅500m圏サークル（道路ラインより先に追加して視覚的に下に配置）
// スプレッドシートの category="駅" データ取得後に buildStationCircles() で構築する
// ===================================================================
const stationCirclesLayer = L.layerGroup().addTo(map);

function buildStationCircles(stationShops) {
    stationCirclesLayer.clearLayers();
    stationShops.forEach(st => {
        L.circle([st.lat, st.lon], {
            radius: 500,
            color: '#27ae60',
            fillColor: '#27ae60',
            fillOpacity: 0.07,
            weight: 1.5,
            opacity: 0.35,
            interactive: false
        }).addTo(stationCirclesLayer);
    });
}

(async () => {
    for (const road of roadDefs) {
        if (road.src.length < 2) continue;
        const style = { color: road.color, weight: 3, opacity: 0.55 };
        try {
            const coords = await fetchRouteCoords(road.src);
            L.polyline(coords, style).bindPopup(road.popup).addTo(road.layer);
        } catch (e) {
            console.warn('OSRMルート取得失敗（直線で代替）:', road.popup, e.message);
            L.polyline(road.src, style).bindPopup(road.popup).addTo(road.layer);
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

// 駅一覧サイドバーのリストを動的に生成（周辺ラーメン店数の多い順）
// スプレッドシートからの店舗データ取得完了後に shops を渡して呼び出す
function buildStationList(shops) {
    const body = document.getElementById('stationListBody');
    if (!body) return;
    body.innerHTML = '';

    function distKm(lat1, lon1, lat2, lon2) {
        const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    const RADIUS_KM = 1.5;
    const stationShops = shops.filter(s => s.category === '駅');
    const ramenShops    = shops.filter(s => s.category !== '駅');

    const sorted = [...stationShops].sort((a, b) => {
        const countA = ramenShops.filter(s => distKm(a.lat, a.lon, s.lat, s.lon) <= RADIUS_KM).length;
        const countB = ramenShops.filter(s => distKm(b.lat, b.lon, s.lat, s.lon) <= RADIUS_KM).length;
        return countB - countA;
    });

    sorted.forEach(st => {
        const item = document.createElement('div');
        item.className = 'station-list-item';
        item.textContent = `🚉 ${st.name}`;
        item.addEventListener('click', () => {
            closeSidebar();
            map.flyTo([st.lat, st.lon], 15, { duration: 1.0 });
            const marker = stationMarkerMap.get(st.name);
            if (marker) setTimeout(() => marker.openPopup(), 1100);
        });
        body.appendChild(item);
    });
}

// 駅一覧サイドバーの開閉制御
function openSidebar() {
    document.getElementById('stationSidebar').classList.add('open');
    document.getElementById('stationSidebarOverlay').classList.add('open');
}
function closeSidebar() {
    document.getElementById('stationSidebar').classList.remove('open');
    document.getElementById('stationSidebarOverlay').classList.remove('open');
}

document.getElementById('stationToggleBtn').addEventListener('click', openSidebar);
document.getElementById('stationSidebarClose').addEventListener('click', closeSidebar);
document.getElementById('stationSidebarOverlay').addEventListener('click', closeSidebar);

// ===================================================================
// 現在地ロジック
// ===================================================================

const MAP_BOUNDS = [[35.60, 139.70], [36.08, 140.25]];

let userPos        = null;
let locationMarker = null;
let locationCircle = null;

// ---- ユーザーマーカーを地図に表示 ----
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

// ---- 現在地を初期化（成功・フォールバック共通エントリポイント） ----
function initUserPosition(lat, lng, accuracy) {
    userPos         = { lat, lng };
    showUserMarker(lat, lng, accuracy);

    // マップをユーザー位置に移動（maxBounds を一時解除して飛ぶ）
    map.setMaxBounds(null);
    map.flyTo([lat, lng], 15, { duration: 1.5 });
    map.once('moveend', function() {
        if (L.latLngBounds(MAP_BOUNDS).contains([lat, lng])) {
            map.setMaxBounds(MAP_BOUNDS);
        }
    });
}

// ===================================================================
// ラーメン店マーカー（カテゴリ別クラスター + クリック時ズームイン）
// ===================================================================
function makeClusterOptions(theme) {
    const prefix = theme === 'chain' ? 'chain-' : '';
    return {
        maxClusterRadius: 80,
        disableClusteringAtZoom: 17,
        showCoverageOnHover: false,
        iconCreateFunction: function(cluster) {
            const count = cluster.getChildCount();
            let suffix, size;
            if (count < 5)       { suffix = 'low';  size = 32; }
            else if (count < 20) { suffix = 'mid';  size = 40; }
            else                 { suffix = 'high'; size = 50; }
            return L.divIcon({
                html: `<div class="cluster-inner">${count}</div>`,
                className: `marker-cluster-custom cluster-${prefix}${suffix}`,
                iconSize: L.point(size, size)
            });
        }
    };
}

// カテゴリ名 → { cluster, color } を保持する（登場順にフォールバック色を割り当てる）
const categoryClusters = new Map();

function getOrCreateCategoryCluster(category) {
    if (categoryClusters.has(category)) return categoryClusters.get(category);

    const usedColors = new Set([...categoryClusters.values()].map(v => v.color));
    const color = CATEGORY_PRESET_COLORS[category] ||
        CATEGORY_FALLBACK_COLORS.find(c => !usedColors.has(c)) || 'grey';
    const theme = category === 'チェーン店' ? 'chain' : '';

    // 駅はクラスター化せず、常に個々のピンをそのまま表示する
    const layer = category === '駅'
        ? L.layerGroup()
        : L.markerClusterGroup(makeClusterOptions(theme));

    const entry = { cluster: layer, color };
    categoryClusters.set(category, entry);
    return entry;
}

function setCategoryVisible(category, checked) {
    const entry = categoryClusters.get(category);
    if (!entry) return;
    checked ? entry.cluster.addTo(map) : map.removeLayer(entry.cluster);
}

// カテゴリ名 → そのカテゴリのチェックボックス群（凡例・表示切り替えパネルの両方に存在するため同期させる）
const categoryCheckboxes = new Map();

function registerCategoryCheckbox(category, input) {
    if (!categoryCheckboxes.has(category)) categoryCheckboxes.set(category, new Set());
    categoryCheckboxes.get(category).add(input);
    input.addEventListener('change', function() {
        setCategoryVisible(category, this.checked);
        categoryCheckboxes.get(category).forEach(cb => { if (cb !== this) cb.checked = this.checked; });
    });
}

function buildCategoryToggleItem(itemClass, pinClass, category, color) {
    const label = document.createElement('label');
    label.className = itemClass;
    label.innerHTML = `
        <input type="checkbox" checked>
        <img class="${pinClass}" src="https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png">
        <span style="font-size:12px; color:#333;">${escapeHtml(category)}</span>
    `;
    registerCategoryCheckbox(category, label.querySelector('input'));
    return label;
}

// 凡例（右下）と表示切り替えパネル（左）の両方にカテゴリごとのチェックボックスを生成する
function buildCategoryLegend() {
    const legendContainer = document.getElementById('legendCategoryItems');
    const filterContainer = document.getElementById('filterCategoryItems');
    if (legendContainer) legendContainer.innerHTML = '';
    if (filterContainer) filterContainer.innerHTML = '';
    categoryCheckboxes.clear();

    categoryClusters.forEach(({ color }, category) => {
        if (legendContainer) {
            legendContainer.appendChild(buildCategoryToggleItem('legend-item legend-item-cb', 'legend-pin', category, color));
        }
        if (filterContainer) {
            filterContainer.appendChild(buildCategoryToggleItem('filter-item', 'filter-pin', category, color));
        }
    });
}

// スプレッドシートからデータを取得し、マーカー・凡例・駅一覧を構築する
(async function initShopData() {
    let shops = [];
    try {
        shops = await loadShopsFromSheet();
    } catch (e) {
        console.error('[ラーメンマップ] スプレッドシートの取得に失敗しました:', e);
        showDataError();
    }

    shops.forEach(shop => {
        const { cluster, color } = getOrCreateCategoryCluster(shop.category);
        const marker = L.marker([shop.lat, shop.lon], { icon: getIcon(color) });

        // 関数を渡すことで、ポップアップを開くたびに最新のレビュー内容を反映する
        marker.bindPopup(() => buildRichPopupElement(shop));

        marker.on('click', function() {
            map.flyTo([shop.lat, shop.lon], Math.max(map.getZoom(), 16), { duration: 0.7 });
        });

        cluster.addLayer(marker);
        if (shop.category === '駅') stationMarkerMap.set(shop.name, marker);
    });

    categoryClusters.forEach(({ cluster }) => cluster.addTo(map));
    buildCategoryLegend();
    buildStationCircles(shops.filter(s => s.category === '駅'));
    buildStationList(shops);
})();

// ===================================================================
// フィルターコントロール（タイトル・駅一覧タブのすぐ下に配置）
// ===================================================================
function buildFilterPanel() {
    const container = L.DomUtil.create('div', 'filter-panel');
    container.id = 'filterPanel';
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    const roadSubHtml = roadDefs.map(road => `
        <label class="filter-item filter-sub-item">
            <input type="checkbox" id="${road.id}Filter" checked>
            <div class="filter-road-line-icon" style="background:${road.color};"></div>
            <span>${road.label}</span>
        </label>
    `).join('');

    container.innerHTML = `
        <div class="filter-title">表示切り替え</div>
        <div id="filterCategoryItems">
            <div class="filter-item" style="color:#999;">カテゴリ読み込み中...</div>
        </div>
        <div class="filter-divider"></div>
        <div class="filter-roads-header">
            <label class="filter-item" style="margin:0;flex:1;">
                <input type="checkbox" id="roadsFilter" checked>
                <div class="filter-road-line-icon"></div>
                <span>国道・街道</span>
            </label>
            <button class="filter-roads-toggle" id="roadsToggle" title="個別切替">▼</button>
        </div>
        <div class="filter-roads-sub" id="roadsSub">
            ${roadSubHtml}
        </div>
    `;

    const masterCb = container.querySelector('#roadsFilter');
    masterCb.addEventListener('change', function() {
        roadDefs.forEach(road => {
            const cb = container.querySelector(`#${road.id}Filter`);
            cb.checked = this.checked;
            this.checked ? road.layer.addTo(map) : map.removeLayer(road.layer);
        });
    });

    roadDefs.forEach(road => {
        container.querySelector(`#${road.id}Filter`).addEventListener('change', function() {
            this.checked ? road.layer.addTo(map) : map.removeLayer(road.layer);
            const checkedCount = roadDefs.filter(r => container.querySelector(`#${r.id}Filter`).checked).length;
            masterCb.indeterminate = checkedCount > 0 && checkedCount < roadDefs.length;
            masterCb.checked = checkedCount === roadDefs.length;
        });
    });

    const toggleBtn = container.querySelector('#roadsToggle');
    const subPanel  = container.querySelector('#roadsSub');
    toggleBtn.addEventListener('click', function() {
        const isOpen = subPanel.classList.toggle('open');
        toggleBtn.textContent = isOpen ? '▲' : '▼';
    });

    document.body.appendChild(container);
    return container;
}
buildFilterPanel();

// タイトル枠 → 駅一覧タブ → 表示切り替え枠の順に、上から詰めて配置する。
// 各枠は top を固定値で持つため、国道・街道の折りたたみを開閉しても
// 自分より上にある枠の位置は動かない。
function layoutLeftStack() {
    const infoPanel   = document.querySelector('.info-panel');
    const stationTab  = document.getElementById('stationToggleBtn');
    const filterPanel = document.getElementById('filterPanel');
    if (!infoPanel || !stationTab || !filterPanel) return;

    const gap = 12;
    const infoBottom = infoPanel.getBoundingClientRect().bottom;
    stationTab.style.top = `${infoBottom + gap}px`;

    const stationBottom = stationTab.getBoundingClientRect().bottom;
    filterPanel.style.top = `${stationBottom + gap}px`;
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

// ===================================================================
// ページ読み込み時の自動位置情報取得
// ===================================================================
(function initGeolocation() {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
        function(pos) {
            initUserPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        },
        function(err) {
            console.warn('[ラーメンマップ] 位置情報の取得に失敗しました（' + err.message + '）。');
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
})();
