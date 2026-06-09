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

// === タイルレイヤー（標準カラー・日本語地図：国土地理院） ===
L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>',
    maxZoom: 21,
    maxNativeZoom: 18
}).addTo(map);

// ===================================================================
// アイコン定義
// ===================================================================

// ラーメン店用（赤・青ピン）
const createIcon = (color) => new L.Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.0.0/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
    shadowSize: [41, 41], shadowAnchor: [12, 41]
});
const redIcon  = createIcon('red');
const blueIcon = createIcon('blue');

// 駅用（グレーピン：ラーメン店と完全に同形・同サイズ、外部URL不要のSVG）
const _GREY_PIN_URL = 'data:image/svg+xml;base64,' + btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 41">' +
    '<path fill="#808080" stroke="white" stroke-width="1.5"' +
    ' d="M12.5 1C6.2 1 1 6.2 1 12.5c0 8.4 11.5 27.5 11.5 27.5S24 20.9 24 12.5C24 6.2 18.8 1 12.5 1z"/>' +
    '<circle fill="white" cx="12.5" cy="12.5" r="4.5"/>' +
    '</svg>'
);
const stationIcon = new L.Icon({
    iconUrl: _GREY_PIN_URL,
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.0.0/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
    shadowSize: [41, 41], shadowAnchor: [12, 41]
});

// 最寄り店ハイライト用（脈動アニメーション付き）
const highlightIcon = L.divIcon({
    html: '<div class="highlight-pulse">🍜</div>',
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -22]
});

// ===================================================================
// ポップアップ用ヘルパー関数
// ===================================================================
function renderGenre(genre) {
    if (!genre) return '<span style="color:#aaa;">情報なし</span>';
    return `<span style="display:inline-block;background:#fff3e0;color:#e65100;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:bold;border:1px solid #ffcc80;">${genre}</span>`;
}

function renderHours(hours) {
    if (!hours || hours === '店舗情報参照') return '<span style="color:#aaa;">店舗情報参照</span>';
    const isLateNight = /翌|24時間/.test(hours);
    if (isLateNight) {
        return `${hours}&nbsp;<span style="display:inline-block;background:#c0392b;color:#fff;font-size:9px;padding:1px 5px;border-radius:3px;font-weight:bold;white-space:nowrap;vertical-align:middle;">🌙深夜営業</span>`;
    }
    return hours;
}

function renderParking(parking) {
    if (!parking) return '<span style="color:#aaa;">情報なし</span>';
    if (/なし/.test(parking)) return '<span style="color:#e74c3c;">❌ なし</span>';
    return `<span style="color:#27ae60;">✅ ${parking}</span>`;
}

// ポップアップ HTML を組み立てる（マーカーとハイライト両用）
function buildPopupContent(shop) {
    if (!shop || typeof chainKeywords === 'undefined') return '';
    const isChain       = chainKeywords.some(kw => shop.name.includes(kw));
    const borderColor   = isChain ? '#3498db' : '#e74c3c';
    const shopType      = isChain ? '🏢 大手チェーン店' : '🍜 個人店・独立系';
    const shopTypeColor = isChain ? '#2980b9' : '#c0392b';
    const searchUrl     = `https://www.google.com/search?q=${encodeURIComponent(shop.address.substring(0, 3) + ' ' + shop.name)}`;
    return `
        <div style="font-family:sans-serif;min-width:240px;max-width:300px;">
            <p style="margin:0 0 4px 0;font-size:11px;color:${shopTypeColor};font-weight:bold;">${shopType}</p>
            <h3 style="margin:0 0 8px 0;font-size:15px;border-bottom:2px solid ${borderColor};padding-bottom:4px;color:#333;">${shop.name}</h3>
            <p style="margin:4px 0;font-size:12px;color:#333;"><b>🍜 ジャンル:</b> ${renderGenre(shop.genre)}</p>
            <p style="margin:4px 0;font-size:12px;color:#333;word-wrap:break-word;"><b>📍 住所:</b> ${shop.address}</p>
            <p style="margin:4px 0;font-size:12px;color:#333;"><b>🕒 営業時間:</b><br>${renderHours(shop.hours)}</p>
            <p style="margin:4px 0;font-size:12px;color:#333;background:#f8f9fa;padding:4px 6px;border-radius:3px;"><b>🚗 駐車場:</b> ${renderParking(shop.parking)}</p>
            <div style="margin-top:10px;text-align:center;">
                <a href="${searchUrl}" target="_blank"
                   style="display:inline-block;padding:6px 12px;background:#4285F4;color:white;text-decoration:none;border-radius:4px;font-size:12px;font-weight:bold;">
                   🔍 詳細を検索
                </a>
            </div>
        </div>
    `;
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
    { src: typeof route6Coords   !== 'undefined' ? route6Coords   : [], color: '#3498db', popup: '<b>🛣️ 国道6号線</b>' },
    { src: typeof route16Coords  !== 'undefined' ? route16Coords  : [], color: '#e67e22', popup: '<b>🛣️ 国道16号線</b>' },
    { src: typeof route5Coords   !== 'undefined' ? route5Coords   : [], color: '#9b59b6', popup: '<b>🛣️ 流山街道 (県道5号)</b>' },
    { src: typeof route464Coords !== 'undefined' ? route464Coords : [], color: '#e84393', popup: '<b>🛣️ 国道464号線</b>' },
    { src: typeof route294Coords !== 'undefined' ? route294Coords : [], color: '#27ae60', popup: '<b>🛣️ 国道294号線</b>' },
];

