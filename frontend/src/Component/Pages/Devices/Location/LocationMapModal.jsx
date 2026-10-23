import React, { useState, useEffect, useRef } from 'react';
import { Modal, Spin, Tag, Button, Tooltip } from 'antd';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import Cookies from 'js-cookie';
import { deviceApi } from '../../../../utils/axiosInstance';
import { GO2RTC_URL, STREAMING_API_URL } from '../../../../config';
import {
  VideoCameraOutlined,
  EnvironmentOutlined,
  AimOutlined,
  CloseOutlined,
  GlobalOutlined,
  AppstoreOutlined,
  CheckCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';

// Ensure Leaflet default icons work
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const LocationMapModal = ({ open, onClose, location }) => {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);

  const [loading, setLoading] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [selectedCam, setSelectedCam] = useState(null);
  const [tileLayerType, setTileLayerType] = useState('street'); // 'street' | 'satellite'

  const userId = Cookies.get('userId');

  // Fetch cameras from backend
  useEffect(() => {
    if (!open || !userId) return;

    const fetchCameras = async () => {
      setLoading(true);
      try {
        const res = await deviceApi.get('/Camera/', {
          params: { userid: userId, page: 1, page_size: 100, pageSize: 100 },
        });
        const list = res.data?.results || res.data || [];
        setCameras(Array.isArray(list) ? list : []);
      } catch (err) {
        console.error('Failed to fetch cameras for location map:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCameras();
  }, [open, userId]);

  // STRICT LOCATION FILTERING: Only cameras explicitly assigned to this Location
  const linkedCameras = React.useMemo(() => {
    if (!location) return [];
    return cameras.filter(
      (c) =>
        String(c.location) === String(location.id) ||
        String(c.location_id) === String(location.id) ||
        (c.location_name && String(c.location_name).toLowerCase() === String(location.name).toLowerCase())
    );
  }, [cameras, location]);

  // Initialize and update Leaflet Map
  useEffect(() => {
    if (!open || !mapContainerRef.current) return;

    // Destroy previous instance
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    // Determine center coordinates
    let locLat = parseFloat(location?.latitude);
    let locLng = parseFloat(location?.longitude);

    // Validate if lat/long is valid and in realistic range for India (Lat ~8-38, Lng ~68-98)
    const isValidIndiaCoords =
      !isNaN(locLat) &&
      !isNaN(locLng) &&
      locLat >= 8.0 &&
      locLat <= 38.0 &&
      locLng >= 68.0 &&
      locLng <= 98.0;

    if (!isValidIndiaCoords) {
      // Auto-resolve via Pincode or City/Sector Name
      const pin = String(location?.pincode || '').trim();
      const city = String(location?.city || location?.name || '').toLowerCase();

      if (pin === '201301' || city.includes('142') || city.includes('noida')) {
        locLat = 28.5026;
        locLng = 77.4138;
      } else if (pin.startsWith('110') || city.includes('delhi')) {
        locLat = 28.6139;
        locLng = 77.2090;
      } else if (city.includes('mumbai') || pin.startsWith('400')) {
        locLat = 19.0760;
        locLng = 72.8777;
      } else if (city.includes('gurgaon') || city.includes('gurugram') || pin.startsWith('122')) {
        locLat = 28.4595;
        locLng = 77.0266;
      } else if (city.includes('bangalore') || city.includes('bengaluru') || pin.startsWith('560')) {
        locLat = 12.9716;
        locLng = 77.5946;
      } else if (linkedCameras.length > 0 && linkedCameras[0].latitude && linkedCameras[0].longitude) {
        locLat = parseFloat(linkedCameras[0].latitude);
        locLng = parseFloat(linkedCameras[0].longitude);
      } else {
        locLat = 28.5026;
        locLng = 77.4138;
      }
    }

    const map = L.map(mapContainerRef.current, {
      center: [locLat, locLng],
      zoom: 16,
      zoomControl: false,
    });

    mapInstanceRef.current = map;

    // Add zoom control at top-right
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Tile layers
    const tileUrl =
      tileLayerType === 'satellite'
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

    const attribution =
      tileLayerType === 'satellite' ? '&copy; Esri World Imagery' : '&copy; OpenStreetMap contributors';

    L.tileLayer(tileUrl, { attribution, maxZoom: 19 }).addTo(map);

    // Add Location Landmark Marker with Pulse
    const locationIcon = L.divIcon({
      className: 'location-hub-marker',
      iconSize: [44, 44],
      iconAnchor: [22, 22],
      html: `
        <div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">
          <div style="position: absolute; inset: 0; background: rgba(147, 51, 234, 0.25); border-radius: 9999px; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
          <div style="width: 36px; height: 36px; background: linear-gradient(135deg, #7e22ce, #9333ea); border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.3); border: 2px solid #ffffff; color: #ffffff; font-size: 16px;">
            🏢
          </div>
          <div style="position: absolute; bottom: -20px; white-space: nowrap; background: #1e1b4b; color: #ffffff; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.25);">
            ${location?.name || 'Location Hub'}
          </div>
        </div>
      `,
    });

    const locationMarker = L.marker([locLat, locLng], { icon: locationIcon }).addTo(map);
    locationMarker.bindPopup(`
      <div style="font-family: sans-serif; font-size: 12px; padding: 2px;">
        <b style="color: #6b21a8; font-size: 13px;">🏢 ${location?.name || 'Location'}</b><br/>
        <span><b>City:</b> ${location?.city || 'N/A'}, ${location?.state || ''}</span><br/>
        <span><b>Pincode:</b> ${location?.pincode || 'N/A'}</span><br/>
        <span><b>GPS:</b> ${locLat.toFixed(5)}, ${locLng.toFixed(5)}</span>
      </div>
    `);

    // Add subtle coverage circle around location
    L.circle([locLat, locLng], {
      color: '#9333ea',
      fillColor: '#c084fc',
      fillOpacity: 0.1,
      radius: 120, // 120m radius
    }).addTo(map);

    // Fit bounds collector
    const allBounds = [[locLat, locLng]];

    // Clear old camera markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Plot Cameras on the map
    const campusOffsets = [
      { dLat: 0.00014, dLng: 0.00015 },
      { dLat: -0.00014, dLng: 0.00015 },
      { dLat: -0.00015, dLng: -0.00014 },
      { dLat: 0.00015, dLng: -0.00014 },
      { dLat: 0.00022, dLng: 0.0 },
      { dLat: -0.00022, dLng: 0.0 },
      { dLat: 0.0, dLng: 0.00022 },
      { dLat: 0.0, dLng: -0.00022 },
    ];

    linkedCameras.forEach((cam, idx) => {
      let cLat = parseFloat(cam.latitude);
      let cLng = parseFloat(cam.longitude);

      // If camera doesn't have custom coordinates, place it around the location center with slight offset
      if (isNaN(cLat) || isNaN(cLng) || (cLat === 0 && cLng === 0)) {
        const off = campusOffsets[idx % campusOffsets.length];
        cLat = locLat + off.dLat;
        cLng = locLng + off.dLng;
      }

      allBounds.push([cLat, cLng]);

      const isStreaming = cam.isStreaming === 1 || cam.isStreaming === true || cam.status === 1;
      const markerBg = isStreaming ? '#22c55e' : '#64748b';

      const camIcon = L.divIcon({
        className: 'camera-pin-marker',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        html: `
          <div style="position: relative; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
            <div style="width: 30px; height: 30px; background: ${markerBg}; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.3); border: 2px solid white; color: white; font-size: 13px;">
              📷
            </div>
            <div style="position: absolute; bottom: -18px; white-space: nowrap; background: rgba(15, 23, 42, 0.9); color: white; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px; box-shadow: 0 1px 4px rgba(0,0,0,0.2);">
              ${cam.name || `Cam ${cam.id}`}
            </div>
          </div>
        `,
      });

      const marker = L.marker([cLat, cLng], { icon: camIcon }).addTo(map);
      marker.on('click', () => {
        setSelectedCam(cam);
      });

      markersRef.current.push(marker);
    });

    // Fit map to show both the location hub and all cameras
    if (allBounds.length > 1) {
      setTimeout(() => {
        map.fitBounds(allBounds, { padding: [50, 50], maxZoom: 18 });
      }, 200);
    }

    const t = setTimeout(() => {
      map.invalidateSize();
    }, 250);

    return () => {
      clearTimeout(t);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [open, location, linkedCameras, tileLayerType]);

  const handleRecenter = () => {
    if (!mapInstanceRef.current || !location) return;
    let locLat = parseFloat(location.latitude) || 28.5026;
    let locLng = parseFloat(location.longitude) || 77.4138;
    mapInstanceRef.current.setView([locLat, locLng], 17, { animate: true });
  };

  return (
    <Modal
      open={open}
      onCancel={() => {
        setSelectedCam(null);
        onClose();
      }}
      footer={null}
      width={1000}
      centered
      styles={{ body: { padding: 0 } }}
      destroyOnClose
    >
      <div className="flex flex-col h-[650px] bg-slate-900 text-white rounded-lg overflow-hidden relative">
        {/* Top Control Bar */}
        <div className="bg-slate-800/90 backdrop-blur px-4 py-3 border-b border-slate-700 flex flex-wrap items-center justify-between gap-3 z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-600 rounded-lg text-white text-lg">
              <EnvironmentOutlined />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white capitalize m-0">
                  {location?.name || 'Location Map'}
                </h3>
                <Tag color="purple">{location?.locationType || 'Site'}</Tag>
                <Tag color={location?.status ? 'green' : 'default'}>
                  {location?.status ? 'Active' : 'Inactive'}
                </Tag>
              </div>
              <p className="text-xs text-slate-300 m-0">
                {location?.city}, {location?.state} • Pincode: {location?.pincode} • Linked Cameras:{' '}
                <span className="font-bold text-green-400">{linkedCameras.length}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Street / Satellite Toggle */}
            <div className="flex items-center bg-slate-700/80 p-0.5 rounded-lg border border-slate-600 text-xs">
              <button
                type="button"
                onClick={() => setTileLayerType('street')}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  tileLayerType === 'street' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-300 hover:text-white'
                }`}
              >
                <GlobalOutlined className="mr-1" /> Street
              </button>
              <button
                type="button"
                onClick={() => setTileLayerType('satellite')}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  tileLayerType === 'satellite' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-300 hover:text-white'
                }`}
              >
                <AppstoreOutlined className="mr-1" /> Satellite
              </button>
            </div>

            <Tooltip title="Recenter on Location Hub">
              <Button
                type="text"
                icon={<AimOutlined className="text-purple-400" />}
                onClick={handleRecenter}
                className="text-slate-300 hover:text-white bg-slate-700/70 border border-slate-600"
              />
            </Tooltip>

          </div>
        </div>

        {/* Map Display Container */}
        <div className="flex-1 relative w-full h-full bg-slate-950">
          {loading && (
            <div className="absolute inset-0 bg-slate-900/60 z-20 flex items-center justify-center">
              <Spin size="large" tip="Loading Camera GIS positions..." />
            </div>
          )}

          {/* Banner if no cameras are assigned to this location */}
          {linkedCameras.length === 0 && !loading && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-slate-900/90 border border-purple-500/50 rounded-xl px-4 py-2.5 shadow-xl text-center backdrop-blur">
              <p className="text-xs font-semibold text-purple-300 m-0">
                📍 0 Cameras currently linked to "{location?.name || 'this location'}"
              </p>
              <p className="text-[11px] text-slate-400 m-0 mt-0.5">
                To see cameras on this map, assign this location in Devices &gt; Cameras.
              </p>
            </div>
          )}

          <div ref={mapContainerRef} className="w-full h-full" style={{ minHeight: '520px' }} />

          {/* Bottom Left Stats Overlay */}
          <div className="absolute bottom-3 left-3 z-[1000] bg-slate-900/85 backdrop-blur border border-slate-700 rounded-lg p-2.5 text-xs shadow-lg max-w-xs">
            <div className="font-semibold text-purple-300 mb-1 flex items-center gap-1.5">
              <span>📍 {location?.name || 'Location'} Hub</span>
            </div>
            <div className="text-slate-400 space-y-0.5">
              <p className="m-0">
                Coordinates: <span className="text-slate-200">{location?.latitude}, {location?.longitude}</span>
              </p>
              <p className="m-0">
                Active Streaming Cameras:{' '}
                <span className="text-green-400 font-bold">
                  {linkedCameras.filter((c) => c.isStreaming === 1 || c.isStreaming === true).length}
                </span>{' '}
                / {linkedCameras.length}
              </p>
            </div>
          </div>

          {/* Selected Camera Drawer / Card */}
          {selectedCam && (
            <div className="absolute top-3 right-3 z-[1000] w-80 bg-slate-900/95 backdrop-blur border border-purple-500/50 rounded-xl p-3 shadow-2xl text-xs animate-fadeIn">
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-purple-600 rounded-md text-white">
                    <VideoCameraOutlined />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white m-0 truncate max-w-[190px]">
                      {selectedCam.name || `Camera #${selectedCam.id}`}
                    </h4>
                    <span className="text-[10px] text-slate-400">ID: {selectedCam.id}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedCam(null)}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <CloseOutlined />
                </button>
              </div>

              {/* Live Preview / Snapshot */}
              <div className="w-full h-36 bg-black rounded-lg overflow-hidden border border-slate-800 mb-2 relative flex items-center justify-center">
                <img
                  src={`${GO2RTC_URL}/api/frame.jpeg?src=${selectedCam.id}`}
                  alt={selectedCam.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    // Fallback to streaming api snapshot or cam_ alias
                    if (!e.target.dataset.tried) {
                      e.target.dataset.tried = '1';
                      e.target.src = `${STREAMING_API_URL}/snapshot/${selectedCam.name}`;
                    } else if (e.target.dataset.tried === '1') {
                      e.target.dataset.tried = '2';
                      e.target.src = `${GO2RTC_URL}/api/frame.jpeg?src=cam_${selectedCam.id}`;
                    } else {
                      e.target.style.display = 'none';
                    }
                  }}
                />
                <div className="absolute top-2 left-2 bg-black/70 px-2 py-0.5 rounded text-[10px] font-semibold text-white flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                  LIVE FEED
                </div>
              </div>

              <div className="space-y-1 text-slate-300">
                <div className="flex justify-between">
                  <span className="text-slate-500">Camera IP:</span>
                  <span className="font-mono text-slate-200">{selectedCam.cameraIP || selectedCam.ip || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Port / Channel:</span>
                  <span className="text-slate-200">{selectedCam.port || '80'} / Ch {selectedCam.channelId || '1'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Zone / Region:</span>
                  <span className="text-purple-300 font-semibold">{selectedCam.zone_name || selectedCam.zone || 'Noida'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Stream Status:</span>
                  <span className="text-green-400 font-semibold flex items-center gap-1">
                    <CheckCircleOutlined /> Active
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default LocationMapModal;
