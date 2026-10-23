import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom'; // ✅ Import Navigate
import Dashboard from '../Component/Dashboard/Dashboard';
import AnalyticsData from '../Component/Pages/Analytics/SmokeDetection';
import Unauthorized from '../Component/Pages/Unauthorized/Unauthorized';
import ProtectedRoute from './ProtectedRoute';
import LiveStreaming from '../Component/Pages/LiveStreaming/LiveStreaming';
import AboutOverview from '../Component/Pages/About/AboutOverview';
import RecordingViewer from '../Component/Pages/Recording/RecordingViewer';
import CameraDetailsTable from '../Component/Pages/Devices/Camera/CameraDetails';
import NvrDetailsTable from '../Component/Pages/Devices/NVR/NvrDetailsTable';
import ZoneDetails from '../Component/Pages/Devices/Zone/ZoneDetails';
import AlertReport from '../Component/Pages/Report/AlertReport';
import EventDetectionTable from '../Component/Pages/Analytics/EventDetectionTable';
import AnalyticsReport from '../Component/Pages/Report/AnalyticsReport';
import WardDetails from '../Component/Pages/Devices/Ward/WardDetails';
import RoleData from '../Component/Pages/UserManagement/RoleData';
import UserTable from '../Component/Pages/UserManagement/UserTable';
import UserForm from '../Component/Pages/UserManagement/UserForm';
import PermissionData from '../Component/Pages/UserManagement/Permission';
import NvrForm from '../Component/Pages/Devices/NVR/NvrForm';
import CameraForm from '../Component/Pages/Devices/Camera/CameraForm';
import AssignPermission from '../Component/Pages/UserManagement/AssignPermission';
import LocationForm from '../Component/Pages/Devices/Location/LocationForm';
import LocationDetailsTable from '../Component/Pages/Devices/Location/LocationDetailsTable ';
import Rodent from '../Component/Pages/Analytics/Rodent';
import TicketTable from '../Component/Pages/TicketManagement/TicketTable';
import SlaTable from '../Component/Pages/TicketManagement/SlaTable';
import Smoke from '../Component/Pages/Analytics/SmokeDetection';
import FireTable from '../Component/Pages/Analytics/FireTable';
import WarehouseTable from '../Component/Pages/Analytics/WarehouseTable';
import CrowdDetection from '../Component/Pages/Analytics/CrowdDetection';
import ANPR from '../Component/Pages/Analytics/ANPR';
import IntrusionDetection from '../Component/Pages/Analytics/IntrusionDetection';
import Camera from '../Component/Pages/Devices/Camera/Camera';
import VideoUploadAnalytics from '../Component/Pages/Analytics/VideoUploadAnalytics';
import FacialRecognition from '../Component/Pages/Analytics/FacialRecognition';
import AbandonedObject from '../Component/Pages/Analytics/AbandonedObject';
import TamperDetection from '../Component/Pages/Analytics/TamperDetection';
import Fencing from '../Component/Pages/Analytics/Fencing';
import Audit from '../Component/Pages/Audit/Audit';
import Profile from '../Component/Pages/Profile/Profile';



