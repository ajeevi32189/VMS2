import React, { useState, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  FaBars,
  FaExpand,
  FaCompress,
  FaBell,
  FaUserCircle,
  FaSignOutAlt,
  FaCaretDown,
  FaSave,
  FaTrash,
  FaKey,
} from "react-icons/fa";
import { FullscreenOutlined, FullscreenExitOutlined } from "@ant-design/icons";
import { Select, Tooltip, Modal, Input, Popover } from "antd";
import { useAuth } from "../Authentication/AuthContext";
import { callLogoutAPI } from "../utils/axiosInstance";
import Cookies from "js-cookie";

const { Option } = Select;

const Header = ({ onToggle, onToggleLiveSidebar }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState("");
  const [hasNewAlerts, setHasNewAlerts] = useState(true);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [openMenu, setOpenMenu] = useState(null);
  // Screen position of the currently open nav dropdown, computed from the
  // clicked button's bounding rect (see note near <nav> below on why).
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  // Live stream grid controls
  const [liveGridSize, setLiveGridSize] = useState(
    () => Number(localStorage.getItem("gridSize")) || 2
  );
  const [liveIsFullscreen, setLiveIsFullscreen] = useState(false);

  // Saved views
  const [savedViews, setSavedViews] = useState(() => {
    try { return JSON.parse(localStorage.getItem("savedGridViews") || "[]"); }
    catch { return []; }
  });
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [viewName, setViewName] = useState("");

  const location = useLocation();
  const { role, user, permissions, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const userEmail = user?.email || "User";
  const profileRef = useRef();
  const menuRef = useRef();

  const isLivePage = location.pathname.startsWith("/live/stream");

  const menuItems = [
    {
      key: "video-management",
      label: "Video Management",
      children: [
        { key: "dashboard", label: "Dashboard", path: "/dashboard" },
        { key: "live", label: "Live Stream", path: "/live/stream" },
        { key: "recordings", label: "Recordings", path: "/recordings" },
        { key: "fencing", label: "Fencing", path: "/fencing" },
      ],
    },
    {
      key: "smart-detection",
      label: "Smart Detection",
      children: [
        { key: "fire", label: "Fire Detection", path: "/fire" },
        { key: "smoke", label: "Smoke Detection", path: "/smoke" },
        { key: "rodent", label: "Rodent Detection", path: "/rodent" },
        { key: "crowd", label: "Crowd Detection", path: "/crowd" },
        { key: "anpr", label: "ANPR Detection", path: "/anpr" },
        { key: "intrusion", label: "Intrusion Detection", path: "/intrusion" },
        { key: "facial", label: "Facial Recognition", path: "/facial" },
        { key: "abandoned", label: "Abandoned Object", path: "/abandoned" },
        { key: "tamper", label: "Tamper Detection", path: "/tamper" },
        { key: "video-upload-analytics", label: "Video Analytics", path: "/video-analytics" },
      ],
    },
    {
      key: "device-management",
      label: "Devices",
      children: [
        { key: "cameras", label: "Cameras", path: "/devices/cameras" },
        { key: "nvrs", label: "NVRs", path: "/devices/nvrs" },
        { key: "region", label: "Region", path: "/devices/zones" },
        { key: "warehouse", label: "Location", path: "/devices/locations" },
      ],
    },
    {
      key: "config-management",
      label: "Configuration",
      children: [
        { key: "camera-config", label: "Camera Data", path: "/camera/detail" },
      ],
    },
    {
      key: "user-management",
      label: "User Management",
      roles: ["Admin", "viewer"], // Allow viewer to see the menu
      children: [
        { key: "users", label: "Users", path: "/users", permission: "user.read" },
        { key: "roles", label: "Roles", path: "/roles", permission: "role.read" },
        { key: "permissions", label: "Permissions", path: "/permissions", permission: "permission.read" },
        { key: "assign_permissions", label: "Assign Permissions", path: "/assign/permissions", permission: "permission.write" },
      ],
    },
    {
      key: "ticket-management",
      label: "Ticket Management",
      roles: ["Admin", "viewer", "user"],
      children: [
        { key: "tickets", label: "Tickets", path: "/tickets" },
        { key: "sla", label: "SLA Config", path: "/tickets/sla" },
      ],
    },
    {
      key: "reports",
      label: "Reports",
      children: [
        { key: "alerts", label: "Event Reports", path: "/reports/alerts" },
      ],
    },
    {
      key: "about",
      label: "About VMS",
      children: [
        { key: "overview", label: "Overview", path: "/about/overview" },
      ],
    },
    { key: "audit", label: "Audit", path: "/audit" },
  ];

  // Filter menu items based on role AND permissions
  const filteredMenuItems = menuItems
  .map(menu => {
    if (menu.children) {
      const filteredChildren = menu.children.filter(child => {
        if (child.key === "users" && (role || "").toLowerCase() === "viewer") return true;
        if (child.permission) {
          return hasPermission(child.permission);
        }
        return true;
      });
      return { ...menu, children: filteredChildren };
    }
    return menu; // items without children pass through unchanged
  })
  .filter(item => {
    if (item.children && item.children.length === 0) return false;

    if (item.roles) {
      if (item.key === "user-management" && (role || "").toLowerCase() === "viewer") {
        return item.children && item.children.length > 0;
      }
      return item.roles.some(r => r.toLowerCase() === (role || "").toLowerCase());
    }
    return true;
  });

  // Clock
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString([], {
          hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
        })
      );
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Sync grid size from LiveStreaming
  useEffect(() => {
    const onGridSizeChange = (e) => setLiveGridSize(e.detail);
    window.addEventListener("liveGridSizeChange", onGridSizeChange);
    return () => window.removeEventListener("liveGridSizeChange", onGridSizeChange);
  }, []);

  // Sync live fullscreen state
  useEffect(() => {
    const onLiveFsChange = (e) => setLiveIsFullscreen(e.detail);
    window.addEventListener("liveFullscreenChange", onLiveFsChange);
    return () => window.removeEventListener("liveFullscreenChange", onLiveFsChange);
  }, []);

  // Sync app fullscreen state with browser native fullscreen
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Sync saved views if updated from elsewhere
  useEffect(() => {
    const onViewsChange = () => {
      try { setSavedViews(JSON.parse(localStorage.getItem("savedGridViews") || "[]")); }
      catch {}
    };
    window.addEventListener("savedViewsUpdated", onViewsChange);
    return () => window.removeEventListener("savedViewsUpdated", onViewsChange);
  }, []);

  // Outside click closes menus
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        profileRef.current && !profileRef.current.contains(e.target) &&
        menuRef.current && !menuRef.current.contains(e.target)
      ) {
        setShowProfileMenu(false);
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // App fullscreen
  const toggleFullscreen = () => {
    const doc = window.document;
    const docEl = doc.documentElement;
    const requestFS = docEl.requestFullscreen || docEl.mozRequestFullScreen ||
      docEl.webkitRequestFullscreen || docEl.msRequestFullscreen;
    const cancelFS = doc.exitFullscreen || doc.mozCancelFullScreen ||
      doc.webkitExitFullscreen || doc.msExitFullscreen;
    if (!doc.fullscreenElement && !doc.mozFullScreenElement &&
        !doc.webkitFullscreenElement && !doc.msFullscreenElement) {
      if (requestFS) {
        requestFS.call(docEl).then(() => setIsFullscreen(true)).catch(() => {
          setIsFullscreen(true);
        });
      }
    } else {
      if (cancelFS) {
        cancelFS.call(doc).then(() => setIsFullscreen(false)).catch(() => {
          setIsFullscreen(false);
        });
      }
    }
  };

  // Live grid fullscreen
  const toggleLiveFullscreen = () => {
    window.dispatchEvent(new CustomEvent("liveToggleFullscreen"));
  };

  // Live grid size
  const handleLiveGridChange = (value) => {
    setLiveGridSize(value);
    localStorage.setItem("gridSize", value);
    window.dispatchEvent(new CustomEvent("liveSetGridSize", { detail: value }));
  };

  // Save current grid view
  const handleSaveView = () => {
    const name = viewName.trim();
    if (!name) return;
    const currentCams = JSON.parse(localStorage.getItem("gridCams") || "[]");
    const currentSize = Number(localStorage.getItem("gridSize")) || 2;
    const newView = { name, gridCams: currentCams, gridSize: currentSize, id: Date.now() };
    const updated = [...savedViews, newView];
    setSavedViews(updated);
    localStorage.setItem("savedGridViews", JSON.stringify(updated));
    window.dispatchEvent(new Event("savedViewsUpdated"));
    setViewName("");
    setShowSaveModal(false);
  };

  // Load a saved view
  const handleLoadView = (view) => {
    localStorage.setItem("gridCams", JSON.stringify(view.gridCams));
    localStorage.setItem("gridSize", view.gridSize);
    window.dispatchEvent(new CustomEvent("liveSetGridSize", { detail: view.gridSize }));
    window.dispatchEvent(new Event("gridCamsUpdated"));
    setLiveGridSize(view.gridSize);
  };

  // Delete a saved view
  const handleDeleteView = (id, e) => {
    e.stopPropagation();
    const updated = savedViews.filter((v) => v.id !== id);
    setSavedViews(updated);
    localStorage.setItem("savedGridViews", JSON.stringify(updated));
    window.dispatchEvent(new Event("savedViewsUpdated"));
  };

  const savedViewsContent = (
    <div className="bg-white rounded-xl shadow-lg border border-purple-100">
      {savedViews.length > 0 ? (
        savedViews.map((view) => (
          <div
            key={view.id}
            className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-purple-50 cursor-pointer"
          >
            <div className="min-w-0" onClick={() => handleLoadView(view)}>
              <div className="text-xs font-semibold text-[#3B1E54] truncate">{view.name}</div>
              <div className="text-[10px] text-gray-500">{view.gridSize}×{view.gridSize}</div>
            </div>
            <button
              onClick={(e) => handleDeleteView(view.id, e)}
              className="text-gray-400 hover:text-red-500"
              title="Delete view"
            >
              <FaTrash className="text-[10px]" />
            </button>
          </div>
        ))
      ) : (
        <div className="px-3 py-2 text-xs text-gray-500">No saved views yet</div>
      )}
    </div>
  );

  return (
    <>
      <header className="flex flex-col bg-white text-gray-800 shadow-md z-50 relative">
        <style>{`.vms-header-row2::-webkit-scrollbar{display:none}`}</style>

        {/*
          ── ROW 1 : primary bar (always exactly 60px, never scrolls, never overflows) ──
          Profile/Logout, notifications and app-fullscreen live here so they are
          ALWAYS reachable no matter how narrow the window is or how many nav /
          live-page controls exist in row 2 below.
        */}
        <div className="h-[60px] min-h-[60px] flex items-center justify-between gap-2 px-4 sm:px-6">
          {/* Mobile toggle */}
          <button
            onClick={onToggle}
            className="md:hidden w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-md hover:bg-purple-100"
            title="Toggle Sidebar"
          >
            <FaBars className="text-xl text-[#3B1E54]" />
          </button>

          {/* Welcome + Time */}
          <div className="flex items-center gap-2 flex-shrink min-w-0">
            <FaUserCircle className="text-xl text-[#9864db] flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#3B1E54] leading-tight truncate">Welcome, {role || "User"}</p>
              <p className="text-[9px] text-gray-500 leading-none truncate">{userEmail}</p>
            </div>
          </div>

          {/* Right actions: always visible, never pushed off-screen */}
          <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
            {/* App fullscreen */}
            <button
              onClick={toggleFullscreen}
              title="Toggle Fullscreen"
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-purple-100 transition"
            >
              {isFullscreen
                ? <FaCompress className="text-base text-[#3B1E54]" />
                : <FaExpand className="text-base text-[#3B1E54]" />
              }
            </button>

            {/* Notifications */}
            <button
              onClick={() => { onToggleLiveSidebar?.(); setHasNewAlerts(false); }}
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-purple-100 transition relative"
              title="Alerts"
            >
              <FaBell className="text-base text-[#3B1E54]" />
              {hasNewAlerts && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
              )}
            </button>

            {/* Profile */}
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setShowProfileMenu(!showProfileMenu)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-purple-100 transition"
                title="Profile"
              >
                <div className="w-7 h-7 rounded-full bg-purple-100 border border-[#9864db] flex items-center justify-center text-[#9864db] font-bold text-xs select-none">
                  {userEmail?.[0]?.toUpperCase() || "U"}
                </div>
              </button>
              {showProfileMenu && (
                <div className="absolute right-0 top-12 w-48 max-w-[calc(100vw-2rem)] bg-white border border-purple-200 rounded-lg shadow-lg z-50">
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-purple-200">
                    <div className="w-10 h-10 rounded-full bg-purple-100 border border-purple-300 flex items-center justify-center text-[#3B1E54] font-bold text-base select-none shrink-0">
                      {userEmail?.[0]?.toUpperCase() || "U"}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#3B1E54] truncate">{role || "User"}</p>
                      <p className="text-xs text-gray-500 truncate">{userEmail}</p>
                    </div>
                  </div>
                  <ul>
                    <li
                      onClick={() => {
                        setShowProfileMenu(false);
                        navigate("/profile");
                      }}
                      className="px-4 py-2 text-sm hover:bg-purple-50 cursor-pointer flex items-center gap-2"
                    >
                      <FaUserCircle className="text-sm text-purple-600" />
                      My Profile
                    </li>
                    <li
                      onClick={() => { setShowProfileMenu(false); navigate("/change-password"); }}
                      className="px-4 py-2 text-sm hover:bg-purple-50 cursor-pointer flex items-center gap-2"
                    >
                      <FaKey className="text-sm" />
                      Change Password
                    </li>
                    <li
                      onClick={async () => {
                        setShowProfileMenu(false);
                        await callLogoutAPI();
                        logout();
                        navigate("/login");
                      }}
                      className="px-4 py-2 text-sm text-red-500 hover:bg-purple-50 cursor-pointer flex items-center gap-2"
                    >
                      <FaSignOutAlt className="text-sm" />
                      Logout
                    </li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>

        {/*
          ── ROW 2 : nav (desktop, lg+) + live-page controls ──
          This row is horizontally scrollable on its own (overflow-x-auto), so if
          it doesn't fit the window it scrolls INSIDE itself instead of pushing
          row 1 (and the logout button) off-screen. On the live page it is shown
          at every screen size, since the grid controls belong there; on other
          pages it only appears from lg (desktop) upward, matching the old nav.
        */}
        <div
          className={`vms-header-row2 ${isLivePage ? "flex" : "hidden lg:flex"} items-center gap-2 h-11 min-h-[44px] px-4 sm:px-6 border-t border-gray-100 overflow-x-auto`}
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          onScroll={() => setOpenMenu(null)}
        >
          {/*
            Nav dropdown panels use position:fixed (computed from the clicked
            button's getBoundingClientRect) instead of position:absolute.
            Reason: this row scrolls horizontally (overflow-x-auto), and per
            the CSS overflow spec that also makes overflow-y "auto" under the
            hood — any absolutely-positioned child would get clipped/hidden
            by this row's box instead of floating above the page. Fixed
            positioning escapes that clipping.
          */}
          <nav ref={menuRef} className="hidden lg:flex items-center lg:gap-1 xl:gap-2 flex-shrink-0">
  {filteredMenuItems.map((menu) =>
    menu.children ? (
      <div key={menu.key} className="relative">
        <button
          type="button"
          onClick={(e) => {
            if (openMenu === menu.key) {
              setOpenMenu(null);
              return;
            }
            const rect = e.currentTarget.getBoundingClientRect();
            setMenuPos({ top: rect.bottom + 8, left: rect.left });
            setOpenMenu(menu.key);
          }}
          className={`h-8 lg:px-2 xl:px-3 inline-flex items-center gap-1 rounded-full border border-purple-200 lg:text-xs xl:text-[13px] font-semibold whitespace-nowrap transition ${
            menu.children.some((item) => location.pathname.startsWith(item.path))
              ? "bg-purple-500 text-white border-purple-500"
              : "bg-white text-[#3B1E54] hover:bg-purple-50 hover:border-purple-300"
          }`}
        >
          {menu.label}
          <FaCaretDown className="text-[10px]" />
        </button>
        {openMenu === menu.key && (
          <div
            className="fixed min-w-[180px] rounded-2xl border border-purple-100 bg-white shadow-xl ring-1 ring-black/5 z-50"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            {menu.children.map((item) => (
              <Link
                key={item.key}
                to={item.path}
                onClick={() => setOpenMenu(null)}
                className={`block px-4 py-2 text-sm transition ${
                  location.pathname.startsWith(item.path)
                    ? "bg-purple-50 text-purple-700"
                    : "text-gray-700 hover:bg-purple-50"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    ) : (
      // Plain link item (no dropdown), e.g. Audit
      <Link
        key={menu.key}
        to={menu.path}
        className={`h-8 lg:px-2 xl:px-3 inline-flex items-center gap-1 rounded-full border border-purple-200 lg:text-xs xl:text-[13px] font-semibold whitespace-nowrap transition ${
          location.pathname.startsWith(menu.path)
            ? "bg-purple-500 text-white border-purple-500"
            : "bg-white text-[#3B1E54] hover:bg-purple-50 hover:border-purple-300"
        }`}
      >
        {menu.label}
      </Link>
    )
  )}
</nav>

          {/* ── LIVE PAGE CONTROLS ── */}
          {isLivePage && (
            <div className="flex items-center gap-1.5 flex-shrink-0 lg:border-l lg:border-gray-200 lg:pl-3 lg:ml-1">

              {/* Fullscreen grid */}
              <button
                onClick={toggleLiveFullscreen}
                title="Toggle grid fullscreen"
                className="flex items-center justify-center gap-1 px-2.5 rounded-md border border-gray-200 hover:bg-purple-50 text-xs text-gray-700 transition h-8 flex-shrink-0"
              >
                {liveIsFullscreen
                  ? <FullscreenExitOutlined className="text-sm" />
                  : <FullscreenOutlined className="text-sm" />
                }
                <span className="text-[11px] font-medium">{liveIsFullscreen ? "Exit" : "Full"}</span>
              </button>

              {/* Grid size */}
              <Select
                value={liveGridSize}
                onChange={handleLiveGridChange}
                style={{ width: 70, height: 32, flexShrink: 0 }}
              >
                <Option value={2}>2 × 2</Option>
                <Option value={3}>3 × 3</Option>
                <Option value={4}>4 × 4</Option>
              </Select>

              {/* Divider */}
              <div className="h-5 w-px bg-gray-200 mx-0.5 flex-shrink-0" />

              {/* Save current view icon button */}
              <Tooltip title="Save current grid layout as a view">
                <button
                  onClick={() => setShowSaveModal(true)}
                  className="flex items-center justify-center w-8 h-8 rounded-md border border-purple-300 bg-purple-50 hover:bg-purple-100 text-purple-700 transition flex-shrink-0"
                  type="button"
                >
                  <FaSave className="text-xs" />
                </button>
              </Tooltip>

              {/* Saved views icon dropdown */}
              <Popover
                content={savedViewsContent}
                placement="bottomRight"
                trigger="click"
                overlayStyle={{ minWidth: 260 }}
              >
                <Tooltip title="Open saved views">
                  <button
                    className="flex items-center justify-center h-8 px-2 rounded-md border border-purple-300 bg-white hover:bg-purple-50 text-purple-700 transition flex-shrink-0"
                    type="button"
                  >
                    <FaSave className="text-xs" />
                    <FaCaretDown className="text-[9px] ml-0.5" />
                  </button>
                </Tooltip>
              </Popover>
            </div>
          )}
        </div>
      </header>

      {/* Save View Modal */}
      <Modal
        open={showSaveModal}
        title="Save Current Grid View"
        onCancel={() => { setShowSaveModal(false); setViewName(""); }}
        onOk={handleSaveView}
        okText="Save"
        okButtonProps={{ disabled: !viewName.trim(), className: "bg-purple-600 border-purple-600" }}
        width={360}
      >
        <p className="text-sm text-gray-500 mb-3">
          Give this layout a name. It saves which cameras are in the grid and the grid size.
        </p>
        <Input
          placeholder="e.g. Office Cams, Entry View..."
          value={viewName}
          onChange={(e) => setViewName(e.target.value)}
          onPressEnter={handleSaveView}
          maxLength={30}
          autoFocus
        />
      </Modal>
    </>
  );
};

export default Header;