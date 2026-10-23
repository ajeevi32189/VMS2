import React, { useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useDeviceInventory } from "../../contexts/DeviceInventoryContext";

// Fix default marker icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

// Custom icons
const onlineIcon = new L.Icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/190/190411.png",
  iconSize: [32, 32],
});

const offlineIcon = new L.Icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/463/463612.png",
  iconSize: [32, 32],
});

const recordingIcon = new L.Icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/727/727245.png",
  iconSize: [32, 32],
});

const streamingIcon = new L.Icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/483/483870.png",
  iconSize: [32, 32],
});

const MapComponent = () => {
  const { cameras, loading } = useDeviceInventory();

  // Convert camera API data → marker list
  const mapMarkers = useMemo(() => {
    if (!cameras) return [];

    return cameras.map((cam) => ({
      id: cam.id,
      name: cam.name,
      zone: cam.zone_name,
      lat: cam.location_name?.latitude,
      long: cam.location_name?.longitude,
      status: cam.status,
      isRecording: cam.isRecording,
      isStreaming: cam.isStreaming,
      nvr: cam.nvrId,
      brand: cam.brand,
      ip: cam.cameraIP,
      port: cam.port,
      date: cam.regDate,
    }));
  }, [cameras]);

  return (
    <div className="w-full h-[500px] rounded overflow-hidden shadow">
      <MapContainer
        center={[22.9734, 78.6569]}  // Center of India
        zoom={5}
        scrollWheelZoom={true}
        style={{ width: "100%", height: "100%" }}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {!loading &&
          mapMarkers.map((cam) => {
            if (!cam.lat || !cam.long) return null;

            // Choose icon
            const icon = cam.isRecording
              ? recordingIcon
              : cam.isStreaming
              ? streamingIcon
              : cam.status === 1
              ? onlineIcon
              : offlineIcon;

            return (
              <Marker key={cam.id} position={[cam.lat, cam.long]} icon={icon}>
                <Popup>
                  <div className="font-bold text-lg">{cam.name}</div>

                  <div><strong>Zone:</strong> {cam.zone}</div>
                  <div><strong>IP:</strong> {cam.ip}</div>
                  <div><strong>Port:</strong> {cam.port}</div>
                  <div><strong>NVR:</strong> {cam.nvr}</div>
                  <div><strong>Status:</strong> {cam.status === 1 ? "Online" : "Offline"}</div>

                  <div><strong>Recording:</strong> {cam.isRecording ? "Yes" : "No"}</div>
                  <div><strong>Streaming:</strong> {cam.isStreaming ? "Yes" : "No"}</div>

                  <div className="mt-2 text-gray-600 text-sm">
                    <div><strong>Lat:</strong> {cam.lat}</div>
                    <div><strong>Long:</strong> {cam.long}</div>
                  </div>

                  <div className="mt-2 text-xs text-gray-400">Created: {cam.date}</div>
                </Popup>
              </Marker>
            );
          })}
      </MapContainer>
    </div>
  );
};

export default MapComponent;





//////////////////////rrrrrrrrrrrrrrrrrrrrrr


// import React from "react";
// import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
// import L from "leaflet";
// import "leaflet/dist/leaflet.css";

// // Fix default marker icon issue
// delete L.Icon.Default.prototype._getIconUrl;
// L.Icon.Default.mergeOptions({
//   iconRetinaUrl:
//     "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
//   iconUrl:
//     "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
//   shadowUrl:
//     "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
// });

// const markers = [
//   { id: 1, position: [28.6139, 77.209], label: "New Delhi" },
//   { id: 2, position: [19.076, 72.8777], label: "Mumbai" },
//   { id: 3, position: [13.0827, 80.2707], label: "Chennai" },
//   { id: 4, position: [22.5726, 88.3639], label: "Kolkata" },
//   { id: 5, position: [12.9716, 77.5946], label: "Bangalore" },
// ];

// const MapComponent = () => {
//   return (
//     <div className="w-full h-[500px] rounded overflow-hidden shadow">
//       <MapContainer
//         center={[22.9734, 78.6569]} // Center of India
//         zoom={5}
//         scrollWheelZoom={true}
//         style={{ width: "100%", height: "100%" }}
//       >
//         <TileLayer
//           attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a>'
//           url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
//         />
//         {markers.map((marker) => (
//           <Marker key={marker.id} position={marker.position}>
//             <Popup>{marker.label}</Popup>
//           </Marker>
//         ))}
//       </MapContainer>
      
//     </div>
//   );
// };

// export default MapComponent;
