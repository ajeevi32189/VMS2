import React from 'react';
import { Card, Skeleton } from 'antd';
import { FaVideo, FaServer, FaHdd, FaNetworkWired } from 'react-icons/fa';
import { useDeviceInventory } from '../../contexts/DeviceInventoryContext';

const SystemHealth = () => {
  const { cameraCount, nvrCount, loading } = useDeviceInventory();

  // Assuming standard ratios for demo if real health endpoint doesn't exist yet
  // In a real scenario, this would come from a dedicated /Health endpoint
  const stats = [
    {
      title: 'Cameras',
      value: `${cameraCount}`,
      subtitle: 'Online',
      icon: <FaVideo className="text-pink-500 text-2xl" />,
      color: 'bg-pink-100',
    },
    {
      title: 'NVRs',
      value: `${nvrCount}`,
      subtitle: 'Online',
      icon: <FaServer className="text-purple-500 text-2xl" />,
      color: 'bg-purple-100',
    },
    {
      title: 'Storage',
      value: '75%',
      subtitle: 'Used',
      icon: <FaHdd className="text-orange-500 text-2xl" />,
      color: 'bg-orange-100',
    },
    {
      title: 'Bandwidth',
      value: '62%',
      subtitle: 'Used',
      icon: <FaNetworkWired className="text-blue-500 text-2xl" />,
      color: 'bg-blue-100',
    },
  ];

  return (
    <Card
      title={<span className="text-purple-800 font-semibold text-lg">System Health</span>}
      className="rounded-2xl shadow-lg bg-white border border-purple-100 h-full"
      styles={{ header: { borderBottom: '1px solid #f3e8ff', padding: '12px 20px' }, body: { padding: '16px' } }}
    >
      {loading ? (
         <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array(4).fill(0).map((_, i) => <Skeleton.Input key={i} active style={{ width: '100%', height: 60 }} />)}
         </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
          {stats.map((stat, idx) => (
            <div key={idx} className="flex flex-col items-center p-3 border border-gray-100 rounded-lg shadow-sm hover:shadow-md transition">
              <div className={`p-3 rounded-full ${stat.color} mb-2`}>
                {stat.icon}
              </div>
              <h4 className="text-xs text-gray-500 font-medium mb-1">{stat.title}</h4>
              <span className="text-xl font-bold text-gray-800">{stat.value}</span>
              <span className="text-xs text-green-500">{stat.subtitle}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

export default SystemHealth;