const routeConfig = [
  { path: '/dashboard', element: <Dashboard />, roles: ['Admin', 'viewer', 'user'] },
  { path: '/profile', element: <Profile />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/live/stream', element: <LiveStreaming />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/audit', element: <Audit />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/about/overview', element: <AboutOverview />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/recordings', element: <RecordingViewer />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/fencing', element: <Fencing />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/event', element: <EventDetectionTable />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/rodent', element: <Rodent />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/smoke', element: <Smoke />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/fire', element: <FireTable />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/crowd', element: <CrowdDetection />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/anpr', element: <ANPR />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/intrusion', element: <IntrusionDetection />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/volumetric', element: <WarehouseTable />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/video-analytics', element: <VideoUploadAnalytics />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/facial', element: <FacialRecognition />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/abandoned', element: <AbandonedObject />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/tamper', element: <TamperDetection />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/camera/detail', element: <CameraDetailsTable />, roles: ["Admin", 'user', 'viewer'] },

  { path: '/reports/alerts', element: <AlertReport />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/reports/analytics', element: <AnalyticsReport />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/devices/cameras', element: <Camera />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/devices/nvrs', element: <NvrDetailsTable />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/nvr/form', element: <NvrForm />, roles: ["Admin", 'user'] },
  { path: '/camera/form', element: <CameraForm />, roles: ["Admin", 'user'] },
  { path: '/devices/zones', element: <ZoneDetails />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/devices/locations', element: <LocationDetailsTable />, roles: ["Admin", 'user', 'viewer'] },
  { path: '/location/form', element: <LocationForm />, roles: ["Admin", 'user'] },
  { path: '/devices/wards', element: <WardDetails />, roles: ["Admin", 'user', 'viewer'] },
  // user management
  { path: '/roles', element: <RoleData />, roles: ["Admin", "viewer"], requiredPermissions: ["role.read"] },
  { path: '/users', element: <UserTable />, roles: ["Admin", "viewer"] }, // Viewer always allowed for users
  { path: '/user/form', element: <UserForm />, roles: ["Admin"], requiredPermissions: ["user.write"] },
  { path: '/permissions', element: <PermissionData />, roles: ["Admin", "viewer"], requiredPermissions: ["permission.read"] },
  { path: '/assign/permissions', element: <AssignPermission />, roles: ["Admin"], requiredPermissions: ["permission.write"] },
  // end user management
  // ticket management
  { path: '/tickets', element: <TicketTable />, roles: ["Admin", "viewer", "user"] },
  { path: '/tickets/sla', element: <SlaTable />, roles: ["Admin", "viewer", "user"] },
  // end ticket management
  { path: '/unauthorized', element: <Unauthorized />, roles: [] }, // public
];

const AppRoutes = () => {
  return (
    <Routes>
      {routeConfig.map(({ path, element, roles, requiredPermissions }) => (
        <Route
          key={path}
          path={path}
          element={
            (roles && roles.length > 0) || (requiredPermissions && requiredPermissions.length > 0) ? (
              <ProtectedRoute allowedRoles={roles} requiredPermissions={requiredPermissions}>
                {element}
              </ProtectedRoute>
            ) : (
              element
            )
          }
        />
      ))}
      {/* Fallback: Silently redirect any undefined route within protected context */}
      <Route path="*" element={<Navigate to="/live/stream" replace />} />
    </Routes>
  );
};

export default AppRoutes;



// import React from 'react';
// import { Routes, Route } from 'react-router-dom';
// import Dashboard from '../Component/Dashboard/Dashboard';
// import AnalyticsData from '../Component/Pages/Analytics/AnalyticsData';
// import Unauthorized from '../Component/Pages/Unauthorized/Unauthorized';
// import NotFound from '../Component/Pages/Unauthorized/NotFound';
// import ProtectedRoute from './ProtectedRoute';
// import LiveStreaming from '../Component/Pages/LiveStreaming/LiveStreaming';
// import AboutOverview from '../Component/Pages/About/AboutOverview';
// import RecordingViewer from '../Component/Pages/Recording/RecordingViewer';
// import CameraDetailsTable from '../Component/Pages/Devices/Camera/CameraDetails';
// import NvrDetailsTable from '../Component/Pages/Devices/NVR/NvrDetailsTable';
// import ZoneDetails from '../Component/Pages/Devices/Zone/ZoneDetails';
// import AlertReport from '../Component/Pages/Report/AlertReport';
// import EventDetectionTable from '../Component/Pages/Analytics/EventDetectionTable';
// import AnalyticsReport from '../Component/Pages/Report/AnalyticsReport';
// import WardDetails from '../Component/Pages/Devices/Ward/WardDetails';
// import RoleData from '../Component/Pages/UserManagement/RoleData';
// import UserTable from '../Component/Pages/UserManagement/UserTable';
// import UserForm from '../Component/Pages/UserManagement/UserForm';
// import PermissionData from '../Component/Pages/UserManagement/Permission';
// import NvrForm from '../Component/Pages/Devices/NVR/NvrForm';
// import CameraForm from '../Component/Pages/Devices/Camera/CameraForm';
// import AssignPermission from '../Component/Pages/UserManagement/AssignPermission';
// import LocationForm from '../Component/Pages/Devices/Location/LocationForm';
// import LocationDetailsTable from '../Component/Pages/Devices/Location/LocationDetailsTable ';

// const routeConfig = [
//   { path: '/dashboard', element: <Dashboard />, roles: ['Admin'] },
//   { path: '/analytics', element: <AnalyticsData />, roles: ["Admin",'user'] },
//   { path: '/live/stream', element: <LiveStreaming />, roles: ["Admin",'user'] },
//   { path: '/about/overview', element: <AboutOverview />, roles: ["Admin",'user'] },
//   { path: '/recordings', element: <RecordingViewer />, roles: ["Admin",'user'] },
//   { path: '/event', element: <EventDetectionTable />, roles: ["Admin",'user'] },
//   { path: '/reports/alerts', element: <AlertReport />, roles: ["Admin",'user'] },
//   { path: '/reports/analytics', element: <AnalyticsReport />, roles: ["Admin",'user'] },
//   { path: '/devices/cameras', element: <CameraDetailsTable />, roles: ["Admin",'user'] },
//   { path: '/devices/nvrs', element: <NvrDetailsTable />, roles: ["Admin",'user'] },
//   { path: '/nvr/form', element: <NvrForm />, roles: ["Admin",'user'] },
//   { path: '/camera/form', element: <CameraForm />, roles: ["Admin",'user'] },
//   { path: '/devices/zones', element: <ZoneDetails />, roles: ["Admin",'user'] },
//   { path: '/devices/locations', element: <LocationDetailsTable />, roles: ["Admin",'user'] },
//   { path: '/location/form', element: <LocationForm />, roles: ["Admin",'user'] },
//   { path: '/devices/wards', element: <WardDetails />, roles: ["Admin",'user'] },
//   //user management
//   { path: '/roles', element: <RoleData />, roles: ["Admin"] },
//   { path: '/users', element: <UserTable />, roles: ["Admin"] },
//   { path: '/user/form', element: <UserForm />, roles: ["Admin"] },
//   { path: '/permissions', element: <PermissionData />, roles: ["Admin"] },
//   { path: '/assign/permissions', element: <AssignPermission />, roles: ["Admin"] },
//   //end user management

//   { path: '/unauthorized', element: <Unauthorized />, roles: [] }, // public
// ];

// const AppRoutes = () => {
//   return (
//     <Routes>
//       {routeConfig.map(({ path, element, roles }) => (
//         <Route
//           key={path}
//           path={path}
//           element={
//             roles.length > 0 ? (
//               <ProtectedRoute allowedRoles={roles}>{element}</ProtectedRoute>
//             ) : (
//               element
//             )
//           }
//         />
//       ))}
//        {/* Fallback 404 Route */}
//     <Route path="*" element={<NotFound />} />
//     </Routes>
//   );
// };

// export default AppRoutes;

