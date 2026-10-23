import React from 'react';
import { Skeleton, Card } from 'antd';
import { Link } from 'react-router-dom';
import { useAlertData } from '../../contexts/AlertDataContext';
import { AlertSnapshot, formatIndianDateTime } from '../../utils/imageUtils';

const RecentActivity = () => {
  const { alerts, loading } = useAlertData();

  return (
    <Card
      title={<span className="text-purple-800 font-semibold text-lg">Alert Summary</span>}
      extra={<Link to="/reports/alerts" className="text-sm font-medium text-purple-600 hover:underline">View All</Link>}
      className="rounded-2xl shadow-lg bg-white border border-purple-100"
      styles={{ header: { borderBottom: '1px solid #f3e8ff', padding: '12px 20px' }, body: { padding: '0' } }}
    >
      {loading ? (
        <div className="p-4 space-y-4">
          {Array(4).fill(0).map((_, idx) => (
             <Skeleton key={idx} active title={false} paragraph={{ rows: 2 }} />
          ))}
        </div>
      ) : (
        <div className="max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-200">
          {alerts.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {alerts.map(alert => {
                // Parse Python dict strings like "{'HIGH Intrusion': 1}"
                let title = 'Alert Detected';
                const rawName = alert.objectName || alert.alertType;
                if (rawName) {
                  if (typeof rawName === 'string' && rawName.includes('{')) {
                    try {
                      const parsed = JSON.parse(rawName.replace(/'/g, '"'));
                      const key = Object.keys(parsed)[0];
                      title = key ? `${key} Detected` : 'Alert Detected';
                    } catch {
                      const cleaned = rawName.replace(/[{}"']/g, '').split(':')[0].trim();
                      title = cleaned ? `${cleaned} Detected` : 'Alert Detected';
                    }
                  } else {
                    const str = String(rawName).trim();
                    title = /detected|alert/i.test(str) ? str : `${str} Detected`;
                  }
                }

                const combinedInfo = `${alert.objectName || ''} ${alert.alertType || ''} ${alert.severity || ''}`.toUpperCase();
                const isHigh = combinedInfo.includes('HIGH') || combinedInfo.includes('CRITICAL') || combinedInfo.includes('FIRE');
                const isLow = combinedInfo.includes('LOW');
                const badgeColor = isHigh
                  ? 'bg-red-100 text-red-700'
                  : isLow
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-orange-100 text-orange-700';
                const badgeText = isHigh ? 'High' : isLow ? 'Low' : 'Medium';
                
                return (
                  <li key={alert.id} className="p-4 hover:bg-slate-50 transition flex items-center justify-between">
                    <div className="flex gap-3 items-center">
                       {/* Camera thumbnail */}
                       {alert.framePath ? (
                         <AlertSnapshot
                           path={alert.framePath}
                           cameraName={alert.camera_name}
                           alt="Alert"
                           width={48}
                           height={40}
                           className="w-12 h-10 rounded object-cover flex-shrink-0"
                           preview={false}
                         />
                       ) : (
                         <div className="w-12 h-10 bg-gray-200 rounded object-cover flex-shrink-0 flex items-center justify-center text-xs text-gray-500">
                            Cam
                         </div>
                       )}
                       <div>
                         <p className="text-sm font-medium text-gray-800">
                           {title}
                         </p>
                         <p className="text-xs text-gray-500">
                           {alert.camera_name || `Camera #${alert.cameraId || 'N/A'}`}
                         </p>
                       </div>
                    </div>
                    <div className="text-right">
                       <p className="text-xs text-gray-500 mb-1">
                         {formatIndianDateTime(alert.regDate)}
                       </p>
                       <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${badgeColor}`}>
                         {badgeText}
                       </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="p-8 text-center text-gray-500 text-sm">No recent alerts found</div>
          )}
        </div>
      )}
    </Card>
  );
};

export default RecentActivity;




/////////////////RRRRRRRRRRRRRRR



// import React, { useEffect, useState } from "react";
// import Cookies from "js-cookie";
// import { message, Skeleton } from "antd";
// import { deviceApi } from "../../utils/axiosInstance";

// const RecentActivity = () => {
//   const [activities, setActivities] = useState([]);
//   const [loading, setLoading] = useState(false);
//   const userId = Cookies.get("userId");

//   const fetchAlerts = async () => {
//     try {
//       setLoading(true);
//       const res = await deviceApi.get(`/CameraAlert/`, {
//         params: {
//           userid: userId,
//           page: 1,
//           pageSize: 10,
//           search: "",
//           camera_id: "",
//         },
//       });
//       setActivities(res.data.results || []);
//     } catch (error) {
//       console.error("Error fetching camera alerts:", error);
//       message.error("Failed to fetch recent alerts");
//     } finally {
//       setLoading(false);
//     }
//   };

//   useEffect(() => {
//     if (userId) fetchAlerts();
//   }, [userId]);

//   return (
//     <div className="p-4 bg-purple-100 rounded-md shadow-sm border border-gray-200">
//       <h2 className="text-xl font-semibold text-gray-800 mb-3">Recent Alerts</h2>

//       {loading ? (
//         <div className="space-y-3">
//           {/* Show 5 skeletons for placeholder loading */}
//           {Array(5)
//             .fill(0)
//             .map((_, idx) => (
//               <div
//                 key={idx}
//                 className="p-3 rounded-md bg-white border-l-4 border-purple-200 shadow-sm"
//               >
//                 <Skeleton active title={false} paragraph={{ rows: 2 }} />
//               </div>
//             ))}
//         </div>
//       ) : (
//         <div className="space-y-2 max-h-64 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
//           {activities.length > 0 ? (
//             activities.map((alert) => (
//               <div
//                 key={alert.id}
//                 className="flex items-start justify-between p-3 rounded-md border-l-4 bg-purple-200 text-purple-700 shadow-sm"
//               >
//                 <div>
//                   <p className="text-sm font-medium text-gray-800">
//                     {alert.camera_name || "Unknown Camera"} —{" "}
//                     {alert.objectName || "No object"}
//                   </p>
//                   <p className="text-xs text-gray-500">
//                     {new Date(alert.regDate).toLocaleString()}
//                   </p>
//                 </div>
//                 <span className="text-xs font-medium px-2 py-1 rounded-md bg-white shadow-inner">
//                   Alert #{alert.id}
//                 </span>
//               </div>
//             ))
//           ) : (
//             <p className="text-gray-600 text-sm text-center">No recent alerts</p>
//           )}
//         </div>
//       )}
//     </div>
//   );
// };

// export default RecentActivity;


// import React, { useEffect, useState } from "react";

// const RecentActivity = () => {
//   const [activities, setActivities] = useState([]);

//   useEffect(() => {
//     const fakeData = [
//       {
//         id: 1,
//         type: "Camera Online",
//         message: "Camera #12 came online.",
//         color: "bg-purple-200 text-purple-700",
//         time: "2 mins ago",
//       },
//       {
//         id: 2,
//         type: "Fire Alert",
//         message: "🔥 Fire detected in Zone 4.",
//         color: "bg-purple-200 text-purple-700",
//         time: "10 mins ago",
//       },
//       {
//         id: 3,
//         type: "AI Analytics",
//         message: "New vehicle count report generated.",
//         color: "bg-purple-200 text-purple-700",
//         time: "30 mins ago",
//       },
//       {
//         id: 4,
//         type: "Rodent Alert",
//         message: "Rodent activity detected in storage.",
//         color: "bg-purple-200 text-purple-700",
//         time: "1 hour ago",
//       },
//       {
//         id: 5,
//         type: "Camera Offline",
//         message: "Camera #09 went offline.",
//         color: "bg-purple-200 text-purple-700",
//         time: "2 hours ago",
//       },
//       {
//         id: 6,
//         type: "Fire Alert",
//         message: "Fire test alert Zone 2.",
//         color: "bg-purple-200 text-purple-700",
//         time: "5 hours ago",
//       },
//       {
//         id: 7,
//         type: "AI Analytics",
//         message: "Heatmap generated for lobby.",
//         color: "bg-purple-200 text-purple-700",
//         time: "Today",
//       },
//     ];
//     setActivities(fakeData);
//   }, []);

//   return (
//     <div className="p-4 bg-purple-100 rounded-md shadow-sm border border-gray-200">
//       <h2 className="text-xl font-semibold text-gray-800 mb-3">Recent Alerts</h2>

//       <div className="space-y-2 max-h-64 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
//         {activities.map((activity) => (
//           <div
//             key={activity.id}
//             className={`flex items-start justify-between p-3 rounded-md border-l-4 ${activity.color} shadow-sm`}
//           >
//             <div>
//               <p className="text-sm font-medium text-gray-800">
//                 {activity.message}
//               </p>
//               <p className="text-xs text-gray-500">{activity.time}</p>
//             </div>
//             <span className="text-xs font-medium px-2 py-1 rounded-md bg-white shadow-inner">
//               {activity.type}
//             </span>
//           </div>
//         ))}
//       </div>
//     </div>
//   );
// };

// export default RecentActivity;
