import React, { useMemo, useState } from 'react';
import { AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, Skeleton, Select } from 'antd';
import { useAlertData } from '../../contexts/AlertDataContext';

const WeeklyAlertGraph = () => {
  const { weeklyCounts, loading } = useAlertData();
  const [filter, setFilter] = useState('month'); // 'week' or 'month'

  const fullChartData = useMemo(() => {
    if (!weeklyCounts.length) return [];

    const today = new Date();
    return Array.from({ length: 30 }).map((_, idx) => {
      const date = new Date();
      date.setDate(today.getDate() - (29 - idx));
      const key = date.toISOString().split('T')[0];
      const match = weeklyCounts.find(item => item.date === key);
      return {
        day: date.toLocaleDateString('en-US', { day: '2-digit', month: 'short' }),
        total: match?.count || 0,
      };
    });
  }, [weeklyCounts]);

  const displayData = useMemo(() => {
    if (filter === 'week') {
      return fullChartData.slice(-7);
    }
    return fullChartData;
  }, [fullChartData, filter]);

  return (
    <Card
      title={<span className="text-gray-800 font-bold text-lg">Events Over Time</span>}
      extra={
        <Select
          value={filter}
          onChange={setFilter}
          className="w-32"
          options={[
            { value: 'week', label: 'This Week' },
            { value: 'month', label: 'This Month' },
          ]}
        />
      }
      className="rounded-2xl shadow-sm bg-white border border-gray-100 h-full"
      styles={{ header: { borderBottom: 'none', padding: '16px 20px 8px 20px' }, body: { padding: '16px' } }}
    >
      {loading ? (
        <div className="flex flex-col justify-center items-center h-72 space-y-4">
          <Skeleton.Input active style={{ width: 220, height: 20, borderRadius: 6 }} />
          <div className="w-full px-6 flex justify-around items-end h-48">
            {Array(7)
              .fill(0)
              .map((_, idx) => (
                <Skeleton.Button
                  key={idx}
                  active
                  style={{
                    width: 25,
                    height: `${40 + Math.random() * 60}px`,
                    borderRadius: 8,
                    background: 'linear-gradient(180deg,#ddd6fe 0%,#ede9fe 100%)',
                  }}
                />
              ))}
          </div>
          <Skeleton.Input active style={{ width: '60%', height: 10, borderRadius: 4 }} />
        </div>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={displayData}
              margin={{ top: 10, right: 10, left: -20, bottom: 30 }}
            >
              <defs>
                <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
              <XAxis
                dataKey="day"
                stroke="#9CA3AF"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                dy={10}
              />
              <YAxis 
                stroke="#9CA3AF" 
                fontSize={12} 
                tickLine={false} 
                axisLine={false} 
                dx={-10}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #E5E7EB',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  color: '#1F2937',
                }}
              />
              <Area
                type="linear"
                dataKey="total"
                stroke="#3B82F6"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#colorTotal)"
                dot={{ r: 4, strokeWidth: 2, fill: '#ffffff', stroke: '#3B82F6' }}
                activeDot={{ r: 7, strokeWidth: 0, fill: '#2563EB' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
};

export default WeeklyAlertGraph;




///////////////////////////////////RRRRRRRRRRRRRRRRRRRRRRR


// import React, { useEffect, useState } from "react";
// import {
//   BarChart,
//   Bar,
//   CartesianGrid,
//   XAxis,
//   YAxis,
//   Tooltip,
//   ResponsiveContainer,
// } from "recharts";
// import { Card, Skeleton } from "antd";
// import Cookies from "js-cookie";
// import { deviceApi } from "../../utils/axiosInstance";

// const WeeklyAlertGraph = () => {
//   const [chartData, setChartData] = useState([]);
//   const [loading, setLoading] = useState(false);

//   // Helper → convert JS Date → YYYY-MM-DD
//   const formatDate = (date) => date.toISOString().split("T")[0];

//   useEffect(() => {
//     const fetchData = async () => {
//       try {
//         setLoading(true);

//         // ✅ Get user_id from cookies
//         const userId = Cookies.get("userId");
//         if (!userId) {
//           console.warn("⚠️ No userId found in cookies!");
//           return;
//         }

//         // 🗓️ Get previous 7 days (today inclusive)
//         const today = new Date();
//         const lastWeek = new Date();
//         lastWeek.setDate(today.getDate() - 6);

//         const fromDate = formatDate(lastWeek);
//         const toDate = formatDate(today);

//         // ✅ Build dynamic API endpoint
//         const url = `/CameraalertsCount/?user_id=${userId}&from_date=${fromDate}&to_date=${toDate}`;

//         // ✅ Fetch weekly alert counts
//         const res = await deviceApi.get(url);
//         const apiData = res.data || [];

//         // ✅ Map API data to day names
//         const dayMap = {};
//         apiData.forEach((item) => {
//           const dateObj = new Date(item.date);
//           const dayName = dateObj.toLocaleDateString("en-US", { weekday: "short" });
//           dayMap[dayName] = item.count;
//         });

//         // ✅ Build 7-day series (Sun → Sat)
//         const orderedDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
//         const todayIndex = today.getDay();

//         // Start from (today - 6) → today
//         const last7 = Array.from({ length: 7 }).map((_, i) => {
//           const date = new Date();
//           date.setDate(today.getDate() - (6 - i));
//           const dName = date.toLocaleDateString("en-US", { weekday: "short" });
//           return { day: dName, total: dayMap[dName] || 0 };
//         });

//         setChartData(last7);
//       } catch (err) {
//         console.error("❌ Error fetching weekly camera alerts:", err);
//       } finally {
//         setLoading(false);
//       }
//     };

//     fetchData();
//   }, []);

//   return (
//     <Card
//       title={<span className="text-purple-800 font-semibold text-lg">Weekly Camera Alerts</span>}
//       className="rounded-2xl shadow-lg bg-gradient-to-b from-purple-50 to-white"
//       bordered={false}
//       headStyle={{
//         background: "transparent",
//         borderBottom: "none",
//         padding: "12px 20px",
//       }}
//       bodyStyle={{ padding: "0 16px 16px 16px" }}
//     >
//       {loading ? (
//         <div className="flex flex-col justify-center items-center h-72 space-y-4">
//           <Skeleton.Input active style={{ width: 220, height: 20, borderRadius: 6 }} />
//           <div className="w-full px-6 flex justify-around items-end h-48">
//             {Array(7)
//               .fill(0)
//               .map((_, idx) => (
//                 <Skeleton.Button
//                   key={idx}
//                   active
//                   style={{
//                     width: 25,
//                     height: `${40 + Math.random() * 60}px`,
//                     borderRadius: 8,
//                     background: "linear-gradient(180deg,#ddd6fe 0%,#ede9fe 100%)",
//                   }}
//                 />
//               ))}
//           </div>
//           <Skeleton.Input active style={{ width: "60%", height: 10, borderRadius: 4 }} />
//         </div>
//       ) : (
//         <div className="h-72">
//           <ResponsiveContainer width="100%" height="100%">
//             <BarChart
//               data={chartData}
//               barSize={25} // ✅ thinner bars (width doesn’t expand)
//               margin={{ top: 10, right: 10, left: 0, bottom: 10 }}
//             >
//               <CartesianGrid strokeDasharray="3 3" stroke="#E9D5FF" />
//               <XAxis
//                 dataKey="day"
//                 stroke="#7C3AED"
//                 fontSize={12}
//                 tickLine={false}
//                 axisLine={false}
//               />
//               <YAxis
//                 stroke="#7C3AED"
//                 fontSize={12}
//                 tickLine={false}
//                 axisLine={false}
//               />
//               <Tooltip
//                 contentStyle={{
//                   backgroundColor: "#f5f3ff",
//                   border: "1px solid #c4b5fd",
//                   borderRadius: "10px",
//                   color: "#5b21b6",
//                 }}
//                 cursor={{ fill: "#ede9fe" }}
//               />
//               <Bar
//                 dataKey="total"
//                 fill="url(#purpleGradient)"
//                 name="Alert Count"
//                 radius={[10, 10, 0, 0]}
//               />
//               <defs>
//                 <linearGradient id="purpleGradient" x1="0" y1="0" x2="0" y2="1">
//                   <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.9} />
//                   <stop offset="100%" stopColor="#c4b5fd" stopOpacity={0.7} />
//                 </linearGradient>
//               </defs>
//             </BarChart>
//           </ResponsiveContainer>
//         </div>
//       )}
//     </Card>
//   );
// };

// export default WeeklyAlertGraph;




// import React from "react";
// import {
//   BarChart,
//   Bar,
//   CartesianGrid,
//   XAxis,
//   YAxis,
//   Tooltip,
//   ResponsiveContainer,
//   Legend,
// } from "recharts";
// import { Card } from "antd";

// // ✅ Demo Data (replace with API data)
// const alertData = [
//   { day: "Mon", critical: 3, severe: 4, normal: 6 },
//   { day: "Tue", critical: 2, severe: 3, normal: 5 },
//   { day: "Wed", critical: 4, severe: 2, normal: 7 },
//   { day: "Thu", critical: 1, severe: 5, normal: 6 },
//   { day: "Fri", critical: 5, severe: 3, normal: 4 },
//   { day: "Sat", critical: 6, severe: 4, normal: 3 },
//   { day: "Sun", critical: 2, severe: 2, normal: 5 },
// ];

// const WeeklyAlertGraph = () => {
//   return (
//     <Card
//       title="Weekly Alerts"
//       className="rounded-2xl shadow-md border border-gray-100"
//       headStyle={{ fontWeight: "600", background: "#F3E8FF", padding: "8px 16px" }}
//       bodyStyle={{ background: "#F3E8FF", padding: "0" }}
//     >
//       <div className="h-68">
//         <ResponsiveContainer width="100%" height="100%">
//           <BarChart
//             data={alertData}
//             barCategoryGap="40%" // spacing between groups
//             barSize={10}         // ✅ thin bar width
//           >
//             <CartesianGrid strokeDasharray="3 3" stroke="#ddd6fe" />
//             <XAxis dataKey="day" stroke="#6D28D9" />
//             <YAxis stroke="#6D28D9" />
//             <Tooltip
//               contentStyle={{
//                 backgroundColor: "#ede9fe",
//                 border: "1px solid #a78bfa",
//                 borderRadius: "8px",
//               }}
//               cursor={{ fill: "#ddd6fe" }}
//             />
//             <Legend />

//             {/* Critical - Red */}
//             <Bar
//               dataKey="critical"
//               fill="#ef4444"
//               name="Critical"
//               radius={[5, 5, 0, 0]}
//             />

//             {/* Severe - Orange */}
//             <Bar
//               dataKey="severe"
//               fill="#f59e0b"
//               name="Severe"
//               radius={[5, 5, 0, 0]}
//             />

//             {/* Normal - Green */}
//             <Bar
//               dataKey="normal"
//               fill="#22c55e"
//               name="Normal"
//               radius={[5, 5, 0, 0]}
//             />
//           </BarChart>
//         </ResponsiveContainer>
//       </div>
//     </Card>
//   );
// };

// export default WeeklyAlertGraph;
