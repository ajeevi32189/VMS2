import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import LiveEventsSidebar from './LiveEventsSidebar';
import CustomEventForm from '../Component/Pages/Analytics/CustomEventForm';
import LiveAlertToaster from '../Component/Notifications/LiveAlertToaster';

const Layout = ({ children, collapsed, setCollapsed }) => {
  const [showSidebar, setShowSidebar] = useState(false);
  const [customEventPopupOpen, setCustomEventPopupOpen] = useState(false);
  const [isLiveSidebarOpen, setIsLiveSidebarOpen] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const isLivePage = location.pathname.startsWith('/live/stream');

  const hideScrollbarStyle = {
    height: '100%',
    overflowY: 'auto',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
  };
  const hideScrollbarWebkit = `::-webkit-scrollbar { display: none; }`;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white relative">

      {/* ── Mobile Sidebar ── */}
      <div
        className={`fixed z-50 h-full flex flex-col transition-all duration-300 ease-in-out
          ${showSidebar ? 'translate-x-0' : '-translate-x-full'} md:hidden
          ${collapsed ? 'w-16' : 'w-64'}`}
        style={{ transitionProperty: 'width, transform', overflow: 'visible' }}
      >
        <style>{hideScrollbarWebkit}</style>
        <div style={{ ...hideScrollbarStyle, overflow: 'visible' }}>
          <Sidebar
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed(!collapsed)}
            onMobileMenuClick={() => setShowSidebar(false)}
            onCustomEventClick={() => setCustomEventPopupOpen(true)}
          />
        </div>
      </div>

      {/* Mobile Backdrop */}
      {showSidebar && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* ── LEFT LIVE STREAM BUTTON ──
          Always visible on ALL pages.
          Clicking navigates to /live/stream.
          Slightly bigger on live page, normal on others.
      ── */}
      <button
        type="button"
        onClick={() => navigate('/live/stream')}
        title="Go to Live Stream"
        className={`
          hidden md:flex fixed left-0 z-40
          items-center justify-center
          rounded-r-full border border-purple-500 bg-purple-600 hover:bg-purple-700
          shadow-lg text-white font-semibold uppercase tracking-[0.15em]
          text-[7px] transition-all duration-200
          ${isLivePage ? 'top-[104px] h-24 w-12' : 'top-[60px] lg:top-[104px] h-20 w-10'}
        `}
      >
        <span className="-rotate-90 inline-flex flex-col items-center justify-center text-[7px] leading-tight">
          <span>Live</span>
          <span>Stream</span>
        </span>
      </button>

      {/* ── MAIN CONTENT ── */}
      <div
        className={`flex flex-col flex-1 z-10 bg-white text-[#E6E6FA] transition-all duration-300 ease-in-out ${
          showSidebar
            ? 'blur-sm select-none pointer-events-none md:pointer-events-auto md:blur-0'
            : ''
        }`}
      >
        <Header
          onToggle={() => setShowSidebar(!showSidebar)}
          onToggleLiveSidebar={() => setIsLiveSidebarOpen((open) => !open)}
        />
        <main className="flex-1 pl-1 md:pl-10 overflow-y-auto bg-white text-black rounded-tl-md rounded-tr-md">
          {children}
        </main>

        {/* Custom Event Popup */}
        {customEventPopupOpen && (
          <div
            style={{
              position: 'fixed', left: 65, top: 0,
              width: 'calc(100vw - 65px)', height: '100vh',
              zIndex: 99999, background: 'rgba(0,0,0,0.38)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div style={{
              background: '#fff', borderRadius: 16,
              boxShadow: '0 4px 24px #9164d966', padding: 32,
              minWidth: 600, maxWidth: '80vw',
            }}>
              <h2 className="text-xl font-bold mb-4 text-black">Create Custom Event</h2>
              <CustomEventForm onClose={() => setCustomEventPopupOpen(false)} />
            </div>
          </div>
        )}
      </div>

      {/* Right Sidebar - Live Events */}
      {isLiveSidebarOpen && (
        <LiveEventsSidebar
          isOpen={isLiveSidebarOpen}
          onClose={() => setIsLiveSidebarOpen(false)}
        />
      )}

      {/* Global Real-time Alert Notifications */}
      <LiveAlertToaster />
    </div>
  );
};

export default Layout;