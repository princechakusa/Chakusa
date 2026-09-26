// Builds the self-contained page that renders a Leaflet map with free
// OpenStreetMap tiles. The same page is shown in a WebView on iOS/Android
// and in an iframe on web. Map taps are posted back to the app as
// { source: 'chakusa-map', id, type: 'pick', latitude, longitude }.

export interface MapMarker {
  latitude: number;
  longitude: number;
  kind: 'you' | 'business' | 'pin';
  label?: string;
}

export interface LeafletPageOptions {
  id: string;
  center: { latitude: number; longitude: number };
  zoom?: number;
  markers?: MapMarker[];
  /** Tapping the map moves the pin and reports the new point. */
  pickable?: boolean;
  /** Fit the view to all markers instead of centring on `center`. */
  fitMarkers?: boolean;
}

export const LEAFLET_VERSION = '1.9.4';
const LEAFLET_CSS_SRI = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
const LEAFLET_JS_SRI = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';

/** JSON that is safe to embed inside a <script> element. */
export function scriptSafeJson(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}

export function leafletHtml(options: LeafletPageOptions) {
  const config = {
    id: options.id,
    center: [options.center.latitude, options.center.longitude],
    zoom: options.zoom ?? 14,
    markers: (options.markers ?? []).filter((m) => Number.isFinite(m.latitude) && Number.isFinite(m.longitude)),
    pickable: Boolean(options.pickable),
    fitMarkers: Boolean(options.fitMarkers),
  };
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css" integrity="${LEAFLET_CSS_SRI}" crossorigin="">
<script src="https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js" integrity="${LEAFLET_JS_SRI}" crossorigin=""></script>
<style>
html,body,#map{height:100%;margin:0;background:#F4F1ED}
.dot{width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3)}
.dot.business{background:#EE5D43}.dot.you{background:#2F6BFF}
.dot.you::after{content:'';position:absolute;inset:-12px;border-radius:50%;background:rgba(47,107,255,.18)}
.pin{width:26px;height:26px;border-radius:50% 50% 50% 0;background:#EE5D43;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.35)}
.leaflet-tooltip{font:600 12px -apple-system,Segoe UI,Roboto,sans-serif}
</style></head><body><div id="map" role="application" aria-label="Map"></div>
<script>
(function(){
  var cfg = ${scriptSafeJson(config)};
  function send(msg){ msg.source='chakusa-map'; msg.id=cfg.id; var s=JSON.stringify(msg);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s); else if (window.parent) window.parent.postMessage(s,'*'); }
  if (!window.L) { document.body.innerHTML='<p style="font:14px sans-serif;padding:16px">Map could not load. Check your connection.</p>'; send({type:'error'}); return; }
  var map = L.map('map',{zoomControl:true,attributionControl:true}).setView(cfg.center,cfg.zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
  function icon(kind){ return L.divIcon({className:'',html:'<div class="'+(kind==='pin'?'pin':'dot '+kind)+'"></div>',iconSize:kind==='pin'?[26,26]:[16,16],iconAnchor:kind==='pin'?[13,26]:[8,8]}); }
  var pin=null, bounds=[];
  cfg.markers.forEach(function(m){
    var mk=L.marker([m.latitude,m.longitude],{icon:icon(m.kind),keyboard:false}).addTo(map);
    if (m.label) mk.bindTooltip(m.label,{direction:'top',offset:[0,-10]});
    if (m.kind==='pin') pin=mk;
    bounds.push([m.latitude,m.longitude]);
  });
  if (cfg.fitMarkers && bounds.length>1) map.fitBounds(bounds,{padding:[36,36],maxZoom:15});
  if (cfg.pickable) map.on('click',function(e){
    if (!pin) pin=L.marker(e.latlng,{icon:icon('pin')}).addTo(map); else pin.setLatLng(e.latlng);
    send({type:'pick',latitude:e.latlng.lat,longitude:e.latlng.lng});
  });
  send({type:'ready'});
})();
</script></body></html>`;
}

export interface MapMessage { source: 'chakusa-map'; id: string; type: 'ready' | 'pick' | 'error'; latitude?: number; longitude?: number }

export function parseMapMessage(raw: unknown, id: string): MapMessage | null {
  if (typeof raw !== 'string') return null;
  try {
    const message = JSON.parse(raw) as MapMessage;
    if (message?.source !== 'chakusa-map' || message.id !== id) return null;
    if (message.type === 'pick' && !(Number.isFinite(message.latitude) && Number.isFinite(message.longitude))) return null;
    return message;
  } catch {
    return null;
  }
}
