// 凡例の先頭に緑ピン（駅）を追加
const stationLegendItem = document.createElement('div');
stationLegendItem.className = 'legend-item';
stationLegendItem.innerHTML = '<img class="legend-pin" src="https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png"><span style="font-size:12px; color:#333;">駅</span>';
const legend = document.querySelector('.legend');
legend.insertBefore(stationLegendItem, legend.firstChild);

// === マップ初期化（余白を作って端のピンも中心に持ってこれる設定） ===
const map = L.map('map', {
    maxZoom: 21,
    minZoom: 11,
    zoomControl: false,
    maxBounds: [[35.60, 139.70], [36.08, 140.25]],
    maxBoundsViscosity: 1.0
}).setView([35.8500, 140.0000], 12);

L.control.zoom({ position: 'topright' }).addTo(map);

// === タイルレイヤー（衛星写真） ===
L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    subdomains: ['0', '1', '2', '3'],
    attribution: 'Map data &copy; Google',
    maxZoom: 21,
    maxNativeZoom: 21
}).addTo(map);

// === カスタムアイコン定義 ===
const createIcon = (color) => new L.Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.0.0/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41], shadowAnchor: [12, 41]
});
const redIcon = createIcon('red');
const blueIcon = createIcon('blue');
const greenIcon = createIcon('green');

// === 道路ネットワークの描画（OSRMによる実道路ジオメトリ取得） ===

/**
 * OSRM公開APIに経由地点を渡し、実際の道路に沿った座標列を返す。
 * GeoJSONは [lon, lat] 順なので Leaflet 用の [lat, lon] に変換して返す。
 */
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

(async () => {
    for (const road of roadDefs) {
        if (road.src.length < 2) continue;
        const style = { color: road.color, weight: 6, opacity: 0.7 };
        try {
            const coords = await fetchRouteCoords(road.src);
            L.polyline(coords, style).bindPopup(road.popup).addTo(map);
        } catch (e) {
            // API失敗時は元の直線座標でフォールバック描画
            console.warn('OSRMルート取得失敗（直線で代替）:', road.popup, e.message);
            L.polyline(road.src, style).bindPopup(road.popup).addTo(map);
        }
        // 公開APIへの連続リクエストを避けるための間隔
        await new Promise(r => setTimeout(r, 250));
    }
})();

// === 駅の描画（駅中心に半径600mの円バッファを生成） ===
if (typeof stations !== 'undefined') {
    stations.forEach(st => {
        L.marker([st.lat, st.lon], { icon: greenIcon }).bindPopup(`<b>🚉 ${st.name}駅</b>`).addTo(map);
    });
}

// === ラーメン店の描画 (クラスター機能) ===
const clusterOptions = { maxClusterRadius: 80, disableClusteringAtZoom: 17, showCoverageOnHover: false };
const chainCluster = L.markerClusterGroup(clusterOptions);
const individualCluster = L.markerClusterGroup(clusterOptions);

if (typeof ramenShops !== 'undefined' && typeof chainKeywords !== 'undefined') {
    ramenShops.forEach(shop => {
        const isChain = chainKeywords.some(keyword => shop.name.includes(keyword));
        const markerIcon = isChain ? blueIcon : redIcon;
        const borderColor = isChain ? "#3498db" : "#e74c3c";
        const shopType = isChain ? "🏢 大手チェーン店" : "🍜 個人店・独立系";
        const shopTypeColor = isChain ? "#2980b9" : "#c0392b";
        const parkingInfo = shop.parking || "情報なし";
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(shop.address.substring(0, 3) + ' ' + shop.name)}`;

        const popupContent = `
            <div style="font-family: sans-serif; min-width: 240px; max-width: 300px;">
                <p style="margin: 0 0 4px 0; font-size: 11px; color: ${shopTypeColor}; font-weight: bold;">${shopType}</p>
                <h3 style="margin: 0 0 8px 0; font-size: 15px; border-bottom: 2px solid ${borderColor}; padding-bottom: 4px; color:#333;">${shop.name}</h3>
                <p style="margin: 4px 0; font-size: 12px; color:#333; word-wrap: break-word;"><b>📍 住所:</b> ${shop.address}</p>
                <p style="margin: 4px 0; font-size: 12px; color:#333;"><b>🕒 営業:</b><br>${shop.hours}</p>
                <p style="margin: 4px 0; font-size: 12px; color:#333; background-color: #f1f2f6; padding: 4px 6px; border-radius: 3px;"><b>🚗 駐車場:</b> ${parkingInfo}</p>
                <div style="margin-top: 10px; text-align: center;">
                    <a href="${searchUrl}" target="_blank" style="display: inline-block; padding: 6px 12px; background-color: #4285F4; color: white; text-decoration: none; border-radius: 4px; font-size: 12px; font-weight: bold;">🔍 詳細を検索</a>
                </div>
            </div>
        `;
        const marker = L.marker([shop.lat, shop.lon], { icon: markerIcon }).bindPopup(popupContent);
        if (isChain) {
            chainCluster.addLayer(marker);
        } else {
            individualCluster.addLayer(marker);
        }
    });
    chainCluster.addTo(map);
    individualCluster.addTo(map);
}

// === フィルターコントロール ===
const FilterControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function() {
        const container = L.DomUtil.create('div', 'filter-panel');
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        container.innerHTML = `
            <div class="filter-title">ピン表示</div>
            <label class="filter-item">
                <input type="checkbox" id="chainFilter" checked>
                <img class="filter-pin" src="https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png">
                <span>チェーン店</span>
            </label>
            <label class="filter-item">
                <input type="checkbox" id="individualFilter" checked>
                <img class="filter-pin" src="https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png">
                <span>個人店</span>
            </label>
        `;
        container.querySelector('#chainFilter').addEventListener('change', function() {
            this.checked ? chainCluster.addTo(map) : map.removeLayer(chainCluster);
        });
        container.querySelector('#individualFilter').addEventListener('change', function() {
            this.checked ? individualCluster.addTo(map) : map.removeLayer(individualCluster);
        });
        return container;
    }
});
new FilterControl().addTo(map);

// === 現在地ボタン ===
let locationMarker = null;
let locationCircle = null;
const MAP_BOUNDS = [[35.60, 139.70], [36.08, 140.25]];

(function() {
    const btn = document.getElementById('locate-btn');
    if (!btn) return;

    // file:// で開かれた場合はボタンを非表示にして終了
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
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                const accuracy = pos.coords.accuracy;

                btn.disabled = false;
                btn.style.opacity = '1';

                if (locationMarker) { map.removeLayer(locationMarker); locationMarker = null; }
                if (locationCircle) { map.removeLayer(locationCircle); locationCircle = null; }

                locationMarker = L.circleMarker([lat, lng], {
                    radius: 9,
                    color: '#fff',
                    weight: 2.5,
                    fillColor: '#2979FF',
                    fillOpacity: 1
                }).addTo(map).bindPopup('📍 現在地').openPopup();

                locationCircle = L.circle([lat, lng], {
                    radius: accuracy,
                    color: '#2979FF',
                    fillColor: '#2979FF',
                    fillOpacity: 0.12,
                    weight: 1
                }).addTo(map);

                map.setMaxBounds(null);
                map.flyTo([lat, lng], 15, { duration: 1.5 });

                if (L.latLngBounds(MAP_BOUNDS).contains([lat, lng])) {
                    map.once('moveend', function() { map.setMaxBounds(MAP_BOUNDS); });
                }
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