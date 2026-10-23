import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Card,
  Tag,
  Button,
  Popconfirm,
  Spin,
} from "antd";
import {
  UserOutlined,
  MailOutlined,
  IdcardOutlined,
  KeyOutlined,
  LogoutOutlined,
  SafetyCertificateOutlined,
  CheckCircleFilled,
} from "@ant-design/icons";
import { useAuth } from "../../../Authentication/AuthContext";
import { api, callLogoutAPI } from "../../../utils/axiosInstance";

const Profile = () => {
  const navigate = useNavigate();
  const { user, role, permissions, logout } = useAuth();
  const [profileData, setProfileData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const fetchUserProfile = async () => {
      setLoading(true);
      try {
        const res = await api.get("/Account/me");
        if (isMounted && res.data && res.data.status !== false) {
          setProfileData(res.data);
        }
      } catch (err) {
        console.warn("Could not fetch /Account/me details, using context", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchUserProfile();
    return () => {
      isMounted = false;
    };
  }, []);

  const email =
    profileData?.email ||
    user?.email ||
    sessionStorage.getItem("vms_stqc_email") ||
    "admin@demo.com";

  const userId =
    profileData?.userId ||
    user?.userId ||
    sessionStorage.getItem("vms_stqc_userId") ||
    "-";

  const userRole =
    (profileData?.roles && profileData.roles[0]) ||
    role ||
    sessionStorage.getItem("vms_stqc_role") ||
    "Admin";

  const userPermissions =
    (profileData?.permissions && Array.isArray(profileData.permissions)
      ? profileData.permissions
      : permissions) || [];

  const handleLogout = async () => {
    try {
      await callLogoutAPI();
    } catch {
      // ignore
    } finally {
      logout();
      navigate("/login");
    }
  };

  const getRoleBadge = (r) => {
    const lower = (r || "").toLowerCase();
    if (lower === "admin") return { bg: "bg-purple-100", text: "text-purple-800", border: "border-purple-200" };
    if (lower === "viewer") return { bg: "bg-blue-100", text: "text-blue-800", border: "border-blue-200" };
    return { bg: "bg-teal-100", text: "text-teal-800", border: "border-teal-200" };
  };

  const roleBadge = getRoleBadge(userRole);
  const initial = (email?.[0] || "U").toUpperCase();

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <Spin spinning={loading}>
        {/* Main Profile Card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Header Banner */}
          <div className="bg-gradient-to-r from-[#3B1E54] to-[#603588] px-6 py-8 text-white">
            <div className="flex flex-col sm:flex-row items-center sm:items-start justify-between gap-6">
              <div className="flex flex-col sm:flex-row items-center gap-5 text-center sm:text-left">
                {/* Professional Corporate Avatar with Initials */}
                <div className="w-20 h-20 rounded-full bg-white/10 border-2 border-white/30 flex items-center justify-center text-white text-3xl font-bold shadow-inner">
                  {initial}
                </div>
                <div>
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                    <h1 className="text-2xl font-bold text-white m-0 tracking-wide">
                      {email.includes("@") ? email.split("@")[0] : email}
                    </h1>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${roleBadge.bg} ${roleBadge.text} border ${roleBadge.border}`}>
                      {userRole}
                    </span>
                  </div>
                  <p className="text-purple-200 text-sm mt-1 m-0 flex items-center justify-center sm:justify-start gap-1.5">
                    <MailOutlined />
                    <span>{email}</span>
                  </p>
                  <p className="text-purple-200 text-xs mt-1 m-0 flex items-center justify-center sm:justify-start gap-1">
                    <CheckCircleFilled className="text-emerald-400" />
                    <span className="text-emerald-300 font-medium">Active Account</span>
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                <Button
                  type="primary"
                  icon={<KeyOutlined />}
                  onClick={() => navigate("/change-password")}
                  className="bg-white text-[#3B1E54] hover:bg-gray-100 border-none font-medium shadow-sm"
                >
                  Change Password
                </Button>
                <Popconfirm
                  title="Logout"
                  description="Are you sure you want to log out?"
                  onConfirm={handleLogout}
                  okText="Logout"
                  cancelText="Cancel"
                  okButtonProps={{ danger: true }}
                >
                  <Button
                    danger
                    icon={<LogoutOutlined />}
                    className="bg-white/10 text-white border-white/20 hover:bg-red-600 hover:border-red-600 hover:text-white"
                  >
                    Logout
                  </Button>
                </Popconfirm>
              </div>
            </div>
          </div>

          {/* Details Section */}
          <div className="p-6 divide-y divide-gray-100">
            {/* Account Information */}
            <div className="py-4 first:pt-0">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                <UserOutlined className="text-[#9864DB]" />
                User Details
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                  <span className="text-xs text-gray-500 block">Email Address</span>
                  <span className="text-sm font-medium text-gray-800 break-all">{email}</span>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                  <span className="text-xs text-gray-500 block">Assigned Role</span>
                  <span className="text-sm font-medium text-gray-800">{userRole}</span>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 sm:col-span-2">
                  <span className="text-xs text-gray-500 block">User ID</span>
                  <span className="text-xs font-mono text-gray-700 break-all select-all">{userId}</span>
                </div>
              </div>
            </div>

            {/* Permissions */}
            <div className="pt-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                <SafetyCertificateOutlined className="text-[#9864DB]" />
                Role & Permissions
              </h2>

              {userRole.toLowerCase() === "admin" ? (
                <div className="p-3.5 bg-purple-50/60 rounded-lg border border-purple-100">
                  <p className="text-sm font-medium text-purple-900 m-0">
                    Administrator (Superuser)
                  </p>
                  <p className="text-xs text-purple-700 m-0 mt-0.5">
                    This account has unrestricted administrative access to all system modules, configurations, and user management.
                  </p>
                </div>
              ) : userPermissions && userPermissions.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {userPermissions.map((perm, idx) => (
                    <Tag
                      key={idx}
                      color="purple"
                      className="px-2.5 py-1 text-xs rounded border border-purple-200"
                    >
                      {perm}
                    </Tag>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500 italic m-0">
                  Standard viewer permissions assigned.
                </p>
              )}
            </div>
          </div>
        </div>
      </Spin>
    </div>
  );
};

export default Profile;
