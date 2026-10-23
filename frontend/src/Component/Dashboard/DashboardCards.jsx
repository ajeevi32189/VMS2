import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from 'antd';
import { FaVideo, FaRunning, FaBell, FaMapMarkerAlt, FaLayerGroup, FaServer, FaDrawPolygon } from 'react-icons/fa';
import axios from 'axios';
import { useDeviceInventory } from '../../contexts/DeviceInventoryContext';
import { useAlertData } from '../../contexts/AlertDataContext';
import { ROI_API_URL } from '../../config';

const DashboardCards = () => {
  const {
    cameraCount,
    cameras,
    nvrCount,
    loading: inventoryLoading,
  } = useDeviceInventory();

  const { alertsCount, loading: alertLoading } = useAlertData();
  
  const [totalFences, setTotalFences] = useState(0);
  const [fencesLoading, setFencesLoading] = useState(false);

  useEffect(() => {
    const fetchFences = async () => {
      setFencesLoading(true);
      try {
        const res = await axios.get(`${ROI_API_URL}/api/v1/rois`);
        const rois = Array.isArray(res.data) ? res.data : (res.data?.data || res.data?.rois || []);
        
        // Sum up all sections across all cameras to get total active fence zones
        let zoneCount = 0;
        rois.forEach(roi => {
           if (Array.isArray(roi.sections)) {
             zoneCount += roi.sections.length;
           }
        });
        setTotalFences(zoneCount);
      } catch (err) {
        console.error("Failed to fetch ROIs for KPI:", err);
      } finally {
        setFencesLoading(false);
      }
    };
    fetchFences();
  }, []);

  const loading = inventoryLoading || alertLoading || fencesLoading;
  
  // Calculate active streams based on camera configuration
  const activeStreams = (cameras || []).filter(c => c.isStreaming === 1 || c.isStreaming === true).length;

  const cards = [
    { title: 'Total Cameras', count: cameraCount || 0, subtitle: 'Configured cameras', icon: <FaVideo className="text-xl text-pink-500" />, link: '/devices/cameras', bg: 'bg-pink-100' },
    { title: 'Active Streams', count: activeStreams || 0, subtitle: 'Live streaming enabled', icon: <FaVideo className="text-xl text-green-500" />, link: '/devices/cameras', bg: 'bg-green-100' },
    { title: 'Total NVRs', count: nvrCount || 0, subtitle: 'Connected Recorders', icon: <FaServer className="text-xl text-blue-500" />, link: '/devices/nvrs', bg: 'bg-blue-100' },
    { title: 'Total Events', count: alertsCount || 0, subtitle: 'Total processed events', icon: <FaBell className="text-xl text-purple-500" />, link: '/reports/alerts', bg: 'bg-purple-100' },
    { title: 'Total Fence Zones', count: totalFences, subtitle: 'Intrusion boundaries', icon: <FaDrawPolygon className="text-xl text-orange-500" />, link: '/fencing', bg: 'bg-orange-100' },
  ];

  return (
    <div className="p-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      {loading
        ? Array(5).fill(0).map((_, idx) => (
            <div key={idx} className="rounded-xl shadow-sm p-4 h-32 bg-white border border-gray-100">
              <Skeleton active paragraph={{ rows: 1 }} title={false} />
            </div>
          ))
        : cards.map((card, idx) => (
            <div key={idx} className={`bg-white rounded-xl shadow-sm border border-gray-100 p-4 h-32 flex flex-col justify-between hover:shadow-md transition-shadow relative overflow-hidden`}>
              {/* Optional top accent border */}
              <div className={`absolute top-0 left-0 w-full h-1 ${card.bg}`}></div>
              
              <div className="flex items-center justify-between">
                 <div className="flex items-center gap-3">
                   <div className={`${card.bg} p-3 rounded-xl shadow-sm`}>{card.icon}</div>
                   <div>
                     <h2 className="text-sm font-semibold text-gray-500">{card.title}</h2>
                     <p className="text-2xl font-bold text-gray-800">{card.count}</p>
                   </div>
                 </div>
              </div>
              <div className="mt-2 pt-2 border-t border-gray-50 flex items-center justify-between">
                <Link to={card.link} className="text-xs font-medium text-gray-500 hover:text-purple-600 transition-colors">
                  {card.subtitle}
                </Link>
              </div>
            </div>
          ))
      }
    </div>
  );
};

export default DashboardCards;




////////////////RRRRRRRRRRRRRRRRR


// import React, { useEffect, useState } from "react";
// import { FaVideo, FaBell, FaChartLine, FaServer } from "react-icons/fa";
// import { Link } from "react-router-dom";
// import Cookies from "js-cookie";
// import { deviceApi } from "../../utils/axiosInstance";
// import { Skeleton, message } from "antd";

// const DashboardCards = () => {
//   const [cameraCount, setCameraCount] = useState(0);
//   const [eventCount, setEventCount] = useState(0);
//   const [nvrCount, setNvrCount] = useState(0);
//   const [loading, setLoading] = useState(false);

//   const userId = Cookies.get("userId"); // user ID from cookies

//   const fetchCounts = async () => {
//     try {
//       setLoading(true);

//       const [cameraRes, alertRes, nvrRes] = await Promise.all([
//         deviceApi.get(`/Camera/`, { params: { user_id: userId } }),
//         deviceApi.get(`/CameraAlert/`, { params: { userid: userId } }),
//         deviceApi.get(`/NVR/`, { params: { user_id: userId } }),
//       ]);