const roadsLayerGroup = L.layerGroup().addTo(map);

(async () => {
    for (const road of roadDefs) {
        if (road.src.length < 2) continue;
        const style = { color: road.color, weight: 5, opacity: 0.75 };
        try {
            const coords = await fetchRouteCoords(road.src);
            L.polyline(coords, style).bindPopup(road.popup).addTo(roadsLayerGroup);
        } catch (e) {
            console.warn('OSRMルート取得失敗（直線で代替）:', road.popup, e.message);
            L.polyline(road.src, style).bindPopup(road.popup).addTo(roadsLayerGroup);
        }
        await new Promise(r => setTimeout(r, 250));
    }
})();

// ===================================================================
// 駅レイヤー
// ===================================================================
const stationsLayerGroup = L.layerGroup().addTo(map);
if (typeof stations !== 'undefined') {
    stations.forEach(st => {
        L.marker([st.lat, st.lon], { icon: stationIcon })
            .bindPopup(`<b>🚉 ${st.name}駅</b>`)
            .addTo(stationsLayerGroup);
    });
}

// ===================================================================
// 現在地 & 最寄り店ロジック
// ===================================================================

/** ダミー現在地：ローカルや Geolocation 失敗時に使用（柏駅） */
const FALLBACK_POS = { lat: 35.8624, lng: 139.9773 };
const MAP_BOUNDS   = [[35.60, 139.70], [36.08, 140.25]];

let userPos             = null;   // { lat, lng }
let currentMode         = 'car';  // タブ選択状態
let locationMarker      = null;
let locationCircle      = null;
let highlightMarker     = null;

