import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import DashboardCards from './DashboardCards';
import RecentActivity from './RecentActivity';
import WeeklyAlertGraph from './WeeklyAlertGraph';
import EventsByType from './EventsByType';
import LiveViewGrid from './LiveViewGrid';
import EMapView from './EMapView';
import TopAlertingCameras from './TopAlertingCameras';
import { DeviceInventoryProvider } from '../../contexts/DeviceInventoryContext';
import { AlertDataProvider } from '../../contexts/AlertDataContext';

const DashboardContent = () => {
  const [liveViewMode, setLiveViewMode] = useState('grid'); // 'grid' | 'emap'
  const [focusedCameraId, setFocusedCameraId] = useState(null);

  return (
    <div className="bg-slate-50 min-h-screen">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 p-4">
        {/* Top Row: KPIs */}
        <div className="lg:col-span-12">
          <DashboardCards />
        </div>

        {/* Left Column (span 8) */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          {/* Live View */}
          <div className="bg-white rounded-2xl shadow-lg border border-purple-100 p-4 flex flex-col h-[420px]">
            <div className="flex flex-wrap justify-between items-center mb-3 gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold text-gray-800">Live View</h2>
              </div>

              <div className="flex items-center gap-3">
                {/* Sleek Segmented Tab Toggle */}
                <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 shadow-inner">
                  <button
                    type="button"
                    onClick={() => setLiveViewMode('grid')}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      liveViewMode === 'grid'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-purple-700'
                    }`}
                  >
                    <span>🎥</span> Video Grid
                  </button>
                  <button
                    type="button"
                    onClick={() => setLiveViewMode('emap')}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      liveViewMode === 'emap'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-purple-700'
                    }`}
                  >
                    <span>🗺️</span> E-Map View
                  </button>
                </div>

                <Link
                  to="/live/stream"
                  className="text-xs font-semibold text-purple-600 hover:text-purple-800 hover:underline"
                >
                  View All Cameras
                </Link>
              </div>
            </div>

            <div className="flex-grow bg-gray-100 rounded-lg overflow-hidden relative">
              {liveViewMode === 'grid' ? (
                <LiveViewGrid highlightedCameraId={focusedCameraId} />
              ) : (
                <EMapView
                  onOpenLiveStream={(camId) => {
                    setFocusedCameraId(camId);
                    setLiveViewMode('grid');
                  }}
                />
              )}
            </div>
          </div>

          {/* Events Over Time */}
          <div className="h-[300px]">
            <WeeklyAlertGraph />
          </div>
        </div>

        {/* Right Column (span 4) */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          {/* Events by Type */}
          <div style={{ height: '260px' }}>
            <EventsByType />
          </div>

          {/* Alert Summary - flex-1 fills remaining space */}
          <div className="flex-1 min-h-[180px] bg-white rounded-2xl shadow-lg border border-purple-100 overflow-hidden">
            <RecentActivity />
          </div>

          {/* Most Active Cameras - fixed height at bottom */}
          <div style={{ height: '260px' }}>
            <TopAlertingCameras />
          </div>
        </div>
      </div>
    </div>
  );
};

const Dashboard = () => (
  <DeviceInventoryProvider>
    <AlertDataProvider>
      <DashboardContent />
    </AlertDataProvider>
  </DeviceInventoryProvider>
);

export default Dashboard;
