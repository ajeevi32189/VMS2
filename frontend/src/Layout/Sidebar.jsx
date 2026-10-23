import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  FaVideo,
  FaChartLine,
  FaBroadcastTower,
  FaFileVideo,
  FaFire,
  FaBug,
  FaServer,
  FaUsers,
  FaClipboardList,
  FaInfoCircle,
  FaShieldAlt,
  FaMapMarkerAlt,
  FaLayerGroup,
  FaUserShield,
  FaLock,
  FaTrash,
  FaBroom,
  FaUser,
  FaBox,
} from "react-icons/fa";
import { useAuth } from "../Authentication/AuthContext";
import { MdMenu, MdMenuOpen, MdExpandLess, MdExpandMore } from "react-icons/md";
import Logo from "../assets/logo.jpg";

const Sidebar = ({ collapsed, onToggleCollapse }) => {
  const location = useLocation();
  const { role, hasPermission } = useAuth();
  const [openMenus, setOpenMenus] = useState({});

  // 🔹 MENU DATA
  const menuItems = [
    {
      key: "video-management",
      label: "Video Management",
      icon: <FaVideo />,
      children: [
        { key: "dashboard", label: "Dashboard", icon: <FaChartLine />, path: "/dashboard" },
        { key: "live", label: "Live Stream", icon: <FaBroadcastTower />, path: "/live/stream" },
        { key: "recordings", label: "Recordings", icon: <FaFileVideo />, path: "/recordings" },
        { key: "fencing", label: "Fencing", icon: <FaLock />, path: "/fencing" },
      ],
    },
    {
      key: "smart-detection",
      label: "Smart Detection",
      icon: <FaBug />,
      children: [
        

        { key: "fire", label: "Fire Detection", icon: <FaFire />, path: "/fire" },
        { key: "smoke", label: "Smoke Detection", icon: <FaChartLine />, path: "/smoke" },
        { key: "rodent", label: "Rodent Detection", icon: <FaBug />, path: "/rodent" },
        { key: "crowd", label: "Crowd Detection", icon: <FaUsers />, path: "/crowd" },
        { key: "anpr", label: "ANPR Detection", icon: <FaVideo />, path: "/anpr" },
        { key: "intrusion", label: "Intrusion Detection", icon: <FaLock />, path: "/intrusion" },
        { key: "facial", label: "Facial Recognition", icon: <FaUser />, path: "/facial" },
        { key: "abandoned", label: "Abandoned Object", icon: <FaBox />, path: "/abandoned" },
        { key: "tamper", label: "Tamper Detection", icon: <FaShieldAlt />, path: "/tamper" },
        { key: "video-upload-analytics", label: "Video Analytics", icon: <FaFileVideo />, path: "/video-analytics" },
        // { key: "volumetric", label: "Warehouse Detection", icon: <FaFire />, path: "/volumetric" },
      ],
    },
    {
      key: "device-management",
      label: "Devices",
      icon: <FaServer />,
      children: [
        { key: "cameras", label: "Cameras", icon: <FaVideo />, path: "/devices/cameras" },
        { key: "nvrs", label: "NVRs", icon: <FaServer />, path: "/devices/nvrs" },
        { key: "region", label: "Region", icon: <FaMapMarkerAlt />, path: "/devices/zones" },
        { key: "warehouse", label: "Location", icon: <FaLayerGroup />, path: "/devices/locations" },
      ],
    },
    {
      key: "config-management",
      label: "Configuration",
      icon: <FaServer />,
      children: [
        { key: "camera-config", label: "Camera Data", icon: <FaVideo />, path: "/camera/detail" },
      ],
    },
    {
      key: "user-management",
      label: "User Management",
      icon: <FaUsers />,
      roles: ["Admin", "viewer"],
      children: [
        { key: "users", label: "Users", icon: <FaUsers />, path: "/users", permission: "user.read" },
        { key: "roles", label: "Roles", icon: <FaUserShield />, path: "/roles", permission: "role.read" },
        { key: "permissions", label: "Permissions", icon: <FaShieldAlt />, path: "/permissions", permission: "permission.read" },
        { key: "assign_permissions", label: "Assign Permissions", icon: <FaShieldAlt />, path: "/assign/permissions", permission: "permission.write" },
      ],
    },
    {
      key: "reports",
      label: "Reports",
      icon: <FaClipboardList />,
      children: [
        { key: "alerts", label: "Event Reports", icon: <FaClipboardList />, path: "/reports/alerts" },
        // { key: "analyticsreports", label: "Analytics Reports", icon: <FaClipboardList />, path: "/reports/analytics" },
      ],
    },
    {
      key: "about",
      label: "About VMS",
      icon: <FaInfoCircle />,
      children: [
        { key: "overview", label: "Overview", icon: <FaInfoCircle />, path: "/about/overview" },
      ],
    },
  ];

  // Filter based on role AND permissions
  const filteredMenuItems = menuItems
    .map(menu => {
      // If menu has children, filter children based on permissions
      if (menu.children) {
        const filteredChildren = menu.children.filter(child => {
          // Fallback for viewer to always see the Users page
          if (child.key === "users" && (role || "").toLowerCase() === "viewer") return true;

          if (child.permission) {
            return hasPermission(child.permission);
          }
          return true;
        });
        return { ...menu, children: filteredChildren };
      }
      return menu;
    })
    .filter(item => {
      // Hide if no children left after filtering (for menus that have children)
      if (item.children && item.children.length === 0) return false;

      // Existing role-based filtering
      if (item.roles) {
        // Special case: show User Management for viewers if they can see any children
        if (item.key === "user-management" && (role || "").toLowerCase() === "viewer") {
          return item.children && item.children.length > 0;
        }
        return item.roles.some(r => r.toLowerCase() === (role || "").toLowerCase());
      }
      return true;
    });

  // 🔹 Expand all menus when sidebar opens
  useEffect(() => {
    if (!collapsed) {
      const allOpen = {};
      menuItems.forEach((m) => (allOpen[m.key] = true));
      setOpenMenus(allOpen);
    }
  }, [collapsed]);

  // 🔹 Active menu
  const selectedKey = (() => {
    const path = location.pathname;
    for (let menu of menuItems) {
      for (let item of menu.children) {
        if (path.startsWith(item.path)) return item.key;
      }
    }
    return "";
  })();

  // 🔹 Parent click behavior
  const handleParentClick = (menuKey) => {
    if (collapsed) {
      // 👉 COLLAPSED → OPEN sidebar
      onToggleCollapse();
      setOpenMenus({ [menuKey]: true });
    } else {
      // 👉 OPEN → toggle submenu
      setOpenMenus((prev) => ({ ...prev, [menuKey]: !prev[menuKey] }));
    }
  };

  // 🔥 Live Stream click → collapse sidebar
  const handleMenuClick = (itemKey) => {
    if (itemKey === "live" && !collapsed) {
      onToggleCollapse();
    }
  };

  return (
    <div
      className={`${
        collapsed ? "w-16" : "w-64"
      } h-screen bg-white flex flex-col shadow-xl transition-all duration-300`}
    >
      {/* HEADER */}
      <div className="flex items-center justify-between p-4">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <img src={Logo} alt="Logo" className="h-10 w-10 rounded-full" />
            <span className="font-bold text-lg text-[#9357c9]">VMS</span>
          </div>
        )}
        <button
          onClick={onToggleCollapse}
          className="p-2 rounded-full bg-gray-100 hover:bg-purple-300"
        >
          {collapsed ? <MdMenu /> : <MdMenuOpen />}
        </button>
      </div>

      {/* MENU */}
      <div className="flex-1 overflow-y-auto px-2 space-y-2">
        {filteredMenuItems.map((menu) => (
          <div key={menu.key}>
            {/* Parent */}
            <div
              onClick={() => handleParentClick(menu.key)}
              className={`flex items-center justify-between p-2 rounded-lg cursor-pointer hover:bg-gray-100 ${
                collapsed ? "justify-center" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-lg text-purple-700">{menu.icon}</span>
                {!collapsed && <span className="font-semibold">{menu.label}</span>}
              </div>
              {!collapsed && (
                <span>
                  {openMenus[menu.key] ? <MdExpandLess /> : <MdExpandMore />}
                </span>
              )}
            </div>

            {/* Submenu */}
            {!collapsed && openMenus[menu.key] && (
              <div className="ml-6 mt-1 space-y-1">
                {menu.children.map((item) => (
                  <Link
                    key={item.key}
                    to={item.path}
                    onClick={() => handleMenuClick(item.key)}
                    className={`flex items-center gap-2 p-2 rounded-md text-sm transition ${
                      selectedKey === item.key
                        ? "bg-purple-600 text-white"
                        : "hover:bg-gray-100"
                    }`}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* FOOTER */}
      <div className="p-4">
        <div className="bg-gray-50 rounded-xl p-4 text-center shadow-inner">
          {!collapsed && (
            <>
              <p className="text-sm font-semibold text-purple-700">Video Management System</p>
              <p className="text-xs text-gray-500 mt-1">
                Powered by <span className="font-bold text-[#3B1E54]">Ajeevi</span>
              </p>
              <button className="mt-3 w-full rounded-lg bg-[#9864db] hover:bg-[#8754d1] text-white py-2 text-sm font-medium transition-all">
                Learn More
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Sidebar;




////////////////////////////////////////////////////////




// import React, { useEffect, useState } from "react";
// import { Link, useLocation } from "react-router-dom";
// import {
//   FaVideo,
//   FaChartLine,
//   FaBroadcastTower,
//   FaFileVideo,
//   FaFire,
//   FaBug,
//   FaServer,
//   FaUsers,
//   FaClipboardList,
//   FaInfoCircle,
//   FaShieldAlt,
//   FaMapMarkerAlt,
//   FaLayerGroup,
//   FaUserShield,
// } from "react-icons/fa";
// import { MdMenu, MdMenuOpen, MdExpandLess, MdExpandMore } from "react-icons/md";
// import Logo from "../assets/logo.jpg";

// const Sidebar = ({ collapsed, onToggleCollapse }) => {
//   const location = useLocation();
//   const [openMenus, setOpenMenus] = useState({});

//   // 🔹 MENU DATA
//   const menuItems = [
//     {
//       key: "video-management",
//       label: "Video Management",
//       icon: <FaVideo />,
//       children: [
//         { key: "dashboard", label: "Dashboard", icon: <FaChartLine />, path: "/dashboard" },
//         { key: "live", label: "Live Stream", icon: <FaBroadcastTower />, path: "/live/stream" },
//         { key: "recordings", label: "Recordings", icon: <FaFileVideo />, path: "/recordings" },
//       ],
//     },
//     {
//       key: "smart-detection",
//       label: "Smart Detection",
//       icon: <FaBug />,
//       children: [
//         { key: "fire", label: "Fire Detection", icon: <FaFire />, path: "/fire" },
//         { key: "smoke", label: "Smoke Detection", icon: <FaChartLine />, path: "/smoke" },
//         { key: "rodent", label: "Rodent Detection", icon: <FaFire />, path: "/rodent" },
//         { key: "volumetric", label: "Warehouse Detection", icon: <FaFire />, path: "/volumetric" },
//       ],
//     },
//     {
//       key: "device-management",
//       label: "Devices",
//       icon: <FaServer />,
//       children: [
//         { key: "cameras", label: "Cameras", icon: <FaVideo />, path: "/devices/cameras" },
//         { key: "nvrs", label: "NVRs", icon: <FaServer />, path: "/devices/nvrs" },
//         { key: "zones", label: "Zones", icon: <FaMapMarkerAlt />, path: "/devices/zones" },
//         { key: "locations", label: "Locations", icon: <FaLayerGroup />, path: "/devices/locations" },
//       ],
//     },
//     {
//       key: "user-management",
//       label: "User Management",
//       icon: <FaUsers />,
//       children: [
//         { key: "users", label: "Users", icon: <FaUsers />, path: "/users" },
//         { key: "roles", label: "Roles", icon: <FaUserShield />, path: "/roles" },
//         { key: "permissions", label: "Permissions", icon: <FaShieldAlt />, path: "/permissions" },
//         { key: "assign_permissions", label: "Assign Permissions", icon: <FaShieldAlt />, path: "/assign/permissions" },
//       ],
//     },
//     {
//       key: "reports",
//       label: "Reports",
//       icon: <FaClipboardList />,
//       children: [
//         { key: "alerts", label: "Event Reports", icon: <FaClipboardList />, path: "/reports/alerts" },
//         { key: "analyticsreports", label: "Analytics Reports", icon: <FaClipboardList />, path: "/reports/analytics" },
//       ],
//     },
//     {
//       key: "about",
//       label: "About VMS",
//       icon: <FaInfoCircle />,
//       children: [
//         { key: "overview", label: "Overview", icon: <FaInfoCircle />, path: "/about/overview" },
//       ],
//     },
//   ];

//   // 🔹 Expand all when sidebar opens
//   useEffect(() => {
//     if (!collapsed) {
//       const allOpen = {};
//       menuItems.forEach((m) => (allOpen[m.key] = true));
//       setOpenMenus(allOpen);
//     }
//   }, [collapsed]);

//   // 🔹 Active menu
//   const selectedKey = (() => {
//     const path = location.pathname;
//     for (let menu of menuItems) {
//       for (let item of menu.children) {
//         if (path.startsWith(item.path)) return item.key;
//       }
//     }
//     return "";
//   })();

//   // 🔹 Toggle submenu
//   const toggleMenu = (key) => {
//     setOpenMenus((prev) => ({ ...prev, [key]: !prev[key] }));
//   };

//   // 🔥 IMPORTANT: Live click → collapse sidebar
//   const handleMenuClick = (itemKey) => {
//     if (itemKey === "live" && !collapsed) {
//       onToggleCollapse();
//     }
//   };

//   return (
//     <div
//       className={`${
//         collapsed ? "w-16" : "w-64"
//       } h-screen bg-white flex flex-col shadow-xl transition-all duration-300`}
//     >
//       {/* HEADER */}
//       <div className="flex items-center justify-between p-4">
//         {!collapsed && (
//           <div className="flex items-center gap-2">
//             <img src={Logo} alt="Logo" className="h-10 w-10 rounded-full" />
//             <span className="font-bold text-lg text-[#9357c9]">VMS</span>
//           </div>
//         )}
//         <button
//           onClick={onToggleCollapse}
//           className="p-2 rounded-full bg-gray-100 hover:bg-purple-300"
//         >
//           {collapsed ? <MdMenu /> : <MdMenuOpen />}
//         </button>
//       </div>

//       {/* MENU */}
//       <div className="flex-1 overflow-y-auto px-2 space-y-2">
//         {menuItems.map((menu) => (
//           <div key={menu.key}>
//             {/* Parent */}
//             <div
//               onClick={() => (!collapsed ? toggleMenu(menu.key) : null)}
//               className={`flex items-center justify-between p-2 rounded-lg cursor-pointer hover:bg-gray-100 ${
//                 collapsed ? "justify-center" : ""
//               }`}
//             >
//               <div className="flex items-center gap-2">
//                 <span className="text-lg text-purple-700">{menu.icon}</span>
//                 {!collapsed && <span className="font-semibold">{menu.label}</span>}
//               </div>
//               {!collapsed && (
//                 <span>{openMenus[menu.key] ? <MdExpandLess /> : <MdExpandMore />}</span>
//               )}
//             </div>

//             {/* Submenu */}
//             {!collapsed && openMenus[menu.key] && (
//               <div className="ml-6 mt-1 space-y-1">
//                 {menu.children.map((item) => (
//                   <Link
//                     key={item.key}
//                     to={item.path}
//                     onClick={() => handleMenuClick(item.key)}
//                     className={`flex items-center gap-2 p-2 rounded-md text-sm transition ${
//                       selectedKey === item.key
//                         ? "bg-purple-600 text-white"
//                         : "hover:bg-gray-100"
//                     }`}
//                   >
//                     {item.icon}
//                     {item.label}
//                   </Link>
//                 ))}
//               </div>
//             )}
//           </div>
//         ))}
//       </div>

//       {/* FOOTER */}
//       {!collapsed && (
//         <div className="p-4 text-center text-sm text-gray-500">
//           Powered by <span className="font-bold text-purple-700">Ajeevi</span>
//         </div>
//       )}
//     </div>
//   );
// };

// export default Sidebar;




//////////////////// RRRRRRRRRRRRRRRRRRR


// import React, { useEffect, useState } from "react";
// import { Link, useLocation } from "react-router-dom";
// import {
//   FaVideo,
//   FaChartLine,
//   FaBroadcastTower,
//   FaFileVideo,
//   FaFire,

//   FaBug,
//   FaServer,
//   FaUsers,
//   FaClipboardList,
//   FaInfoCircle,
//   FaCogs,
//   FaShieldAlt,
//   FaMapMarkerAlt,
//   FaLayerGroup,
//   FaUserShield,
// } from "react-icons/fa";
// import { MdMenu, MdMenuOpen, MdExpandLess, MdExpandMore } from "react-icons/md";
// import Logo from "../assets/logo.jpg";

// const Sidebar = ({ collapsed, onToggleCollapse }) => {
//   const location = useLocation();
//   const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
//   const [openMenus, setOpenMenus] = useState({});

//   useEffect(() => {
//     const handleResize = () => setIsMobile(window.innerWidth < 768);
//     window.addEventListener("resize", handleResize);
//     return () => window.removeEventListener("resize", handleResize);
//   }, []);

//   // ✅ Full VMS Menu
//   const menuItems = [
//     {
//       key: "video-management",
//       label: "Video Management",
//       icon: <FaVideo />,
//       children: [
//         { key: "dashboard", label: "Dashboard", icon: <FaChartLine />, path: "/dashboard" },
//         { key: "live", label: "Live Stream", icon: <FaBroadcastTower />, path: "/live/stream" },
//         { key: "recordings", label: "Recordings", icon: <FaFileVideo />, path: "/recordings" },
//       ],
//     },
//     {
//       key: "smart-detection",
//       label: "Smart Detection",
//       icon: <FaBug />,
//       children: [
//         // { key: "analytics", label: "Smoke Detection", icon: <FaChartLine />, path: "/analytics" },
//          { key: "fire", label: "Fire Detection", icon: <FaFire />, path: "/fire" },

//         { key: "smoke", label: "Smoke Detection", icon: <FaChartLine />, path: "/smoke" },
//         { key: "rodent", label: "Rodent Detection", icon: <FaFire />, path: "/rodent" },

//         // { key: "event", label: "Event Detection", icon: <FaFire />, path: "/event" },
//         //  { key: "fire", label: "Fire Detection", icon: <FaFire />, path: "/fire" },
//         { key: "volumetric", label: "Warehouse Detection", icon: <FaFire />, path: "/volumetric" },

//         // { key: "rodent", label: "Rodent Detection", icon: <FaFire />, path: "/rodent" },

//       ],
//     },
//     {
//       key: "device-management",
//       label: "Devices",
//       icon: <FaServer />,
//       children: [
//         { key: "cameras", label: "Cameras", icon: <FaVideo />, path: "/devices/cameras" },
//         { key: "nvrs", label: "NVRs", icon: <FaServer />, path: "/devices/nvrs" },
//         { key: "zones", label: "Zones", icon: <FaMapMarkerAlt />, path: "/devices/zones" },
//         { key: "locations", label: "Locations", icon: <FaLayerGroup />, path: "/devices/locations" },
//       ],
//     },

//      {
//       key: "config-management",
//       label: "Configration",
//       icon: <FaServer />,
//       children: [
//         { key: "camera", label: "Camera Data", icon: <FaVideo />, path: "/camera/detail" },
//       ],
//     },
    
//     {
//       key: "user-management",
//       label: "User Management",
//       icon: <FaUsers />,
//       children: [
//         { key: "users", label: "Users", icon: <FaUsers />, path: "/users" },
//         { key: "roles", label: "Roles", icon: <FaUserShield />, path: "/roles" },
//         { key: "permissions", label: "Permissions", icon: <FaShieldAlt />, path: "/permissions" },
//         { key: "assign_permissions", label: "Assign Permissions", icon: <FaShieldAlt />, path: "/assign/permissions" },
//       ],
//     },
//     {
//       key: "reports",
//       label: "Reports",
//       icon: <FaClipboardList />,
//       children: [
//         { key: "alerts", label: "Event Reports", icon: <FaClipboardList />, path: "/reports/alerts" },
//         { key: "analyticsreports", label: "Analytics Reports", icon: <FaClipboardList />, path: "/reports/analytics" },
//         // { key: "usagereports", label: "Usage Reports", icon: <FaClipboardList />, path: "/reports/usage" },
//       ],
//     },
//     // {
//     //   key: "settings",
//     //   label: "Settings",
//     //   icon: <FaCogs />,
//     //   children: [
//     //     { key: "system", label: "System Settings", icon: <FaCogs />, path: "/settings/system" },
//     //     { key: "network", label: "Network Settings", icon: <FaCogs />, path: "/settings/network" },
//     //     { key: "storage", label: "Storage Settings", icon: <FaCogs />, path: "/settings/storage" },
//     //   ],
//     // },
//     {
//       key: "about",
//       label: "About VMS",
//       icon: <FaInfoCircle />,
//       children: [
//         { key: "overview", label: "Overview", icon: <FaInfoCircle />, path: "/about/overview" },
//       ],
//     },
//   ];

//   useEffect(() => {
//     if (!collapsed) {
//       setOpenMenus(menuItems.reduce((acc, item) => ({ ...acc, [item.key]: true }), {}));
//     }
//   }, [collapsed]);

//   // ✅ Active route logic
//   const selectedKey = (() => {
//     const path = location.pathname;
//     for (let menu of menuItems) {
//       for (let item of menu.children) {
//         if (path === item.path) return item.key;
//       }
//     }
//     for (let menu of menuItems) {
//       for (let item of menu.children) {
//         if (path.startsWith(item.path)) return item.key;
//       }
//     }
//     return "";
//   })();

//   const toggleMenu = (key) => {
//     setOpenMenus((prev) => ({ ...prev, [key]: !prev[key] }));
//   };

//   return (
//     <div
//       className={`${collapsed ? "w-16" : "w-65"} h-screen bg-white text-gray-900 flex flex-col justify-between shadow-xl transition-all duration-300`}
//     >
//       {/* Header */}
//       <div className="flex items-center justify-between p-4">
//         {!collapsed && (
//           <div className="flex items-center gap-2">
//             <img src={Logo} alt="Logo" className="h-10 w-10 rounded-full" />
//             <span className="font-bold text-lg text-[#9357c9]">VMS</span>
//           </div>
//         )}
//         <button
//           onClick={onToggleCollapse}
//           className="p-2 rounded-full bg-gray-100 hover:bg-purple-300 transition-all"
//         >
//           {collapsed ? <MdMenu /> : <MdMenuOpen />}
//         </button>
//       </div>

//       {/* Menu Items */}
//       <div className="flex-1 overflow-y-auto space-y-2 px-2 relative mt-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
//         {menuItems.map((menu) => (
//           <div key={menu.key} className="group relative">
//             {/* Parent */}
//             <div
//               onClick={() => (collapsed ? null : toggleMenu(menu.key))}
//               className={`flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-gray-100 cursor-pointer transition-all ${collapsed ? "justify-center" : ""}`}
//             >
//               <div className="flex items-center gap-2">
//                 <span className="text-lg text-[#390964]">{menu.icon}</span>
//                 {!collapsed && <span className="text-sm font-semibold text-gray-700">{menu.label}</span>}
//               </div>
//               {!collapsed && <span className="text-gray-500">{openMenus[menu.key] ? <MdExpandLess /> : <MdExpandMore />}</span>}
//             </div>

//             {/* Hover submenu (collapsed) */}
//             {collapsed && (
//               <div className="absolute left-full top-0 ml-2 w-52 bg-white rounded-lg shadow-lg z-50 opacity-0 group-hover:opacity-100 group-hover:visible invisible transition-all duration-200">
//                 {menu.children.map((item) => (
//                   <Link
//                     key={item.key}
//                     to={item.path}
//                     className={`flex items-center gap-2 px-4 py-2 text-md rounded-md transition-all ${
//                       selectedKey === item.key
//                         ? "bg-purple-100 text-[#8f5eb8] font-medium"
//                         : "hover:bg-gray-50 text-purple-700"
//                     }`}
//                   >
//                     {item.icon}
//                     <span>{item.label}</span>
//                   </Link>
//                 ))}
//               </div>
//             )}

//             {/* Expanded submenu */}
//             {!collapsed && openMenus[menu.key] && (
//               <div className="ml-5 mt-1 space-y-1">
//                 {menu.children.map((item) => (
//                   <Link
//                     key={item.key}
//                     to={item.path}
//                     className={`flex items-center gap-2 p-2 rounded-md text-sm transition-all ${
//                       selectedKey === item.key
//                         ? "bg-[#b17ef3] text-white font-medium"
//                         : "hover:bg-gray-100 text-gray-700"
//                     }`}
//                   >
//                     {item.icon}
//                     <span>{item.label}</span>
//                   </Link>
//                 ))}
//               </div>
//             )}
//           </div>
//         ))}
//       </div>

//       {/* Footer */}
//       <div className="p-4">
//         <div className="bg-gray-50 rounded-xl p-4 text-center shadow-inner">
//           {!collapsed && (
//             <>
//               <p className="text-sm font-semibold text-purple-700">Video Management System</p>
//               <p className="text-xs text-gray-500 mt-1">
//                 Powered by <span className="font-bold text-[#3B1E54]">Ajeevi</span>
//               </p>
//               <button className="mt-3 w-full rounded-lg bg-[#9864db] hover:bg-[#8754d1] text-white py-2 text-sm font-medium transition-all">
//                 Learn More
//               </button>
//             </>
//           )}
//         </div>
//       </div>
//     </div>
//   );
// };

// export default Sidebar;
