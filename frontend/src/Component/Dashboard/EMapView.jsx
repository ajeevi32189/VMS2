import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Cookies from 'js-cookie';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import html2canvas from 'html2canvas';
import { deviceApi } from '../../utils/axiosInstance';
import { ANALYTICS_API_URL } from '../../config';
import { AlertSnapshot } from '../../utils/imageUtils';
import { useDeviceInventory } from '../../contexts/DeviceInventoryContext';
import {
  VideoCameraOutlined,
  WarningOutlined,
  CloseOutlined,
  UploadOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  CameraOutlined,
  SaveOutlined,
  EditOutlined,
  SoundOutlined,
  AudioMutedOutlined,
  GlobalOutlined,
  AppstoreOutlined,
  AimOutlined,
  ReloadOutlined,
  EyeOutlined,
} from '@ant-design/icons';

// Fix Leaflet's default marker asset paths in Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Floor definitions
const FLOORS = [
  { id: 'ground', name: 'Ground Floor', label: 'Ground Floor - Main Lobby & Ops' },
  { id: 'first', name: '1st Floor', label: '1st Floor - Executive & IT Bay' },
  { id: 'basement', name: 'Basement', label: 'Basement - Parking & Utilities' },
];

export default function EMapView({ onOpenLiveStream }) {
  const { cameras = [] } = useDeviceInventory();

  // Active View Mode: 'gis' (Default Google/OpenStreetMap) | 'floorplan' (2D Floor Blueprint)
  const [activeView, setActiveView] = useState('gis');

  // Multi-floor level for floorplan view
  const [activeFloor, setActiveFloor] = useState('ground');

  // Custom floorplans uploaded per floor: { [floorId]: dataUrl }
  const [customFloorplans, setCustomFloorplans] = useState({});

  // Active alerts from backend
  const [activeAlerts, setActiveAlerts] = useState([]);

  // Selected camera for detail modal
  const [selectedCamera, setSelectedCamera] = useState(null);

  // Admin edit mode for dragging markers on floorplan
  const [isEditMode, setIsEditMode] = useState(false);

  // Admin edit mode for dragging markers on GIS / Google Map
  const [isGisEditMode, setIsGisEditMode] = useState(false);

  // Custom GPS coordinates saved per camera: { [camId]: { lat, lng } }
  const [gisGpsCoords, setGisGpsCoords] = useState({});

  // Voice speech announcement toggle (SpeechSynthesis)
  const [soundEnabled, setSoundEnabled] = useState(false);

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Toast notification
  const [toastMessage, setToastMessage] = useState(null);

  // Snapshot exporting state
  const [isExporting, setIsExporting] = useState(false);

  // Zoom for 2D floorplan
  const [floorplanZoom, setFloorplanZoom] = useState(1);

  // GIS Tile Layer: 'street' | 'satellite'
  const [gisTileType, setGisTileType] = useState('street');

  // Placed floorplan coordinates per floor: { [floorId]: { [camId]: { x, y } } }
  const [floorCoords, setFloorCoords] = useState({
    ground: {},
    first: {},
    basement: {},
  });

  // Track dragging pin on floorplan
  const [draggingPin, setDraggingPin] = useState(null);

  // Refs
  const mapContainerRef = useRef(null); // Floorplan drag & drop container
  const gisMapRef = useRef(null); // DOM node for Leaflet
  const leafletMapInstance = useRef(null); // Leaflet Map object
  const leafletMarkersRef = useRef([]); // Active Leaflet markers
  const captureAreaRef = useRef(null); // Target container for html2canvas
  const floorplanFileInputRef = useRef(null);
  const announcedAlertIdsRef = useRef(new Set()); // Avoid repeating voice alerts

  // ── Show temporary Toast ──
  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  // ── Load Floorplans & Stored Coordinates from LocalStorage ──
  useEffect(() => {
    try {
      // 1. Custom floorplans
      const plans = {};
      FLOORS.forEach((fl) => {
        const stored = localStorage.getItem(`vms_floorplan_${fl.id}`);
        if (stored) plans[fl.id] = stored;
      });
      setCustomFloorplans(plans);

      // 2. Floor coordinates
      const loadedCoords = { ground: {}, first: {}, basement: {} };
      FLOORS.forEach((fl) => {
        const stored = localStorage.getItem(`vms_floor_coords_${fl.id}`);
        if (stored) {
          try {
            loadedCoords[fl.id] = JSON.parse(stored) || {};
          } catch (_) {}
        }
      });
      setFloorCoords(loadedCoords);

      // 3. Campus GIS GPS Coordinates
      const storedGps = localStorage.getItem('vms_camera_gps');
      if (storedGps) {
        try {
          setGisGpsCoords(JSON.parse(storedGps) || {});
        } catch (_) {}
      }

      // 4. Sound preference
      const storedSound = localStorage.getItem('vms_emap_sound');
      if (storedSound !== null) {
        setSoundEnabled(storedSound === 'true');
      }
    } catch (e) {
      console.warn('Failed to load E-Map cached layouts', e);
    }
  }, []);

  // ── Poll Live Alerts every 3s ──
  const pollAlerts = useCallback(async () => {
    const userId = Cookies.get('userId');
    if (!userId) return;

    try {
      const res = await deviceApi.get('/CameraAlert/', {
        params: {
          userid: userId,
          page: 1,
          pageSize: 25,
        },
      });
      const list = res?.data?.results || res?.data?.data || res?.data || [];
      const validList = Array.isArray(list) ? list : [];
      setActiveAlerts(validList);

      // ── Voice Alert Announcement (Web Speech API) ──
      if (soundEnabled && validList.length > 0 && 'speechSynthesis' in window) {
        validList.forEach((alert) => {
          const alertId = alert.id || `${alert.cameraId}_${alert.regDate}`;
          if (!announcedAlertIdsRef.current.has(alertId)) {
            announcedAlertIdsRef.current.add(alertId);

            const alertType = alert.objectName || alert.alertType || 'Security Incident';
            const camName = alert.camera_name || `Camera ${alert.cameraId || ''}`;

            const utterance = new SpeechSynthesisUtterance(`Attention! ${alertType} on ${camName}`);
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            window.speechSynthesis.speak(utterance);
          }
        });
      }
    } catch (err) {
      console.debug('Alert polling skipped', err);
    }
  }, [soundEnabled]);

  useEffect(() => {
    pollAlerts();
    const interval = setInterval(pollAlerts, 3000);
    return () => clearInterval(interval);
  }, [pollAlerts]);

  // Lookup map for fast matching alert by camera id or name
  const alertLookup = useMemo(() => {
    const map = {};
    (activeAlerts || []).forEach((alert) => {
      const cId = alert.cameraId || alert.camera || alert.camera_id;
      const cName = (alert.camera_name || '').toLowerCase().trim();
      if (cId) map[String(cId)] = alert;
      if (cName) map[cName] = alert;
    });
    return map;
  }, [activeAlerts]);

  // Count active alerts per floor
  const alertsCountPerFloor = useMemo(() => {
    const counts = { ground: 0, first: 0, basement: 0 };
    (cameras || []).forEach((cam) => {
      const alert = alertLookup[String(cam.id)] || alertLookup[(cam.name || '').toLowerCase().trim()];
      if (alert) {
        const floor =
          cam.floor ||
          (floorCoords.ground[cam.id]
            ? 'ground'
            : floorCoords.first[cam.id]
            ? 'first'
            : floorCoords.basement[cam.id]
            ? 'basement'
            : 'ground');
        if (counts[floor] !== undefined) counts[floor]++;
      }
    });
    return counts;
  }, [cameras, alertLookup, floorCoords]);

  // Toggle voice alert sound
  const handleToggleSound = () => {
    const nextVal = !soundEnabled;
    setSoundEnabled(nextVal);
    try {
      localStorage.setItem('vms_emap_sound', String(nextVal));
    } catch (_) {}
    if (nextVal) {
      showToast('🔊 Voice Announcements Enabled');
      if ('speechSynthesis' in window) {
        window.speechSynthesis.speak(new SpeechSynthesisUtterance('Voice announcements enabled'));
      }
    } else {
      showToast('🔇 Voice Announcements Muted');
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    }
  };

  const rootContainerRef = useRef(null);

  // Fullscreen handlers with Native Fullscreen API + Escape key support
  const handleToggleFullscreen = () => {
    if (!isFullscreen) {
      setIsFullscreen(true);
      const el = rootContainerRef.current || document.documentElement;
      if (el && el.requestFullscreen) {
        el.requestFullscreen().catch(() => {});
      }
    } else {
      setIsFullscreen(false);
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFs = !!document.fullscreenElement;
      setIsFullscreen(isFs);
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  // Invalidate Leaflet map size on resize / fullscreen toggle
  useEffect(() => {
    if (leafletMapInstance.current) {
      const t1 = setTimeout(() => {
        leafletMapInstance.current?.invalidateSize();
      }, 50);
      const t2 = setTimeout(() => {
        leafletMapInstance.current?.invalidateSize();
      }, 200);
      const t3 = setTimeout(() => {
        leafletMapInstance.current?.invalidateSize();
      }, 500);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
  }, [activeView, isFullscreen]);

  // ─────────────────────────────────────────────────────────────
  // GIS / GOOGLE / LEAFLET MAP INITIALIZATION & MARKERS
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeView !== 'gis' || !gisMapRef.current) return;

    // Destroy existing instance if any
    if (leafletMapInstance.current) {
      leafletMapInstance.current.remove();
      leafletMapInstance.current = null;
    }

    // Default center: Noida Sector 142 [28.5026, 77.4138]
    const map = L.map(gisMapRef.current, {
      center: [28.5026, 77.4138],
      zoom: 16,
      zoomControl: false,
    });

    leafletMapInstance.current = map;

    // Add Tile Layer
    const tileUrl =
      gisTileType === 'satellite'
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

    const attribution =
      gisTileType === 'satellite' ? '&copy; Esri World Imagery' : '&copy; OpenStreetMap contributors';

    const tiles = L.tileLayer(tileUrl, { attribution, maxZoom: 19 });
    tiles.addTo(map);

    setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      if (leafletMapInstance.current) {
        leafletMapInstance.current.remove();
        leafletMapInstance.current = null;
      }
    };
  }, [activeView, gisTileType]);

  // Save custom GPS positions for Campus GIS
  const handleSaveGisLayout = () => {
    try {
      localStorage.setItem('vms_camera_gps', JSON.stringify(gisGpsCoords));
      showToast('💾 Office camera GPS locations saved permanently!');
      setIsGisEditMode(false);
    } catch (e) {
      showToast('❌ Failed to save GPS locations');
    }
  };

  const handleResetGisLayout = () => {
    if (window.confirm('Reset all cameras to default Sector 142 office cluster?')) {
      localStorage.removeItem('vms_camera_gps');
      setGisGpsCoords({});
      showToast('⟲ Reset to Sector 142 cluster');
    }
  };

  // Render & Update GIS Camera Markers whenever cameras or active alerts change
  useEffect(() => {
    if (activeView !== 'gis' || !leafletMapInstance.current) return;

    const map = leafletMapInstance.current;

    // Clear old markers
    leafletMarkersRef.current.forEach((m) => m.remove());
    leafletMarkersRef.current = [];

    const bounds = [];

    (cameras || []).forEach((cam, idx) => {
      let lat;
      let lng;

      // Priority 1: User-edited & saved GPS coordinate
      if (gisGpsCoords[cam.id]) {
        lat = Number(gisGpsCoords[cam.id].lat);
        lng = Number(gisGpsCoords[cam.id].lng);
      }

      // Priority 2: Coordinate from Camera Zone (Noida Sector 142 primary default)
      if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
        const zoneLower = String(cam.zone_name || cam.zone || '').toLowerCase();

        // Base center coordinates: Noida Sector 142 primary default
        let baseLat = 28.5026;
        let baseLng = 77.4138;

        if (zoneLower.includes('delhi')) {
          baseLat = 28.6139;
          baseLng = 77.2090;
        } else if (zoneLower.includes('mumbai')) {
          baseLat = 19.0760;
          baseLng = 72.8777;
        } else {
          // Default: Noida Sector 142
          baseLat = 28.5026;
          baseLng = 77.4138;
        }

        // Realistic tight office campus building perimeter offsets: ~15-20 meters in Sector 142
        const campusOffsets = [
          { dLat: 0.00012, dLng: 0.00012 },   // North-East / Reception
          { dLat: -0.00012, dLng: 0.00012 },  // South-East / Operations Wing
          { dLat: -0.00012, dLng: -0.00012 }, // South-West / Parking Gate
          { dLat: 0.00012, dLng: -0.00012 },  // North-West / Main Gate
          { dLat: 0.00018, dLng: 0 },         // North Perimeter
          { dLat: -0.00018, dLng: 0 },        // South Perimeter
          { dLat: 0, dLng: 0.00018 },         // East Corridor
          { dLat: 0, dLng: -0.00018 },        // West Corridor
        ];

        const off = campusOffsets[idx % campusOffsets.length];
        lat = baseLat + off.dLat;
        lng = baseLng + off.dLng;
      }

      bounds.push([lat, lng]);

      const alert = alertLookup[String(cam.id)] || alertLookup[(cam.name || '').toLowerCase().trim()];
      const hasAlert = !!alert;
      const isOnline = cam.status === 1 || cam.isStreaming === 1 || cam.isStreaming === true;
      const alertName = alert?.objectName || alert?.alertType || 'Active Alert';

      // Custom Leaflet DivIcon with Blinking Radar Waves
      const customIcon = L.divIcon({
        className: 'emap-gis-marker',
        iconSize: [42, 42],
        iconAnchor: [21, 21],
        html: `
          <div style="position: relative; width: 42px; height: 42px; display: flex; align-items: center; justify-content: center; cursor: ${isGisEditMode ? 'grab' : 'pointer'};">
            ${
              hasAlert
                ? `
                <div style="position: absolute; inset: -8px; border-radius: 9999px; background: rgba(239, 68, 68, 0.45); animation: radar-ring 1.6s infinite;"></div>
                <div style="position: absolute; inset: -16px; border-radius: 9999px; background: rgba(239, 68, 68, 0.25); animation: radar-ring-delayed 1.6s infinite 0.5s;"></div>
                <div style="position: absolute; top: -20px; left: 50%; transform: translateX(-50%); background: #EF4444; color: white; font-size: 9px; font-weight: 800; padding: 2px 6px; border-radius: 9999px; white-space: nowrap; box-shadow: 0 0 10px rgba(239,68,68,0.8); border: 1px solid #fca5a5;">
                  ⚠️ ${alertName}
                </div>
              `
                : isGisEditMode
                ? `
                <div style="position: absolute; top: -18px; left: 50%; transform: translateX(-50%); background: #059669; color: white; font-size: 8px; font-weight: 800; padding: 1px 5px; border-radius: 9999px; white-space: nowrap; border: 1px solid #6ee7b7; box-shadow: 0 0 6px rgba(5,150,105,0.8);">
                  ✥ Drag
                </div>
              `
                : ''
            }
            <div style="
              width: 32px;
              height: 32px;
              border-radius: 9999px;
              display: flex;
              align-items: center;
              justify-content: center;
              background: ${hasAlert ? '#DC2626' : isOnline ? '#7C3AED' : '#475569'};
              color: white;
              border: 2px solid ${hasAlert ? '#FCA5A5' : isOnline ? '#C4B5FD' : '#94A3B8'};
              box-shadow: ${hasAlert ? '0 0 18px #EF4444' : isOnline ? '0 0 10px rgba(124,58,237,0.6)' : 'none'};
            ">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"></path>
                <circle cx="12" cy="13" r="3"></circle>
              </svg>
            </div>
            <div style="position: absolute; bottom: -18px; left: 50%; transform: translateX(-50%); background: rgba(15,23,42,0.85); color: #E2E8F0; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 4px; white-space: nowrap; border: 1px solid rgba(255,255,255,0.15); pointer-events: none; max-width: 90px; overflow: hidden; text-overflow: ellipsis;">
              ${cam.name || `Cam #${cam.id}`}
            </div>
          </div>
        `,
      });

      const marker = L.marker([lat, lng], {
        icon: customIcon,
        draggable: isGisEditMode,
      });

      marker.on('dragend', (e) => {
        const newPos = e.target.getLatLng();
        setGisGpsCoords((prev) => ({
          ...prev,
          [cam.id]: { lat: newPos.lat, lng: newPos.lng },
        }));
        showToast(`📍 Placed ${cam.name || 'Cam #' + cam.id}`);
      });

      marker.on('click', () => {
        if (!isGisEditMode) {
          setSelectedCamera({
            ...cam,
            hasAlert,
            activeAlert: alert,
            isOnline,
            lat,
            lng,
          });
        }
      });

      marker.addTo(map);
      leafletMarkersRef.current.push(marker);
    });

    if (bounds.length > 0 && !isGisEditMode) {
      try {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
      } catch (_) {}
    }
  }, [cameras, activeAlerts, alertLookup, activeView, isGisEditMode, gisGpsCoords]);

  // ─────────────────────────────────────────────────────────────
  // 2D FLOORPLAN: DRAG & DROP POSITIONING & PLACED CAMERAS
  // ─────────────────────────────────────────────────────────────
  const currentFloorPlacedMap = floorCoords[activeFloor] || {};

  // Cameras categorized for current floor
  const { placedOnThisFloor, unplacedCameras } = useMemo(() => {
    const placed = [];
    const unplaced = [];

    (cameras || []).forEach((cam) => {
      const alert = alertLookup[String(cam.id)] || alertLookup[(cam.name || '').toLowerCase().trim()];
      const isOnline = cam.status === 1 || cam.isStreaming === 1 || cam.isStreaming === true;
      const coords = currentFloorPlacedMap[cam.id];

      const camData = {
        ...cam,
        hasAlert: !!alert,
        activeAlert: alert,
        isOnline,
        coords,
      };

      if (coords) {
        placed.push(camData);
      } else {
        unplaced.push(camData);
      }
    });

    return { placedOnThisFloor: placed, unplacedCameras: unplaced };
  }, [cameras, currentFloorPlacedMap, alertLookup]);

  // Handle Drag Start from unplaced tray
  const handleTrayDragStart = (e, camId) => {
    e.dataTransfer.setData('text/plain', String(camId));
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const handleFloorplanDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleFloorplanDrop = (e) => {
    e.preventDefault();
    const camId = e.dataTransfer.getData('text/plain');
    if (!camId || !mapContainerRef.current) return;

    const rect = mapContainerRef.current.getBoundingClientRect();
    const rawX = ((e.clientX - rect.left) / rect.width) * 100;
    const rawY = ((e.clientY - rect.top) / rect.height) * 100;

    const clampedX = Math.max(5, Math.min(95, Math.round(rawX * 10) / 10));
    const clampedY = Math.max(6, Math.min(94, Math.round(rawY * 10) / 10));

    const newCoord = { x: clampedX, y: clampedY };

    setFloorCoords((prev) => ({
      ...prev,
      [activeFloor]: {
        ...prev[activeFloor],
        [camId]: newCoord,
      },
    }));

    showToast(`📍 Camera placed on ${FLOORS.find((f) => f.id === activeFloor)?.name}`);
  };

  // Dragging existing pin on floorplan in Edit Mode
  const handlePinMouseDown = (e, camId) => {
    if (!isEditMode) return;
    e.stopPropagation();
    e.preventDefault();
    setDraggingPin(camId);
  };

  const handleFloorplanMouseMove = (e) => {
    if (!draggingPin || !mapContainerRef.current || !isEditMode) return;

    const rect = mapContainerRef.current.getBoundingClientRect();
    const rawX = ((e.clientX - rect.left) / rect.width) * 100;
    const rawY = ((e.clientY - rect.top) / rect.height) * 100;

    const clampedX = Math.max(4, Math.min(96, Math.round(rawX * 10) / 10));
    const clampedY = Math.max(5, Math.min(95, Math.round(rawY * 10) / 10));

    setFloorCoords((prev) => ({
      ...prev,
      [activeFloor]: {
        ...prev[activeFloor],
        [draggingPin]: { x: clampedX, y: clampedY },
      },
    }));
  };

  const handleFloorplanMouseUp = () => {
    setDraggingPin(null);
  };

  // Remove pin from floor
  const handleRemovePin = (e, camId) => {
    e.stopPropagation();
    setFloorCoords((prev) => {
      const copy = { ...prev[activeFloor] };
      delete copy[camId];
      return {
        ...prev,
        [activeFloor]: copy,
      };
    });
    if (selectedCamera?.id === camId) setSelectedCamera(null);
  };

  // Save current floor layout to localStorage
  const handleSaveLayout = () => {
    try {
      localStorage.setItem(`vms_floor_coords_${activeFloor}`, JSON.stringify(floorCoords[activeFloor]));
      showToast(`💾 Layout saved for ${FLOORS.find((f) => f.id === activeFloor)?.name}!`);
      setIsEditMode(false);
    } catch (e) {
      showToast('❌ Failed to save layout');
    }
  };

  // Auto-distribute unplaced cameras
  const handleAutoPlaceAll = () => {
    if (cameras.length === 0) return;
    const updated = { ...floorCoords[activeFloor] };
    cameras.forEach((cam, idx) => {
      if (!updated[cam.id]) {
        const angle = (idx * (2 * Math.PI / cameras.length)) + Math.PI / 4;
        const radius = 24;
        const x = Math.round(Math.max(12, Math.min(88, 50 + radius * Math.cos(angle))) * 10) / 10;
        const y = Math.round(Math.max(14, Math.min(86, 50 + radius * Math.sin(angle))) * 10) / 10;
        updated[cam.id] = { x, y };
      }
    });

    setFloorCoords((prev) => ({
      ...prev,
      [activeFloor]: updated,
    }));
    showToast('⚡ All cameras placed on blueprint');
  };

  // Upload Custom Blueprint for Active Floor
  const handleFloorplanUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result;
      if (dataUrl) {
        setCustomFloorplans((prev) => ({ ...prev, [activeFloor]: dataUrl }));
        try {
          localStorage.setItem(`vms_floorplan_${activeFloor}`, dataUrl);
          showToast(`🖼️ Blueprint uploaded for ${FLOORS.find((f) => f.id === activeFloor)?.name}`);
        } catch (_) {}
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleResetFloorplan = () => {
    if (window.confirm('Revert to default architectural blueprint grid?')) {
      setCustomFloorplans((prev) => {
        const copy = { ...prev };
        delete copy[activeFloor];
        return copy;
      });
      localStorage.removeItem(`vms_floorplan_${activeFloor}`);
      showToast('⟲ Reverted to default blueprint');
    }
  };

  // ─────────────────────────────────────────────────────────────
  // EXPORT HIGH-RES SNAPSHOT (html2canvas)
  // ─────────────────────────────────────────────────────────────
  const handleExportSnapshot = async () => {
    if (!captureAreaRef.current) return;
    try {
      setIsExporting(true);
      showToast('📷 Generating high-res snapshot...');

      const canvas = await html2canvas(captureAreaRef.current, {
        useCORS: true,
        allowTaint: true,
        scale: 2,
        backgroundColor: '#0B0F19',
      });

      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `Gyanakshi-EMap-${activeView === 'gis' ? 'Campus-GIS' : activeFloor}-${Date.now()}.png`;
      link.click();
      showToast('✅ Snapshot downloaded successfully');
    } catch (err) {
      console.error('Failed to export map snapshot:', err);
      showToast('❌ Snapshot export failed');
    } finally {
      setIsExporting(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // MAIN RENDER (WITH PORTAL SUPPORT FOR TRUE FULLSCREEN)
  // ─────────────────────────────────────────────────────────────
  const mainContent = (
    <div
      ref={rootContainerRef}
      className={`relative w-full h-full bg-[#0B0F19] text-slate-100 select-none overflow-hidden flex flex-col font-sans ${
        isFullscreen
          ? 'fixed inset-0 z-[999999] w-screen h-screen m-0 p-0 shadow-2xl'
          : 'rounded-xl shadow-lg'
      }`}
    >
      {/* ── Keyframe Animations for Radar Wave & Alerts ── */}
      <style>{`
        @keyframes radar-ring {
          0% { transform: scale(0.8); opacity: 1; }
          50% { opacity: 0.5; }
          100% { transform: scale(3.2); opacity: 0; }
        }
        @keyframes radar-ring-delayed {
          0% { transform: scale(0.8); opacity: 0.8; }
          50% { opacity: 0.4; }
          100% { transform: scale(2.2); opacity: 0; }
        }
      `}</style>

      {/* ── Floating Notification Toast ── */}
      {toastMessage && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-50 bg-[#1E1B4B]/95 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-2xl border border-purple-500/40 backdrop-blur-md animate-in fade-in slide-in-from-top-2">
          {toastMessage}
        </div>
      )}

      {/* ── RESPONSIVE ENTERPRISE TOP TOOLBAR ── */}
      <div className="h-11 bg-[#121629] border-b border-purple-500/20 px-2 sm:px-3 flex items-center justify-between shrink-0 z-40 overflow-x-auto scrollbar-none gap-2">
        {/* Left: View Mode Toggle & Multi-Floor Dropdown */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* View Segmented Tabs */}
          <div className="bg-[#1A1F38] p-0.5 rounded-lg border border-purple-500/20 flex items-center shadow-inner">
            <button
              type="button"
              onClick={() => {
                setActiveView('gis');
                setSelectedCamera(null);
              }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                activeView === 'gis'
                  ? 'bg-gradient-to-r from-purple-700 to-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <GlobalOutlined />
              <span>GIS Map</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveView('floorplan');
                setSelectedCamera(null);
              }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                activeView === 'floorplan'
                  ? 'bg-gradient-to-r from-purple-700 to-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <AppstoreOutlined />
              <span>Floorplan</span>
            </button>
          </div>

          {/* GIS Tile Toggle */}
          {activeView === 'gis' && (
            <div className="bg-[#1A1F38] p-0.5 rounded-lg border border-purple-500/20 flex items-center text-[10px] font-medium">
              <button
                type="button"
                onClick={() => setGisTileType('street')}
                className={`px-1.5 py-0.5 rounded transition ${
                  gisTileType === 'street' ? 'bg-purple-800 text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                Street
              </button>
              <button
                type="button"
                onClick={() => setGisTileType('satellite')}
                className={`px-1.5 py-0.5 rounded transition ${
                  gisTileType === 'satellite' ? 'bg-purple-800 text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                Satellite
              </button>
            </div>
          )}

          {/* Floor Dropdown Switcher */}
          {activeView === 'floorplan' && (
            <div className="relative flex items-center">
              <select
                value={activeFloor}
                onChange={(e) => {
                  setActiveFloor(e.target.value);
                  setSelectedCamera(null);
                }}
                className="bg-[#1A1F38] text-[11px] font-bold text-purple-200 border border-purple-500/30 rounded-lg px-2 py-0.5 pr-6 focus:outline-none focus:ring-1 focus:ring-purple-400 cursor-pointer appearance-none shadow-sm"
              >
                {FLOORS.map((f) => {
                  const alertCount = alertsCountPerFloor[f.id] || 0;
                  return (
                    <option key={f.id} value={f.id} className="bg-[#121629] text-white">
                      {f.name} {alertCount > 0 ? `🔴 (${alertCount})` : ''}
                    </option>
                  );
                })}
              </select>
              <div className="pointer-events-none absolute right-1.5 text-[9px] text-purple-300">▼</div>

              {Object.entries(alertsCountPerFloor).some(([fl, count]) => fl !== activeFloor && count > 0) && (
                <span className="ml-1 flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-extrabold bg-red-600/90 text-white border border-red-400 animate-pulse">
                  🔴 Alert
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right Action Controls */}
        <div className="flex items-center gap-1 shrink-0">
          {/* GIS Specific: Edit Pins & Save Locations */}
          {activeView === 'gis' && (
            <>
              <button
                type="button"
                onClick={() => (isGisEditMode ? handleSaveGisLayout() : setIsGisEditMode(true))}
                className={`px-2 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer shadow-md ${
                  isGisEditMode
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white animate-pulse'
                    : 'bg-[#1A1F38] hover:bg-purple-900/60 text-purple-200 border border-purple-500/30'
                }`}
                title={isGisEditMode ? 'Save camera GPS positions' : 'Drag pins to adjust spots in Sector 142'}
              >
                {isGisEditMode ? (
                  <>
                    <SaveOutlined /> <span>Save</span>
                  </>
                ) : (
                  <>
                    <EditOutlined /> <span>Edit Pins</span>
                  </>
                )}
              </button>

              {isGisEditMode && Object.keys(gisGpsCoords).length > 0 && (
                <button
                  type="button"
                  onClick={handleResetGisLayout}
                  className="px-1.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition cursor-pointer"
                  title="Reset positions to default Sector 142 cluster"
                >
                  <ReloadOutlined />
                </button>
              )}
            </>
          )}

          {/* Floorplan Specific: Edit Pins & Upload */}
          {activeView === 'floorplan' && (
            <>
              <button
                type="button"
                onClick={() => (isEditMode ? handleSaveLayout() : setIsEditMode(true))}
                className={`px-2 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer shadow-md ${
                  isEditMode
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white animate-pulse'
                    : 'bg-[#1A1F38] hover:bg-purple-900/60 text-purple-200 border border-purple-500/30'
                }`}
                title={isEditMode ? 'Save floorplan pins' : 'Edit & Drag Pins'}
              >
                {isEditMode ? <><SaveOutlined /> <span>Save</span></> : <><EditOutlined /> <span>Edit</span></>}
              </button>

              <input
                type="file"
                ref={floorplanFileInputRef}
                onChange={handleFloorplanUpload}
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
              />
              <button
                type="button"
                onClick={() => floorplanFileInputRef.current?.click()}
                className="px-2 py-1 bg-[#1A1F38] hover:bg-purple-900/60 text-purple-200 border border-purple-500/30 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer shadow-sm"
                title="Upload PNG/JPG blueprint"
              >
                <UploadOutlined /> <span className="hidden sm:inline">Upload</span>
              </button>

              {customFloorplans[activeFloor] && (
                <button
                  type="button"
                  onClick={handleResetFloorplan}
                  className="px-1.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition cursor-pointer"
                  title="Revert blueprint"
                >
                  <ReloadOutlined />
                </button>
              )}

              {/* Zoom Controls */}
              <div className="flex items-center bg-[#1A1F38] border border-purple-500/30 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setFloorplanZoom((z) => Math.min(2.2, z + 0.15))}
                  className="px-1.5 py-1 text-purple-200 hover:text-white hover:bg-purple-800/50 text-[11px] transition"
                  title="Zoom In"
                >
                  <ZoomInOutlined />
                </button>
                <button
                  type="button"
                  onClick={() => setFloorplanZoom((z) => Math.max(0.7, z - 0.15))}
                  className="px-1.5 py-1 text-purple-200 hover:text-white hover:bg-purple-800/50 text-[11px] transition border-l border-purple-500/20"
                  title="Zoom Out"
                >
                  <ZoomOutOutlined />
                </button>
              </div>
            </>
          )}

          {/* Sound Mute/Unmute Icon Button */}
          <button
            type="button"
            onClick={handleToggleSound}
            className={`p-1.5 rounded-lg text-xs transition cursor-pointer border ${
              soundEnabled
                ? 'bg-purple-900/60 border-purple-500/50 text-purple-200 shadow-[0_0_10px_rgba(168,85,247,0.3)]'
                : 'bg-[#1A1F38] border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title={soundEnabled ? 'Voice Announcements ON (click to mute)' : 'Voice Announcements Muted (click to enable)'}
          >
            {soundEnabled ? <SoundOutlined className="text-purple-400" /> : <AudioMutedOutlined />}
          </button>

          {/* Snapshot Icon Button */}
          <button
            type="button"
            onClick={handleExportSnapshot}
            disabled={isExporting}
            className="p-1.5 bg-[#1A1F38] hover:bg-purple-900/60 text-purple-200 border border-purple-500/30 rounded-lg text-xs transition cursor-pointer shadow-sm disabled:opacity-50"
            title="Export snapshot PNG"
          >
            <CameraOutlined />
          </button>

          {/* Fullscreen Button */}
          <button
            type="button"
            onClick={handleToggleFullscreen}
            className="px-2.5 py-1 bg-gradient-to-r from-purple-700 to-indigo-600 hover:from-purple-600 hover:to-indigo-500 text-white rounded-lg text-xs font-bold transition shadow-md flex items-center gap-1 cursor-pointer shrink-0"
            title={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Expand to Fullscreen'}
          >
            {isFullscreen ? (
              <>
                <FullscreenExitOutlined /> <span>Exit Fullscreen</span>
              </>
            ) : (
              <>
                <FullscreenOutlined /> <span>Fullscreen</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MAIN VIEW CONTAINER (GIS MAP OR 2D FLOORPLAN)                 */}
      {/* ───────────────────────────────────────────────────────────── */}
      <div ref={captureAreaRef} className="relative flex-1 w-full h-full overflow-hidden flex bg-[#0B0F19]">
        {/* ── MODE 1: CAMPUS / GIS LEAFLET MAP ── */}
        <div
          className={`w-full h-full relative ${activeView === 'gis' ? 'block' : 'hidden'}`}
          style={{ height: '100%', width: '100%', minHeight: '100%' }}
        >
          <div
            ref={gisMapRef}
            className="w-full h-full z-10"
            style={{ height: '100%', width: '100%', minHeight: '100%' }}
          />

          {/* Floating Campus GIS Summary Badge */}
          <div className="absolute bottom-3 left-3 z-20 bg-[#121629]/90 backdrop-blur-md border border-purple-500/30 px-3 py-1.5 rounded-lg text-xs text-slate-200 shadow-xl flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-500 shadow-[0_0_8px_#a855f7]" />
              <span className="font-bold text-white">{cameras.length} Total Cameras</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_#ef4444] animate-ping" />
              <span className="text-red-400 font-bold">
                {activeAlerts.length} Active {activeAlerts.length === 1 ? 'Alert' : 'Alerts'}
              </span>
            </div>
            <span className="text-[10px] text-slate-400 border-l border-white/10 pl-2">
              {isGisEditMode
                ? '✥ Drag pins to adjust spots in Sector 142, then click "Save"'
                : 'Noida Sector 142 Campus • Click "Edit Pins" to drag'}
            </span>
          </div>
        </div>

        {/* ── MODE 2: 2D MULTI-FLOOR BLUEPRINT CANVAS ── */}
        {activeView === 'floorplan' && (
          <div className="relative flex-1 w-full h-full flex overflow-hidden">
            {/* ── Left Sidebar Drawer (Only Visible in Edit Mode or when cameras are unplaced) ── */}
            {isEditMode && (
              <div className="w-56 h-full bg-[#121629] border-r border-purple-500/20 z-30 flex flex-col p-2.5 shadow-xl animate-in slide-in-from-left-4 duration-200">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-purple-500/20">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <AimOutlined className="text-purple-400" />
                    <span>Camera Tray</span>
                  </span>
                  <span className="text-[10px] bg-purple-900/60 text-purple-300 px-1.5 py-0.2 rounded font-bold">
                    {placedOnThisFloor.length}/{cameras.length} Placed
                  </span>
                </div>

                <div className="text-[10px] text-slate-400 mb-2 flex items-center justify-between">
                  <span>Drag onto blueprint:</span>
                  {unplacedCameras.length > 0 && (
                    <button
                      type="button"
                      onClick={handleAutoPlaceAll}
                      className="text-purple-400 hover:text-purple-200 font-bold underline cursor-pointer"
                    >
                      Place All
                    </button>
                  )}
                </div>

                {/* List of Cameras */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-purple-900/50">
                  {cameras.length === 0 ? (
                    <div className="text-center py-6 text-xs text-slate-500">No cameras found</div>
                  ) : (
                    cameras.map((cam) => {
                      const isPlaced = !!currentFloorPlacedMap[cam.id];
                      const alert = alertLookup[String(cam.id)] || alertLookup[(cam.name || '').toLowerCase().trim()];
                      const isOnline = cam.status === 1 || cam.isStreaming === 1 || cam.isStreaming === true;

                      return (
                        <div
                          key={cam.id}
                          draggable
                          onDragStart={(e) => handleTrayDragStart(e, cam.id)}
                          onClick={() => {
                            if (isPlaced) setSelectedCamera(cam);
                          }}
                          className={`p-2 rounded-lg border text-left cursor-grab active:cursor-grabbing transition-all ${
                            alert
                              ? 'bg-red-950/60 border-red-500/60 text-red-100 shadow-[0_0_8px_rgba(239,68,68,0.3)]'
                              : isPlaced
                              ? 'bg-[#191e38] border-purple-500/40 text-purple-200'
                              : 'bg-[#151930] border-slate-700/60 text-slate-300 hover:border-purple-400 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold truncate text-white" title={cam.name}>
                              {cam.name || `Cam #${cam.id}`}
                            </span>
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                alert
                                  ? 'bg-red-500 animate-ping'
                                  : isOnline
                                  ? 'bg-emerald-400'
                                  : 'bg-slate-500'
                              }`}
                            />
                          </div>

                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span className="truncate">{cam.zone_name || cam.zone || 'Zone 1'}</span>
                            <span
                              className={`font-semibold text-[9px] px-1 py-0.2 rounded ${
                                isPlaced
                                  ? 'bg-purple-900/60 text-purple-300'
                                  : 'bg-amber-950/80 text-amber-300 border border-amber-500/40'
                              }`}
                            >
                              {isPlaced ? '📍 Placed' : '➕ Drag me'}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleSaveLayout}
                  className="w-full mt-2 py-1.5 bg-gradient-to-r from-purple-700 to-indigo-600 hover:from-purple-600 hover:to-indigo-500 text-white rounded-lg text-xs font-bold transition shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <SaveOutlined /> Save Positions
                </button>
              </div>
            )}

            {/* ── Main Floor Canvas Area ── */}
            <div
              ref={mapContainerRef}
              onDragOver={handleFloorplanDragOver}
              onDrop={handleFloorplanDrop}
              onMouseMove={handleFloorplanMouseMove}
              onMouseUp={handleFloorplanMouseUp}
              onMouseLeave={handleFloorplanMouseUp}
              className="relative flex-1 h-full overflow-hidden flex items-center justify-center bg-[#090C15]"
            >
              <div
                className="relative w-full h-full flex items-center justify-center transition-transform duration-150 ease-out"
                style={{
                  transform: `scale(${floorplanZoom})`,
                  transformOrigin: 'center center',
                }}
              >
                {/* Layer 1: Floorplan Image (Uploaded PNG/JPG OR Crisp Clean Vector Blueprint) */}
                {customFloorplans[activeFloor] ? (
                  <img
                    src={customFloorplans[activeFloor]}
                    alt={`Floorplan ${activeFloor}`}
                    className="max-w-full max-h-full object-contain pointer-events-none select-none rounded-lg"
                  />
                ) : (
                  /* Clean High-Tech Architectural Vector Blueprint SVG */
                  <svg className="w-full h-full absolute inset-0 pointer-events-none" viewBox="0 0 1000 600" preserveAspectRatio="none">
                    <defs>
                      <pattern id="arch-grid" width="30" height="30" patternUnits="userSpaceOnUse">
                        <path d="M 30 0 L 0 0 0 30" fill="none" stroke="rgba(147, 51, 234, 0.08)" strokeWidth="1" />
                        <circle cx="0" cy="0" r="1" fill="rgba(168, 85, 247, 0.15)" />
                      </pattern>
                    </defs>

                    {/* Canvas Background */}
                    <rect width="1000" height="600" fill="#0A0E1A" />
                    <rect width="1000" height="600" fill="url(#arch-grid)" />

                    {/* Outer Architectural Perimeter */}
                    <rect
                      x="35"
                      y="35"
                      width="930"
                      height="530"
                      rx="14"
                      fill="rgba(18, 22, 43, 0.45)"
                      stroke="#4F46E5"
                      strokeWidth="2"
                    />

                    {/* Architectural Room Dividers & Corridor Layout based on active floor */}
                    {activeFloor === 'ground' && (
                      <>
                        <rect x="50" y="50" width="320" height="240" fill="rgba(30, 27, 75, 0.35)" stroke="#6366F1" strokeWidth="1.5" />
                        <text x="210" y="175" fill="#A5B4FC" fontSize="12" fontWeight="bold" textAnchor="middle" letterSpacing="2">
                          [ 01 - MAIN ENTRANCE & RECEPTION ]
                        </text>

                        <rect x="390" y="50" width="280" height="240" fill="rgba(30, 27, 75, 0.35)" stroke="#6366F1" strokeWidth="1.5" />
                        <text x="530" y="175" fill="#A5B4FC" fontSize="12" fontWeight="bold" textAnchor="middle" letterSpacing="2">
                          [ 02 - SECURITY CONTROL ROOM ]
                        </text>

                        <rect x="690" y="50" width="260" height="240" fill="rgba(30, 27, 75, 0.35)" stroke="#6366F1" strokeWidth="1.5" />
                        <text x="820" y="175" fill="#A5B4FC" fontSize="12" fontWeight="bold" textAnchor="middle" letterSpacing="2">
                          [ 03 - SERVER & IT RACKS ]
                        </text>

                        <rect x="50" y="310" width="900" height="235" fill="rgba(30, 27, 75, 0.25)" stroke="#6366F1" strokeWidth="1.5" />
                        <text x="500" y="430" fill="#A5B4FC" fontSize="13" fontWeight="bold" textAnchor="middle" letterSpacing="2">
                          [ 04 - GROUND FLOOR OPERATIONS BAY & CORRIDORS ]
                        </text>
                      </>
                    )}

                    {activeFloor === 'first' && (
                      <>
                        <rect x="50" y="50" width="440" height="240" fill="rgba(30, 27, 75, 0.35)" stroke="#7C3AED" strokeWidth="1.5" />
                        <text x="270" y="175" fill="#C4B5FD" fontSize="12" fontWeight="bold" textAnchor="middle" letterSpacing="2">
                          [ 101 - EXECUTIVE BOARDROOM & SUITES ]
                        </text>

                        <rect x="510" y="50" width="440" height="240" fill="rgba(30, 27, 75, 0.35)" stroke="#7C3AED" strokeWidth="1.5" />
                        <text x="730" y="175" fill="#C4B5FD" fontSize="12" fontWeight="bold" textAnchor="middle" letterSpacing="2">
                          [ 102 - IT OPERATIONS & NOC ROOM ]
                        </text>

                        <rect x="50" y="310" width="900" height="235" fill="rgba(30, 27, 75, 0.25)" stroke="#7C3AED" strokeWidth="1.5" />
                        <text x="500" y="430" fill="#C4B5FD" fontSize="13" fontWeight="bold" textAnchor="middle" letterSpacing="2">
                          [ 103 - OPEN WORKSPACE & MEETING CORRIDORS ]
                        </text>
                      </>
                    )}

                    {activeFloor === 'basement' && (
                      <>
                        <rect x="50" y="50" width="440" height="240" fill="rgba(15, 23, 42, 0.6)" stroke="#0EA5E9" strokeWidth="1.5" />
                        <text x="270" y="175" fill="#7DD3FC" fontSize="12" fontWeight="bold" textAnchor="middle" letterSpacing="2">
                          [ B1 - PARKING ZONE A & VEHICLE ENTRY ]
                        </text>

                        <rect x="510" y="50" width="440" height="240" fill="rgba(15, 23, 42, 0.6)" stroke="#0EA5E9" strokeWidth="1.5" />
                        <text x="730" y="175" fill="#7DD3FC" fontSize="12" fontWeight="bold" textAnchor="middle" letterSpacing="2">
                          [ B2 - PARKING ZONE B & EV CHARGERS ]
                        </text>

                        <rect x="50" y="310" width="900" height="235" fill="rgba(15, 23, 42, 0.5)" stroke="#0EA5E9" strokeWidth="1.5" />
                        <text x="500" y="430" fill="#7DD3FC" fontSize="13" fontWeight="bold" textAnchor="middle" letterSpacing="2">
                          [ B3 - ELECTRICAL SUBSTATION & BACKUP GENERATORS ]
                        </text>
                      </>
                    )}
                  </svg>
                )}

                {/* Helpful prompt if 0 pins placed on current floor */}
                {placedOnThisFloor.length === 0 && !isEditMode && (
                  <div className="relative z-20 text-center p-5 rounded-2xl bg-[#121629]/90 border border-purple-500/30 backdrop-blur-md max-w-sm shadow-2xl pointer-events-auto">
                    <div className="w-10 h-10 rounded-full bg-purple-600/20 border border-purple-400/40 text-purple-300 flex items-center justify-center mx-auto mb-2 text-lg">
                      <AimOutlined />
                    </div>
                    <h3 className="text-white text-xs font-bold mb-1">
                      {FLOORS.find((f) => f.id === activeFloor)?.name} Blueprint
                    </h3>
                    <p className="text-slate-400 text-[11px] mb-3">
                      No cameras currently pinned on this floor. Enable Edit mode or upload your custom floorplan image.
                    </p>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsEditMode(true)}
                        className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold transition shadow cursor-pointer"
                      >
                        <EditOutlined /> Edit & Drag Pins
                      </button>
                      <button
                        type="button"
                        onClick={() => floorplanFileInputRef.current?.click()}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-purple-200 rounded-lg text-xs font-semibold transition cursor-pointer"
                      >
                        <UploadOutlined /> Upload PNG
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Render Placed Pins on Floorplan ── */}
                {placedOnThisFloor.map((cam) => {
                  const isSelected = selectedCamera?.id === cam.id;
                  const hasAlert = cam.hasAlert;
                  const isOnline = cam.status === 1 || cam.isStreaming === 1 || cam.isStreaming === true;
                  const alertName = cam.activeAlert?.objectName || cam.activeAlert?.alertType || 'Active Alert';

                  return (
                    <div
                      key={cam.id}
                      style={{
                        position: 'absolute',
                        left: `${cam.coords.x}%`,
                        top: `${cam.coords.y}%`,
                        transform: 'translate(-50%, -50%)',
                        zIndex: isSelected ? 45 : hasAlert ? 40 : 25,
                        cursor: isEditMode ? 'grab' : 'pointer',
                      }}
                      onMouseDown={(e) => handlePinMouseDown(e, cam.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isEditMode) {
                          setSelectedCamera(isSelected ? null : cam);
                        }
                      }}
                      className="group select-none transition-transform hover:scale-110 active:scale-95"
                    >
                      {/* ── ACTIVE INCIDENT: BLINKING RED RADAR WAVES ── */}
                      {hasAlert && (
                        <>
                          <span
                            className="absolute -inset-3.5 rounded-full bg-red-500 pointer-events-none"
                            style={{
                              animation: 'radar-ring 1.6s cubic-bezier(0, 0, 0.2, 1) infinite',
                            }}
                          />
                          <span
                            className="absolute -inset-6 rounded-full bg-red-600 pointer-events-none"
                            style={{
                              animation: 'radar-ring-delayed 1.6s cubic-bezier(0, 0, 0.2, 1) infinite 0.5s',
                            }}
                          />
                        </>
                      )}

                      {/* ── ALERT TAG ABOVE PIN ── */}
                      {hasAlert && (
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap z-50 pointer-events-none">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider bg-red-600 text-white shadow-[0_0_12px_#ef4444] border border-red-300 animate-bounce">
                            <WarningOutlined />
                            {alertName}
                          </span>
                        </div>
                      )}

                      {/* ── Main Camera Marker Badge ── */}
                      <div
                        className={`relative flex items-center justify-center w-8 h-8 rounded-full shadow-lg transition-all ${
                          hasAlert
                            ? 'bg-red-500 text-white border-2 border-red-200 shadow-[0_0_18px_#ef4444]'
                            : isOnline
                            ? 'bg-gradient-to-tr from-purple-700 to-indigo-600 text-white border-2 border-purple-300 shadow-[0_0_12px_rgba(168,85,247,0.5)]'
                            : 'bg-slate-700 text-slate-400 border-2 border-slate-500 shadow-md'
                        } ${isSelected ? 'ring-4 ring-cyan-400 scale-125' : ''}`}
                      >
                        <VideoCameraOutlined className="text-sm" />

                        {/* Status Dot */}
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-black ${
                            hasAlert
                              ? 'bg-red-300 animate-ping'
                              : isOnline
                              ? 'bg-emerald-400 shadow-[0_0_5px_#22c55e]'
                              : 'bg-slate-500'
                          }`}
                        />
                      </div>

                      {/* ── Camera Name Label ── */}
                      <div className="absolute top-9 left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none flex items-center gap-1">
                        <span className="px-1.5 py-0.5 rounded bg-black/85 backdrop-blur-xs text-[9px] font-bold text-slate-200 border border-white/10 shadow drop-shadow-md">
                          {cam.name || `Cam #${cam.id}`}
                        </span>
                      </div>

                      {/* Remove pin badge in Edit Mode */}
                      {isEditMode && (
                        <button
                          type="button"
                          onClick={(e) => handleRemovePin(e, cam.id)}
                          className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-red-600 hover:bg-red-500 text-white text-[10px] flex items-center justify-center shadow cursor-pointer"
                          title="Remove pin from floorplan"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Floorplan Footer Status */}
              <div className="absolute bottom-3 left-3 z-20 flex items-center gap-3 bg-[#121629]/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-purple-500/20 text-[10px] text-slate-300 pointer-events-none shadow-lg">
                <span className="font-bold text-white">
                  🏢 {FLOORS.find((f) => f.id === activeFloor)?.name}:
                </span>
                <span className="text-purple-300 font-semibold">{placedOnThisFloor.length} Pinned</span>
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_#ef4444] animate-ping" />
                  <span className="text-red-400 font-bold">
                    {alertsCountPerFloor[activeFloor] || 0} Alerts
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────── */}
        {/* CAMERA CLICK MODAL / POPOVER WITH LIVE STREAM BUTTON           */}
        {/* ───────────────────────────────────────────────────────────── */}
        {selectedCamera && (
          <div
            className="absolute z-50 bg-[#121629]/95 backdrop-blur-xl border border-purple-500/40 text-white rounded-2xl shadow-2xl p-4 w-80 transition-all animate-in fade-in zoom-in-95 duration-150"
            style={{
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-2 border-b border-purple-500/20 pb-2.5 mb-2.5">
              <div className="flex items-center gap-2 truncate">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center text-base ${
                    selectedCamera.hasAlert ? 'bg-red-500/20 text-red-400' : 'bg-purple-500/20 text-purple-300'
                  }`}
                >
                  <VideoCameraOutlined />
                </div>
                <div className="truncate">
                  <h4 className="text-xs font-bold text-white truncate" title={selectedCamera.name}>
                    {selectedCamera.name || `Camera #${selectedCamera.id}`}
                  </h4>
                  <span className="text-[10px] text-slate-400">ID: {selectedCamera.id}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedCamera(null)}
                className="text-slate-400 hover:text-white p-1 rounded transition cursor-pointer text-xs"
              >
                <CloseOutlined />
              </button>
            </div>

            {/* Meta info */}
            <div className="grid grid-cols-2 gap-2 mb-3 text-[11px]">
              <div className="bg-slate-900/60 p-2 rounded-lg border border-white/5">
                <span className="text-slate-400 block text-[9px] uppercase tracking-wider font-semibold">Zone / Site</span>
                <span className="text-slate-200 font-medium truncate block">
                  {selectedCamera.zone_name || selectedCamera.zone || 'Noida Sector 142'}
                </span>
              </div>
              <div className="bg-slate-900/60 p-2 rounded-lg border border-white/5">
                <span className="text-slate-400 block text-[9px] uppercase tracking-wider font-semibold">Status</span>
                <span
                  className={`font-bold inline-flex items-center gap-1 ${
                    selectedCamera.hasAlert
                      ? 'text-red-400'
                      : selectedCamera.isOnline
                      ? 'text-emerald-400'
                      : 'text-slate-400'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      selectedCamera.hasAlert
                        ? 'bg-red-400'
                        : selectedCamera.isOnline
                        ? 'bg-emerald-400'
                        : 'bg-slate-400'
                    }`}
                  />
                  {selectedCamera.hasAlert
                    ? 'ALERT ACTIVE'
                    : selectedCamera.isOnline
                    ? 'ONLINE'
                    : 'OFFLINE'}
                </span>
              </div>
            </div>

            {/* Active Incident Snapshot */}
            {selectedCamera.hasAlert && (
              <div className="bg-red-950/40 border border-red-500/40 rounded-xl p-2.5 mb-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold text-red-300 uppercase tracking-wider flex items-center gap-1">
                    <WarningOutlined /> Live Incident
                  </span>
                  <span className="text-[9px] text-red-300/80 font-mono">
                    {selectedCamera.activeAlert?.regDate
                      ? new Date(selectedCamera.activeAlert.regDate).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'Live'}
                  </span>
                </div>

                {selectedCamera.activeAlert?.framePath ? (
                  <div className="w-full h-24 bg-black rounded-lg overflow-hidden border border-red-500/30 mb-1.5 flex items-center justify-center">
                    <AlertSnapshot
                      path={selectedCamera.activeAlert.framePath}
                      cameraName={selectedCamera.camera_name}
                      alt="Alert Snapshot"
                      width="100%"
                      height={96}
                      className="w-full h-full object-cover"
                      preview={false}
                    />
                  </div>
                ) : null}

                <p className="text-xs text-red-100 font-semibold mb-0">
                  {selectedCamera.activeAlert?.objectName || 'Threat'} Detected
                </p>
              </div>
            )}

            {/* Action: Open Live Feed */}
            <button
              type="button"
              onClick={() => {
                if (onOpenLiveStream) {
                  onOpenLiveStream(selectedCamera.id);
                }
              }}
              className="w-full py-2 bg-gradient-to-r from-purple-700 to-indigo-600 hover:from-purple-600 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer active:scale-98"
            >
              <EyeOutlined className="text-sm" /> 👁️ View Live Feed
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return mainContent;
}
