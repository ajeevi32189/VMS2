import React, { useMemo, useEffect, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, Skeleton } from 'antd';
import { useAlertData } from '../../contexts/AlertDataContext';
import { deviceApi } from '../../utils/axiosInstance';

// Color palette for dynamically generated categories
const COLOR_PALETTE = ['#3B82F6', '#EC4899', '#8B5CF6', '#F59E0B', '#EF4444', '#06B6D4', '#10B981', '#F97316', '#6366F1', '#8B5CF6'];

// Helper to format raw API names like "face_analysis" to "Face Analysis"
const formatName = (name) => {
  if (!name) return 'Unknown';
  return name.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
};

const EventsByType = () => {
  const { alerts, loading: alertsLoading } = useAlertData();
  const [detectionGroups, setDetectionGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);

  // Fetch dynamic analytics groups from API
  useEffect(() => {
    const fetchGroups = async () => {
      setGroupsLoading(true);
      try {
        const res = await deviceApi.get("/DetectionGroups/");
        const groups = res.data.results || res.data || [];
        setDetectionGroups(groups.map(g => g.name));
      } catch (err) {
        console.error("Failed to fetch DetectionGroups:", err);
        // Fallback categories if API fails
        setDetectionGroups(['Intrusion', 'Facial Recognition', 'ANPR', 'Crowd Detection', 'Fire', 'Rodent']);
      } finally {
        setGroupsLoading(false);
      }
    };
    fetchGroups();
  }, []);

  const chartData = useMemo(() => {
    let total = 0;
    
    // Initialize map based on dynamically fetched groups
    const categoryMap = {};
    detectionGroups.forEach(group => {
       categoryMap[group.toLowerCase()] = 0;
    });
    categoryMap['others'] = 0;

    if (alerts && alerts.length > 0) {
      alerts.forEach(alert => {
        let rawName = alert.objectName || alert.alertType || '';
        
        // Clean Python dict strings like "{'HIGH Intrusion': 1}"
        if (typeof rawName === 'string' && rawName.includes('{')) {
          try {
            const parsed = JSON.parse(rawName.replace(/'/g, '"'));
            const key = Object.keys(parsed)[0];
            if (key) rawName = key;
          } catch {
            rawName = rawName.replace(/[{}"']/g, '').split(':')[0].trim();
          }
        }

        const alertName = String(rawName).toLowerCase();
        total++;
        
        let matched = false;
        // Try to match the alert name with our dynamic detection groups
        for (const group of detectionGroups) {
          const groupNameLower = group.toLowerCase();
          
          if (alertName.includes(groupNameLower) || 
             groupNameLower.includes(alertName) ||
             (groupNameLower.includes('face') && alertName.includes('face')) ||
             (groupNameLower.includes('crowd') && alertName.includes('crowd')) ||
             (groupNameLower.includes('abandon') && alertName.includes('abandon')) ||
             (groupNameLower.includes('anpr') && (alertName.includes('plate') || alertName.includes('vehicle') || alertName.includes('anpr'))) ||
             (groupNameLower.includes('smoke') && (alertName.includes('smoke') || alertName.includes('fire'))) ||
             (groupNameLower.includes('fire') && (alertName.includes('fire') || alertName.includes('smoke'))) ||
             (groupNameLower.includes('rodent') && alertName.includes('rodent')) ||
             (groupNameLower.includes('intrusion') && alertName.includes('intrusion')) ||
             (groupNameLower.includes('tamper') && alertName.includes('tamper'))) {
             
             categoryMap[groupNameLower] = (categoryMap[groupNameLower] || 0) + 1;
             matched = true;
             break;
          }
        }
        
        if (!matched) {
           categoryMap['others'] = (categoryMap['others'] || 0) + 1;
        }
      });
    }

    // Format data and assign colors
    let formattedData = [];
    let colorIndex = 0;
    
    detectionGroups.forEach(group => {
      formattedData.push({
         name: formatName(group),
         value: categoryMap[group.toLowerCase()],
         color: COLOR_PALETTE[colorIndex % COLOR_PALETTE.length]
      });
      colorIndex++;
    });
    
    formattedData.push({
      name: 'Others',
      value: categoryMap['others'],
      color: '#9CA3AF'
    });

    // Sort so categories with > 0 alerts are at the top, then alphabetically
    formattedData.sort((a, b) => {
      if (b.value !== a.value) return b.value - a.value;
      return a.name.localeCompare(b.name);
    });

    return { data: formattedData, total };
  }, [alerts, detectionGroups]);

  const { data, total } = chartData;
  const activeData = data.filter(d => d.value > 0);
  const loading = alertsLoading || groupsLoading;

  const renderCustomLegend = () => {
    return (
      <ul className="flex flex-col gap-1.5 h-full text-[12px] overflow-y-auto pr-1 scrollbar-thin">
        {data.map((entry, index) => {
          const percentage = total > 0 ? ((entry.value / total) * 100).toFixed(0) : 0;
          return (
            <li key={`item-${index}`} className={`flex items-center justify-between gap-2 shrink-0 ${entry.value === 0 ? 'opacity-40' : ''}`}>
              <div className="flex items-center gap-2 truncate">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.color }}></span>
                <span className="text-gray-700 font-medium truncate" title={entry.name}>{entry.name}</span>
              </div>
              <span className="text-gray-900 font-semibold shrink-0">{entry.value} {entry.value > 0 && <span className="text-gray-500 font-normal">({percentage}%)</span>}</span>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <Card
      title={<span className="text-purple-800 font-semibold text-[15px]">Events by Type</span>}
      className="rounded-2xl shadow-lg bg-white border border-purple-100 h-full flex flex-col overflow-hidden"
      styles={{ header: { borderBottom: '1px solid #f3e8ff', padding: '10px 16px', minHeight: 'auto' }, body: { padding: '12px', flex: 1, overflow: 'hidden' } }}
    >
      {loading ? (
        <div className="flex flex-col justify-center items-center h-full">
           <Skeleton.Avatar active size={120} shape="circle" />
        </div>
      ) : true ? (
        <div className="h-full flex items-center overflow-hidden">
          <div className="w-[45%] h-full relative flex items-center justify-center shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={activeData}
                  innerRadius={45}
                  outerRadius={65}
                  paddingAngle={2}
                  dataKey="value"
                  stroke="none"
                >
                  {activeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                   contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '12px' }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Center Total Text */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-xl font-bold text-gray-800">{total}</span>
              <span className="text-[10px] text-gray-500">Total</span>
            </div>
          </div>
          <div className="w-[55%] h-full pl-3 flex flex-col overflow-hidden py-1">
             {renderCustomLegend()}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-full text-gray-500 text-sm">
           No event data available
        </div>
      )}
    </Card>
  );
};

export default EventsByType;
