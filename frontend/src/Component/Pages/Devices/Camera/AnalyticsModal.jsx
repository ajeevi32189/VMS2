import React, { useState, useEffect } from "react";
import { Modal, Button, message, Switch, Divider, Spin, Empty } from "antd";
import axios from "axios";
import { deviceApi } from "../../../../utils/axiosInstance";
import { ANALYTICS_API_URL } from "../../../../config";

const AnalyticsModal = ({ open, onClose, camera, userId, field, value, onSaved }) => {
  const [availableGroups, setAvailableGroups] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);
  const [existingMappingId, setExistingMappingId] = useState(null);
  const [mappingKey, setMappingKey] = useState("cameraId"); // Default key

  useEffect(() => {
    if (open) {
      fetchMetadata();
    }
  }, [open, camera]);

  const fetchMetadata = async () => {
    try {
      setLoading(true);
      // 1. Fetch available detection groups (models)
      const groupsRes = await deviceApi.get("/DetectionGroups/");
      const groups = groupsRes.data.results || [];
      setAvailableGroups(groups);

      // 2. Fetch existing mapping for this camera
      if (camera) {
        // Try searching by cameraId
        const mappingRes = await deviceApi.get(`/CameraDetectionMapping/?cameraId=${camera.id}`);
        const results = mappingRes.data.results || [];
        
        // Handle inconsistency in cameraId/cameraid keys
        const mapping = results.find(m => m.cameraId === camera.id || m.cameraid === camera.id);
        
        if (mapping) {
          setExistingMappingId(mapping.id);
          setSelectedGroups(mapping.detectionModels || []);
          // Identify which key the backend expects
          if (mapping.cameraid !== undefined && mapping.cameraId === undefined) {
            setMappingKey("cameraid");
          }
        } else {
          setExistingMappingId(null);
          setSelectedGroups([]);
        }
      }
    } catch (err) {
      console.error("Failed to fetch analytics metadata:", err);
      message.error("Failed to load analytics models");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleGroup = async (groupId, checked) => {
    if (!camera) return;
    
    setUpdatingId(groupId);
    const prevSelected = [...selectedGroups];
    const newSelectedGroups = checked 
      ? [...selectedGroups, groupId] 
      : selectedGroups.filter(id => id !== groupId);
    
    setSelectedGroups(newSelectedGroups);
    
    try {
      // 1. Update CameraDetectionMapping in DB
      // We send both keys to be safe, or use the detected one
      const mappingPayload = {
        [mappingKey]: camera.id,
        detectionModels: newSelectedGroups,
        is_active: true,
      };
      
      // If we identified the other key as well, or just to be extra safe
      if (mappingKey === "cameraId") {
        mappingPayload.cameraid = camera.id;
      } else {
        mappingPayload.cameraId = camera.id;
      }

      if (existingMappingId) {
        await deviceApi.put(`/CameraDetectionMapping/${existingMappingId}/`, mappingPayload);
      } else {
        const res = await deviceApi.post("/CameraDetectionMapping/", mappingPayload);
        setExistingMappingId(res.data.id);
      }

      // 2. Map group IDs to names for Analytics server
      const selectedNames = availableGroups
        .filter(g => newSelectedGroups.includes(g.id))
        .map(g => g.name);

      // 3. Update Analytics API
      const analyticsPayload = {
        cameras: [
          {
            objectlist: JSON.stringify(selectedNames),
            camera_id: camera.id,
            url: camera.rtspurl || camera.url,
            camera_ip: camera.cameraIP || "",
            user_id: camera.user_id || userId,
            credit_id: camera.credit_id || 0,
            running: newSelectedGroups.length > 0 ? "True" : "False",
          },
        ],
      };

      await axios.post(`${ANALYTICS_API_URL}/CameraDetails`, analyticsPayload);

      // 4. Update Camera isAnalytics flag
      const isCurrentlyOn = !!camera[field];
      const shouldBeOn = newSelectedGroups.length > 0;
      
      if (isCurrentlyOn !== shouldBeOn) {
        const cameraPayload = {
          ...camera,
          [field]: shouldBeOn ? 1 : 0,
          userid: String(userId),
        };
        await deviceApi.put(`/Camera/${camera.id}/`, cameraPayload);
        if (onSaved) onSaved();
      }

      message.success(`${availableGroups.find(g => g.id === groupId)?.name || "Model"} updated`);
    } catch (err) {
      console.error("Update failed:", err);
      message.error("Failed to update setting");
      setSelectedGroups(prevSelected);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="close" type="primary" onClick={onClose} className="bg-[#3B1E54] hover:bg-[#2c1640] border-none">
          Done
        </Button>
      ]}
      centered
      title={
        <div className="border-b pb-2">
          <div className="text-lg font-bold text-[#3B1E54]">Analytics Configuration</div>
          <div className="text-xs text-gray-500 font-medium uppercase">{camera?.name || "Select Camera"}</div>
        </div>
      }
      width={400}
    >
      <div className="py-4">
        <p className="text-gray-500 text-sm mb-4 italic">
          Select detection models to enable on this camera:
        </p>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-10">
            <Spin />
            <span className="text-gray-400 mt-2 text-xs">Loading models...</span>
          </div>
        ) : availableGroups.length > 0 ? (
          <div className="space-y-1 max-h-[400px] overflow-y-auto pr-1">
            {availableGroups.map((group) => (
              <div 
                key={group.id} 
                className="flex justify-between items-center p-3 rounded-md hover:bg-gray-50 transition-colors border-b border-gray-50"
              >
                <span className="font-medium text-gray-700">{group.name}</span>
                <Switch
                  size="small"
                  checked={selectedGroups.includes(group.id)}
                  loading={updatingId === group.id}
                  onChange={(checked) => handleToggleGroup(group.id, checked)}
                />
              </div>
            ))}
          </div>
        ) : (
          <Empty description="No models found" className="py-6" />
        )}
      </div>

      <div className="mt-4 p-3 bg-gray-50 rounded text-[10px] text-gray-500 border-l-4 border-[#3B1E54]">
        Note: Toggling a model starts/stops the analytics process immediately on the server.
      </div>
    </Modal>
  );
};

export default AnalyticsModal;
