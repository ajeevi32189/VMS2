import React, { useMemo } from 'react';
import { useAlertData } from '../../contexts/AlertDataContext';
import { useDeviceInventory } from '../../contexts/DeviceInventoryContext';
import { Card, Progress } from 'antd';
import { CameraOutlined } from '@ant-design/icons';

const TopAlertingCameras = () => {
  const { alerts, loading: alertLoading } = useAlertData();
  const { cameras, loading: camLoading } = useDeviceInventory();
  
  const loading = alertLoading || camLoading;

  const topCameras = useMemo(() => {
    // 1. Initialize a map with all configured cameras starting at 0 alerts
    const camCounts = {};
    (cameras || []).forEach(cam => {
      const name = cam.name || `Cam_${cam.id}`;
      camCounts[name] = 0;
    });

    // 2. Count actual alerts for the matched cameras
    (alerts || []).forEach(alert => {
      const camName = alert.cameraName || alert.camera_name || alert.rtspurl?.split('/').pop() || 'Unknown Camera';
      // If the alert's camera isn't in our configured list, add it dynamically
      accCount(camCounts, camName);
    });

    function accCount(obj, key) {
      obj[key] = (obj[key] || 0) + 1;
    }

    // 3. Sort by count descending and take top 5
    const sorted = Object.entries(camCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // Take top 5 (which will include 0-alert cameras if < 5 active)

    // 4. Calculate max for progress bar scaling
    const maxCount = sorted.length > 0 && sorted[0].count > 0 ? sorted[0].count : 1;
    
    return sorted.map(item => ({ ...item, percent: (item.count / maxCount) * 100 }));
  }, [alerts, cameras]);

  return (
    <Card
      title={<span className="text-gray-800 font-bold text-lg">Most Active Cameras</span>}
      className="rounded-2xl shadow-sm bg-white border border-gray-100 h-full"
      styles={{ header: { borderBottom: '1px solid #f3e8ff', padding: '10px 16px', minHeight: 'auto' }, body: { padding: '12px', height: 'calc(100% - 45px)', overflow: 'hidden' } }}
    >
      <div className="flex flex-col gap-3 h-full overflow-y-auto pr-1">
        {loading ? (
           <div className="text-center text-gray-400 mt-10">Loading data...</div>
        ) : topCameras.length === 0 ? (
          <div className="text-center text-gray-400 mt-10">No alerts detected recently.</div>
        ) : (
          topCameras.map((cam, idx) => (
            <div key={idx} className="flex flex-col gap-1">
              <div className="flex justify-between items-center text-sm font-medium text-gray-700">
                <div className="flex items-center gap-2 truncate">
                   <CameraOutlined className="text-purple-500" />
                   <span className="truncate max-w-[150px] md:max-w-[180px]">{cam.name}</span>
                </div>
                <span className="text-purple-600 font-bold">{cam.count} alerts</span>
              </div>
              <Progress 
                percent={cam.percent} 
                showInfo={false} 
                strokeColor={{ '0%': '#c4b5fd', '100%': '#7c3aed' }}
                trailColor="#f3f4f6"
                size="small"
              />
            </div>
          ))
        )}
      </div>
    </Card>
  );
};

export default TopAlertingCameras;