//       setCameraCount(cameraRes.data.count || cameraRes.data.length || 0);
//       setEventCount(alertRes.data.count || alertRes.data.length || 0);
//       setNvrCount(nvrRes.data.count || nvrRes.data.length || 0);
//     } catch (error) {
//       console.error("Error fetching dashboard counts:", error);
//       message.error("Failed to load dashboard data");
//     } finally {
//       setLoading(false);
//     }
//   };

//   useEffect(() => {
//     if (userId) fetchCounts();
//   }, [userId]);

//   const cards = [
//     {
//       title: "Cameras",
//       count: cameraCount,
//       subtitle: "Total active cameras",
//       icon: <FaVideo className="text-xl text-purple-500" />,
//       link: "/devices/cameras",
//       bg: "bg-purple-100",
//     },
//     {
//       title: "Events",
//       count: eventCount,
//       subtitle: "Recent security & safety events",
//       icon: <FaBell className="text-xl text-purple-500" />,
//       link: "/analytics",
//       bg: "bg-purple-100",
//     },
//     {
//       title: "Analytics",
//       count: eventCount,
//       subtitle: "AI-driven insights",
//       icon: <FaChartLine className="text-xl text-purple-500" />,
//       link: "/analytics",
//       bg: "bg-purple-100",
//     },
//     {
//       title: "NVRs",
//       count: nvrCount,
//       subtitle: "Total connected NVRs",
//       icon: <FaServer className="text-xl text-purple-500" />,
//       link: "/devices/nvrs",
//       bg: "bg-purple-100",
//     },
//   ];

//   return (
//     <div className="p-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
//       {loading
//         ? Array(4)
//             .fill(0)
//             .map((_, idx) => (
//               <div
//                 key={idx}
//                 className="rounded-lg border border-purple-200 shadow-lg p-2 h-40 bg-white"
//               >
//                 <Skeleton active paragraph={{ rows: 2 }} title={false} />
//               </div>
//             ))
//         : cards.map((card, idx) => (
//             <div
//               key={idx}
//               className={`${card.bg} rounded-lg border border-purple-200 shadow-lg p-2 h-40 flex flex-col justify-between transition duration-300 hover:shadow-xl`}
//             >
//               <div className="flex items-center justify-between">
//                 <h2 className="text-lg font-semibold text-purple-900">
//                   {card.title}
//                 </h2>
//                 <div className="bg-white p-2 rounded-full shadow">
//                   {card.icon}
//                 </div>
//               </div>
//               <div className="mt-2">
//                 <p className="text-2xl font-bold text-purple-900">
//                   {card.count}
//                 </p>
//                 <p className="text-xs text-purple-700 mt-1">{card.subtitle}</p>
//               </div>
//               <div className="text-right mt-1">
//                 <Link
//                   to={card.link}
//                   className="text-sm font-medium text-purple-800 underline hover:text-purple-950"
//                 >
//                   View All →
//                 </Link>
//               </div>
//             </div>
//           ))}
//     </div>
//   );
// };

// export default DashboardCards;





// import React from "react";
// import { FaVideo, FaBell, FaChartLine, FaServer } from "react-icons/fa";
// import { Link } from "react-router-dom";

// const DashboardCards = () => {
//   const cards = [
//     {
//       title: "Cameras",
//       count: 120,
//       subtitle: "Total active cameras",
//       icon: <FaVideo className="text-xl text-purple-500" />,
//       link: "/cameras",
//       bg: "bg-purple-100",
//     },
//     {
//       title: "Events",
//       count: 45,
//       subtitle: "Recent security & safety events",
//       icon: <FaBell className="text-xl text-purple-500" />,
//       link: "/events",
//       bg: "bg-purple-100",
//     },
//     {
//       title: "Analytics",
//       count: 88,
//       subtitle: "AI-driven insights",
//       icon: <FaChartLine className="text-xl text-purple-500" />,
//       link: "/analytics",
//       bg: "bg-purple-100",
//     },
//     {
//       title: "System Health",
//       count: 12,
//       subtitle: "NVRs & storage running fine",
//       icon: <FaServer className="text-xl text-purple-500" />,
//       link: "/system-health",
//       bg: "bg-purple-100",
//     },
//   ];

//   return (
//     <div className="p-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
//       {cards.map((card, idx) => (
//         <div
//           key={idx}
//           className={`${card.bg} rounded-lg border border-purple-200 shadow-lg p-2 h-40 flex flex-col justify-between transition duration-300 hover:shadow-xl`}
//         >
//           <div className="flex items-center justify-between">
//             <h2 className="text-lg font-semibold text-purple-900">{card.title}</h2>
//             <div className="bg-white p-2 rounded-full shadow">{card.icon}</div>
//           </div>
//           <div className="mt-2">
//             <p className="text-2xl font-bold text-purple-900">{card.count}</p>
//             <p className="text-xs text-purple-700 mt-1">{card.subtitle}</p>
//           </div>
//           <div className="text-right mt-1">
//             <Link
//               to={card.link}
//               className="text-sm font-medium text-purple-800 underline hover:text-purple-950"
//             >
//               View All →
//             </Link>
//           </div>
//         </div>
//       ))}
//     </div>
//   );
// };

// export default DashboardCards;
