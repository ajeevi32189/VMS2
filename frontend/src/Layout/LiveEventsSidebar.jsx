import React, { useEffect, useState, useRef } from "react";
import Cookies from "js-cookie";
import { message, Skeleton, Modal, Image, Tag, Badge, Empty, Button, Divider, Alert } from "antd";
import { 
  BellOutlined, 
  CloseOutlined, 
  PauseCircleOutlined, 
  PlayCircleOutlined,
  CalendarOutlined,
  EnvironmentOutlined,
  VideoCameraOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  RightOutlined,
  CheckCircleOutlined
} from "@ant-design/icons";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { deviceApi, ticketApi } from "../utils/axiosInstance";
import { ANALYTICS_API_URL } from "../config";
import { AlertSnapshot, formatIndianDateTime } from "../utils/imageUtils";

dayjs.extend(relativeTime);

const LiveEventsSidebar = ({ isOpen = false, onClose = () => {} }) => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);

  const userId = Cookies.get("userId");
  const intervalRef = useRef(null);

  const autoGenerateTickets = async (newEvents) => {
    if (!newEvents || newEvents.length === 0) return;

    let processed = [];
    try {
      processed = JSON.parse(localStorage.getItem('vms_processed_alerts') || '[]');
    } catch (e) {
      processed = [];
    }

    // First load in session: backfill list to prevent mass creation of old tickets
    const isFirstLoadOfSession = !sessionStorage.getItem('vms_alerts_initialized');
    if (isFirstLoadOfSession) {
      const currentIds = newEvents.map(e => e.id);
      const merged = Array.from(new Set([...processed, ...currentIds]));
      localStorage.setItem('vms_processed_alerts', JSON.stringify(merged));
      sessionStorage.setItem('vms_alerts_initialized', 'true');
      return;
    }

    // Get a default SLA ID from SLA configuration
    let defaultSlaId = 1;
    try {
      const slaRes = await ticketApi.get("/api/sla");
      const slaData = Array.isArray(slaRes.data) ? slaRes.data : (slaRes.data?.items || slaRes.data?.data || []);
      if (slaData.length > 0) {
        defaultSlaId = slaData[0].id;
      }
    } catch (err) {
      console.error("Auto ticket SLA fetch failed, defaulting to SLA ID 1:", err);
    }

    // Filter events requiring ticket creation
    const pendingEvents = newEvents.filter(e => !processed.includes(e.id));
    if (pendingEvents.length === 0) return;

    for (const event of pendingEvents) {
      const detection = getDetectionType(event.objectName);
      const framePath = event.framePath || event.frame_path || event.image_path || "";
      const framePart = framePath ? ` Frame: ${framePath}.` : "";

      try {
        await ticketApi.post("/api/tickets", {
          title: `[Alert] ${detection} on ${event.camera_name}`,
          description: `Automatic ticket for ${detection} alert detected on ${event.camera_name}. Alert ID: ${event.id}.${framePart} Location: ${event.camera_location || "N/A"}`,
          category: "Surveillance Alert",
          subCategory: detection,
          reporterId: Cookies.get("email") || "vms_auto_generator",
          severity: "High",
          priority: "High",
          slaId: defaultSlaId,
          latitude: 0,
          longitude: 0,
          landmark: event.camera_location || "",
          ticketType: "Auto-Generated",
          deviceId: event.camera_name || "",
          attachmentUrl: framePath || "",
          projectName: "VMS"
        });

        processed.push(event.id);
        localStorage.setItem('vms_processed_alerts', JSON.stringify(processed));
      } catch (err) {
        console.error(`Auto ticket generation failed for alert #${event.id}:`, err);
      }
    }
  };

  const fetchLiveEvents = async () => {
    if (!userId || isPaused) return;

    try {
      if (events.length === 0) setLoading(true);
      const res = await deviceApi.get(`/CameraAlert/`, {
        params: {
          userid: userId,
          page: 1,
          pageSize: 20,
        },
      });
      const fetchedEvents = res.data.results || [];

      // Filter out any alert that is already resolved (status === 1) OR acknowledged by user
      let acknowledged = [];
      try {
        acknowledged = JSON.parse(localStorage.getItem('vms_acknowledged_alerts') || '[]');
      } catch (e) {
        acknowledged = [];
      }

      const activeEvents = fetchedEvents.filter(
        (e) => e.status !== 1 && !acknowledged.includes(e.id)
      );

      setEvents(activeEvents);
      // Auto-generate tickets for newly detected events
      autoGenerateTickets(activeEvents);
    } catch (error) {
      console.error(error);
      message.error("Failed to fetch live events");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenEvent = (event) => {
    setSelectedEvent(event);

    // Auto-mark as viewed so opening it removes it from Live Alerts list
    const alertId = event.id;
    try {
      const acknowledged = JSON.parse(localStorage.getItem('vms_acknowledged_alerts') || '[]');
      if (!acknowledged.includes(alertId)) {
        acknowledged.push(alertId);
        localStorage.setItem('vms_acknowledged_alerts', JSON.stringify(acknowledged));
      }
    } catch (e) {}

    // Immediately remove from active live list
    setEvents((prev) => prev.filter((e) => e.id !== alertId));

    // Notify backend
    deviceApi.patch(`/CameraAlert/${alertId}/`, { status: 1 }).catch(() => {});
  };

  const handleAcknowledgeAlert = async (eventToAck) => {
    if (!eventToAck) return;
    const alertId = eventToAck.id;

    // 1. Persist acknowledged ID locally so it is dismissed from Live Alerts
    try {
      const acknowledged = JSON.parse(localStorage.getItem('vms_acknowledged_alerts') || '[]');
      if (!acknowledged.includes(alertId)) {
        acknowledged.push(alertId);
        localStorage.setItem('vms_acknowledged_alerts', JSON.stringify(acknowledged));
      }
    } catch (e) {}

    // 2. Immediately remove from live sidebar state
    setEvents((prev) => prev.filter((e) => e.id !== alertId));
    setSelectedEvent(null);
    message.success(`Alert #${alertId} acknowledged`);

    // 3. Sync resolution to backend API
    try {
      await deviceApi.patch(`/CameraAlert/${alertId}/`, { status: 1 });
    } catch (err) {
      try {
        await deviceApi.put(`/CameraAlert/${alertId}/`, { ...eventToAck, status: 1 });
      } catch (e) {}
    }
  };

  const handleAcknowledgeAll = async () => {
    if (events.length === 0) return;
    const currentIds = events.map((e) => e.id);

    try {
      const acknowledged = JSON.parse(localStorage.getItem('vms_acknowledged_alerts') || '[]');
      const merged = Array.from(new Set([...acknowledged, ...currentIds]));
      localStorage.setItem('vms_acknowledged_alerts', JSON.stringify(merged));
    } catch (e) {}

    setEvents([]);
    setSelectedEvent(null);
    message.success("All live alerts acknowledged");

    // Sync in background to backend
    currentIds.forEach(async (id) => {
      try {
        await deviceApi.patch(`/CameraAlert/${id}/`, { status: 1 });
      } catch (e) {}
    });
  };

  useEffect(() => {
    if (userId) fetchLiveEvents();
  }, [userId]);

  useEffect(() => {
    if (userId && !isPaused) {
      intervalRef.current = setInterval(fetchLiveEvents, 10000);
      return () => clearInterval(intervalRef.current);
    }
  }, [userId, isPaused]);

  // Helper to parse Detection objects like "{'Rodent': 1}"
  const getDetectionType = (objName) => {
    if (!objName || objName === "null") return "Surveillance Alert";
    try {
      // Handle the case where objectively it might already be an object or needs parsing
      let parsed = objName;
      if (typeof objName === 'string') {
        const clean = objName.replace(/'/g, '"');
        parsed = JSON.parse(clean);
      }
      
      if (parsed && typeof parsed === 'object') {
        const keys = Object.keys(parsed);
        return keys.length > 0 ? keys[0] : "Detected Object";
      }
      return String(objName) || "Detection";
    } catch (e) {
      return String(objName) || "Detection";
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-[60px] h-[calc(100vh-60px)] z-40 w-80 bg-slate-50 shadow-2xl border-l flex flex-col hidden md:flex transition-all duration-300" style={{ top: '60px', height: 'calc(100vh - 60px)' }}>
      
      {/* HEADER */}
      <div className="flex justify-between items-center px-4 py-3 bg-[#9864db] text-white shadow-md">
        <div className="flex items-center gap-2">
          <Badge dot count={isPaused ? 0 : events.length} size="small" className="text-white">
            <BellOutlined className="text-lg" />
          </Badge>
          <span className="font-bold tracking-tight text-sm uppercase">Live Alerts</span>
        </div>
        <div className="flex items-center gap-1">
          {events.length > 0 && (
            <Button 
              type="text" 
              size="small"
              className="text-white hover:bg-white/20 text-xs px-2 h-7"
              onClick={handleAcknowledgeAll}
              title="Acknowledge all alerts"
            >
              Clear All
            </Button>
          )}
          <Button 
            type="text" 
            size="small"
            className="text-white hover:bg-white/20 transition-colors"
            icon={isPaused ? <PlayCircleOutlined /> : <PauseCircleOutlined />} 
            onClick={() => setIsPaused(!isPaused)}
            title={isPaused ? "Resume Monitoring" : "Pause Monitoring"}
          />
          <Button 
            type="text" 
            size="small"
            className="text-white hover:bg-red-500/20"
            icon={<CloseOutlined />} 
            onClick={onClose} 
          />
        </div>
      </div>

      {/* EVENTS BODY */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
        {loading ? (
          <div className="space-y-4">
            <Skeleton active avatar paragraph={{ rows: 2 }} />
            <Skeleton active avatar paragraph={{ rows: 2 }} />
            <Skeleton active avatar paragraph={{ rows: 2 }} />
          </div>
        ) : events.length > 0 ? (
          events.map((event) => {
            const detection = getDetectionType(event.objectName);
            const isRodent = detection.toLowerCase().includes("rodent");
            const snapshotUrl = event.framePath ? `${ANALYTICS_API_URL}${event.framePath}` : null;
            
            return (
              <div
                key={event.id}
                className="group relative bg-white border border-slate-200 rounded-lg p-3 cursor-pointer hover:border-purple-400 hover:shadow-md transition-all duration-200"
                onClick={() => handleOpenEvent(event)}
              >
                <div className="flex items-start gap-4">
                  {/* Left Side: Thumbnail Snapshot */}
                  <div className="w-16 h-16 rounded-md overflow-hidden flex-shrink-0 bg-slate-100 border border-slate-100 flex items-center justify-center">
                    {event.framePath ? (
                      <AlertSnapshot 
                        path={event.framePath}
                        cameraName={event.camera_name}
                        alt="Event"
                        width={64}
                        height={64}
                        className="w-full h-full object-cover transition-transform group-hover:scale-110"
                        preview={false}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-300">
                        <VideoCameraOutlined />
                      </div>
                    )}
                  </div>

                  {/* Right Side: Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                      <h4 className="text-sm font-bold text-slate-800 truncate pr-2 capitalize leading-tight">
                        {detection}
                      </h4>
                      {/* Removed the Status tag 'B' as requested */}
                    </div>
                    
                    <p className="text-[10px] text-slate-500 flex items-center gap-1 leading-tight truncate mb-2">
                       <VideoCameraOutlined className="text-purple-500" /> {event.camera_name}
                    </p>
                    
                    <div className="flex items-center justify-between pt-1.5 border-t border-slate-50">
                       <span className="text-[9px] text-slate-400 font-medium flex items-center gap-1">
                         <CalendarOutlined /> {dayjs(event.regDate).fromNow()}
                       </span>
                       <div className="flex items-center gap-1.5">
                         {JSON.parse(localStorage.getItem('vms_processed_alerts') || '[]').includes(event.id) && (
                           <Tag color="purple" className="m-0 py-0 px-1.5 text-[8px] font-bold border-none leading-normal">
                             TICKETED
                           </Tag>
                         )}
                         <button
                           onClick={(e) => {
                             e.stopPropagation();
                             handleAcknowledgeAlert(event);
                           }}
                           className="p-1 text-slate-400 hover:text-emerald-600 rounded transition"
                           title="Acknowledge alert"
                         >
                           <CheckCircleOutlined className="text-xs hover:scale-125 transition-transform" />
                         </button>
                         <RightOutlined className="text-[10px] text-slate-300 group-hover:text-purple-500 group-hover:translate-x-1 transition-all" />
                       </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <Empty 
            image={Empty.PRESENTED_IMAGE_SIMPLE} 
            description={<span className="text-slate-400 text-xs">No active alerts found</span>} 
            className="mt-20"
          />
        )}
      </div>

      {/* FOOTER - Status indicator */}
      <div className="px-4 py-2 border-t bg-white text-[9px] text-slate-400 flex justify-between items-center italic">
        <span>{isPaused ? "Monitoring Paused" : "System Monitoring Active"}</span>
        <div className={`w-1.5 h-1.5 rounded-full ${isPaused ? 'bg-amber-400' : 'bg-emerald-500 animate-pulse'}`} />
      </div>

      {/* DETAILED MODAL */}
      <Modal 
        title={
          <div className="flex items-center gap-2 text-slate-800 border-b border-slate-100 pb-3">
             <div className="p-1.5 bg-purple-100 text-purple-600 rounded">
                <BellOutlined />
             </div>
             <div>
                <div className="text-base font-bold capitalize">{getDetectionType(selectedEvent?.objectName)}</div>
                <div className="text-[10px] text-slate-400 font-normal uppercase tracking-wider italic">Alert ID: #{selectedEvent?.id}</div>
             </div>
          </div>
        } 
        open={!!selectedEvent} 
        onCancel={() => setSelectedEvent(null)} 
        footer={[
          <Button key="close" onClick={() => setSelectedEvent(null)} className="mr-2">
            Close
          </Button>,
          <Button
            key="ack"
            type="primary"
            onClick={() => handleAcknowledgeAlert(selectedEvent)}
            className="bg-[#9864db] border-none shadow-lg text-white"
          >
            Acknowledge Alert
          </Button>
        ]}
        centered
        width={600}
        styles={{ body: { padding: '20px' }}}
      >
        {selectedEvent && (
          <div className="flex flex-col gap-5">
            {/* Image Stage */}
            <div className="relative rounded-xl overflow-hidden border-2 border-slate-100 bg-slate-900 aspect-video shadow-inner flex items-center justify-center">
              <AlertSnapshot 
                path={selectedEvent.framePath}
                cameraName={selectedEvent.camera_name}
                width="100%"
                height="100%"
                className="w-full h-full object-contain"
                preview={true}
              />
              <div className="absolute top-4 right-4">
                 <Tag color="red" className="font-bold border-none shadow-lg bg-red-600">CRITICAL DETECT</Tag>
              </div>
            </div>

            {/* Info Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block mb-1">Source Camera</span>
                <span className="text-slate-800 text-sm font-semibold flex items-center gap-2">
                  <VideoCameraOutlined className="text-purple-500" /> {selectedEvent.camera_name}
                </span>
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block mb-1">Detected Time</span>
                <span className="text-slate-800 text-sm font-semibold flex items-center gap-2">
                  <CalendarOutlined className="text-purple-500" /> {formatIndianDateTime(selectedEvent.regDate)}
                </span>
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block mb-1">Site Location</span>
                <span className="text-slate-800 text-sm font-semibold flex items-center gap-2">
                  <EnvironmentOutlined className="text-purple-500" /> {selectedEvent.camera_location || "Processing..."}
                </span>
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block mb-1">Confidence / Status</span>
                <Tag color="cyan" className="m-0 font-bold border-none">STATUS: {selectedEvent.alertStatus}</Tag>
              </div>
            </div>
            
            <Alert 
              message="AI Insight" 
              description={`System identifies this as ${getDetectionType(selectedEvent.objectName)}. This alert was automatically logged based on surveillance AI protocols.`}
              type="info" 
              showIcon 
              className="text-xs bg-slate-50 border-slate-200"
            />
          </div>
        )}
      </Modal>
    </div>
  );
};

export default LiveEventsSidebar;