// ---- Haversine 距離（km） ----
function haversineKm(lat1, lng1, lat2, lng2) {
    const R    = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a    = Math.sin(dLat / 2) ** 2
               + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
               * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---- 直線距離で最寄り店（車・徒歩共用） ----
// 将来的に Google Maps Directions API に差し替えやすい構造にしてある
function findNearestDirect(fromLat, fromLng) {
    if (typeof ramenShops === 'undefined') return null;
    let nearest = null, minDist = Infinity;
    ramenShops.forEach(shop => {
        const d = haversineKm(fromLat, fromLng, shop.lat, shop.lon);
        if (d < minDist) { minDist = d; nearest = shop; }
    });
    return nearest ? { shop: nearest, distance: minDist } : null;
}

// ---- 最寄り駅経由で最寄り店（電車モード） ----
// 将来的に乗換案内 API に差し替えやすい構造にしてある
function findNearestByTrain(fromLat, fromLng) {
    if (typeof stations === 'undefined' || typeof ramenShops === 'undefined') return null;

    // Step1: 現在地から最寄り駅を探す
    let nearestSt = null, minStDist = Infinity;
    stations.forEach(st => {
        const d = haversineKm(fromLat, fromLng, st.lat, st.lon);
        if (d < minStDist) { minStDist = d; nearestSt = st; }
    });
    if (!nearestSt) return null;

    // Step2: その駅から最寄りのラーメン店を探す
    let nearest = null, minDist = Infinity;
    ramenShops.forEach(shop => {
        const d = haversineKm(nearestSt.lat, nearestSt.lon, shop.lat, shop.lon);
        if (d < minDist) { minDist = d; nearest = shop; }
    });

    return nearest
        ? { shop: nearest, distance: minDist, via: nearestSt.name, stationDist: minStDist }
        : null;
}

// ---- 最寄り店ハイライトマーカーを更新 ----
function highlightShopOnMap(shop) {
    if (highlightMarker) { map.removeLayer(highlightMarker); highlightMarker = null; }
    if (!shop) return;
    highlightMarker = L.marker([shop.lat, shop.lon], { icon: highlightIcon, zIndexOffset: 2000 })
        .bindPopup(buildPopupContent(shop))
        .addTo(map);
}

// ---- 「地図で見る」ボタン用グローバル関数 ----
window.focusNearestShop = function() {
    const shop = window._nearestShop;
    if (!shop) return;
    map.flyTo([shop.lat, shop.lon], 16, { duration: 1.0 });
    if (highlightMarker) setTimeout(() => highlightMarker.openPopup(), 1100);
};

// ---- 最寄りパネルの表示を更新 ----
function updateNearestPanel(mode) {
    const resultDiv = document.getElementById('nearestResult');
    if (!resultDiv || !userPos) return;

    let result, modeNote, isDummy;
    isDummy = userPos._isDummy;

    if (mode === 'train') {
        result   = findNearestByTrain(userPos.lat, userPos.lng);
        modeNote = result && result.via
            ? `最寄り駅 <strong>${result.via}駅</strong> 周辺`
            : '電車利用の最短距離';
    } else {
        result   = findNearestDirect(userPos.lat, userPos.lng);
        modeNote = mode === 'walk'
            ? '徒歩（直線距離）'
            : '車（直線距離）';
    }

    if (!result || !result.shop) {
        resultDiv.innerHTML = '<p class="nearest-empty">店舗が見つかりませんでした</p>';
        return;
    }

    const shop      = result.shop;
    const dist      = result.distance.toFixed(1);
    const isChain   = typeof chainKeywords !== 'undefined' && chainKeywords.some(kw => shop.name.includes(kw));
    const typeEmoji = isChain ? '🏢' : '🍜';
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(shop.address.substring(0, 3) + ' ' + shop.name)}`;

    window._nearestShop = shop;

    resultDiv.innerHTML = `
        <div class="nearest-dist-row">📏 <strong>${dist} km</strong> ／ ${modeNote}</div>
        <div class="nearest-name">${typeEmoji} ${shop.name}</div>
        ${shop.genre ? `<div class="nearest-genre-row">${renderGenre(shop.genre)}</div>` : ''}
        <div class="nearest-addr">📍 ${shop.address}</div>
        <div class="nearest-hrs">🕒 ${renderHours(shop.hours)}</div>
        <div class="nearest-actions">
            <button class="nbtn nbtn-map" onclick="focusNearestShop()">🗺️ 地図で見る</button>
            <a class="nbtn nbtn-search" href="${searchUrl}" target="_blank">🔍 検索</a>
        </div>
        ${isDummy ? '<p class="nearest-pos-note">📍 柏駅を仮の現在地として使用</p>' : ''}
    `;

    highlightShopOnMap(shop);
}

// ---- ユーザーマーカーを地図に表示 ----
function showUserMarker(lat, lng, isDummy, accuracy) {
    if (locationMarker) { map.removeLayer(locationMarker); locationMarker = null; }
    if (locationCircle) { map.removeLayer(locationCircle); locationCircle = null; }

    locationMarker = L.circleMarker([lat, lng], {
        radius: 9, color: '#fff', weight: 2.5, fillColor: '#2979FF', fillOpacity: 1
    })
    .addTo(map)
    .bindPopup(isDummy ? '📍 現在地（ダミー：柏駅）' : '📍 現在地');

    if (!isDummy && accuracy) {
        locationCircle = L.circle([lat, lng], {
            radius: accuracy, color: '#2979FF', fillColor: '#2979FF',
            fillOpacity: 0.12, weight: 1
        }).addTo(map);
    }
}

// ---- 現在地を初期化（成功・フォールバック共通エントリポイント） ----
function initUserPosition(lat, lng, isDummy, accuracy) {
    userPos         = { lat, lng, _isDummy: isDummy };
    showUserMarker(lat, lng, isDummy, accuracy);

    // マップをユーザー位置に移動（maxBounds を一時解除して飛ぶ）
    map.setMaxBounds(null);
    map.flyTo([lat, lng], isDummy ? 13 : 15, { duration: 1.5 });
    map.once('moveend', function() {
        if (L.latLngBounds(MAP_BOUNDS).contains([lat, lng])) {
            map.setMaxBounds(MAP_BOUNDS);
        }
    });

    // 最寄り店パネルを更新
    updateNearestPanel(currentMode);
}

// ===================================================================
// ラーメン店マーカー（クラスター + クリック時ズームイン）
// ===================================================================
function makeClusterOptions() {
    return {
        maxClusterRadius: 80,
        disableClusteringAtZoom: 17,
        showCoverageOnHover: false,
        iconCreateFunction: function(cluster) {
            const count = cluster.getChildCount();
            let cls, size;
            if (count < 5)       { cls = 'cluster-low';  size = 32; }
            else if (count < 20) { cls = 'cluster-mid';  size = 40; }
            else                 { cls = 'cluster-high'; size = 50; }
            return L.divIcon({
                html: `<div class="cluster-inner">${count}</div>`,
                className: `marker-cluster-custom ${cls}`,
                iconSize: L.point(size, size)
            });
        }
    };
}

const chainCluster      = L.markerClusterGroup(makeClusterOptions());
const individualCluster = L.markerClusterGroup(makeClusterOptions());

if (typeof ramenShops !== 'undefined' && typeof chainKeywords !== 'undefined') {
    ramenShops.forEach(shop => {
        const isChain = chainKeywords.some(kw => shop.name.includes(kw));
        const marker  = L.marker([shop.lat, shop.lon], { icon: isChain ? blueIcon : redIcon })
            .bindPopup(buildPopupContent(shop));

        // ピンクリック時：スムーズにズームイン（最低 zoom 16 まで拡大）
        marker.on('click', function() {
            map.flyTo([shop.lat, shop.lon], Math.max(map.getZoom(), 16), { duration: 0.7 });
        });

        if (isChain) chainCluster.addLayer(marker);
        else         individualCluster.addLayer(marker);
    });

    chainCluster.addTo(map);
    individualCluster.addTo(map);
}

// ===================================================================
// フィルターコントロール（右上）
// ===================================================================
const FilterControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function() {
        const container = L.DomUtil.create('div', 'filter-panel');
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        container.innerHTML = `
            <div class="filter-title">表示切り替え</div>
            <label class="filter-item">
                <input type="checkbox" id="chainFilter" checked>
                <img class="filter-pin"
                     src="https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png">
                <span>チェーン店</span>
            </label>
            <label class="filter-item">
                <input type="checkbox" id="individualFilter" checked>
                <img class="filter-pin"
                     src="https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png">
                <span>個人店</span>
            </label>
            <div class="filter-divider"></div>
            <label class="filter-item">
                <input type="checkbox" id="stationFilter" checked>
                <img class="filter-pin" src="${_GREY_PIN_URL}">
                <span>駅</span>
            </label>
            <label class="filter-item">
                <input type="checkbox" id="roadsFilter" checked>
                <div class="filter-road-line-icon"></div>
                <span>国道・街道</span>
            </label>
        `;

        container.querySelector('#chainFilter').addEventListener('change', function() {
            this.checked ? chainCluster.addTo(map) : map.removeLayer(chainCluster);
        });
        container.querySelector('#individualFilter').addEventListener('change', function() {
            this.checked ? individualCluster.addTo(map) : map.removeLayer(individualCluster);
        });
        container.querySelector('#stationFilter').addEventListener('change', function() {
            this.checked ? stationsLayerGroup.addTo(map) : map.removeLayer(stationsLayerGroup);
        });
        container.querySelector('#roadsFilter').addEventListener('change', function() {
            this.checked ? roadsLayerGroup.addTo(map) : map.removeLayer(roadsLayerGroup);
        });

        return container;
    }
});
new FilterControl().addTo(map);

// ===================================================================
// 最寄りパネルのタブ切り替え
// ===================================================================
document.querySelectorAll('.nearest-tab').forEach(tab => {
    tab.addEventListener('click', function() {
        document.querySelectorAll('.nearest-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        currentMode = this.dataset.mode;
        updateNearestPanel(currentMode);
    });
});

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
                initUserPosition(pos.coords.latitude, pos.coords.longitude, false, pos.coords.accuracy);
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
// ページ読み込み時の自動位置情報取得
//   - HTTPS 環境（GitHub Pages 等）: Geolocation API を試みる
//   - file:// 環境やブロック時: 柏駅をダミー現在地として使用
// ===================================================================
(function initGeolocation() {
    // ローカルファイルまたは API 非対応の場合は即フォールバック
    if (window.location.protocol === 'file:' || !navigator.geolocation) {
        console.warn(
            '[ラーメンマップ] Geolocation 非対応またはローカルファイル環境です。' +
            '柏駅（35.8624, 139.9773）をダミー現在地として使用します。'
        );
        setTimeout(() => initUserPosition(FALLBACK_POS.lat, FALLBACK_POS.lng, true, null), 400);
        return;
    }

    navigator.geolocation.getCurrentPosition(
        function(pos) {
            console.info('[ラーメンマップ] 現在地を取得しました。');
            initUserPosition(pos.coords.latitude, pos.coords.longitude, false, pos.coords.accuracy);
        },
        function(err) {
            console.warn(
                '[ラーメンマップ] 位置情報の取得に失敗しました（' + err.message + '）。' +
                '柏駅をダミー現在地として使用します。'
            );
            alert('位置情報の取得に失敗しました: ' + err.message);
            initUserPosition(FALLBACK_POS.lat, FALLBACK_POS.lng, true, null);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
})();
