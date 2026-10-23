import React, { useState, useEffect, useCallback, useRef } from "react";
import mpegts from "mpegts.js";
import {
  Modal,
  DatePicker,
  Select,
  Button,
  Tag,
  Empty,
  Spin,
  message,
  Pagination,
  Tooltip,
  Card,
  Row,
  Col,
  Alert,
} from "antd";
import {
  PlayCircleOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  VideoCameraOutlined,
  DownloadOutlined,
  HistoryOutlined,
  GlobalOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import axios from "axios";
import { useDeviceInventory } from "../../../contexts/DeviceInventoryContext";
import recording_thumbnail from "../../../assets/recording_thumbnail.png";
import { RECORDING_API_URL } from "../../../config";

const { RangePicker } = DatePicker;
const { Option } = Select;

const REC_BASE = RECORDING_API_URL;

const RecordingViewer = () => {
  const context = useDeviceInventory();
  const inventoryCameras = context?.cameras || [];

  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedCamera, setSelectedCamera] = useState(null);
  const [dateRange, setDateRange] = useState([]);
  const pageSize = 12;

  const [visible, setVisible] = useState(false);
  const [currentVideo, setCurrentVideo] = useState(null);
  const [currentMeta, setCurrentMeta] = useState(null);
  const [playbackError, setPlaybackError] = useState(false);
  const videoRef = useRef(null);
  const playerRef = useRef(null);

  const fetchRecordings = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        const params = { page, pageSize };
        if (selectedCamera) params.camera_id = selectedCamera;
        if (dateRange?.length === 2 && dateRange[0] && dateRange[1]) {
          params.start_date = dateRange[0].format("YYYY-MM-DD");
          params.end_date = dateRange[1].format("YYYY-MM-DD");
        }
        const res = await axios.get(`${REC_BASE}/api/v1/recordings`, { params });
        const data = res?.data?.recordings || [];
        setRecordings(Array.isArray(data) ? data : []);
        setTotal(res?.data?.total || data.length || 0);
        setCurrentPage(page);
      } catch (err) {
        console.error("Failed to fetch recordings:", err);
        message.warning("System online, but failed to retrieve archive list.");
      } finally {
        setLoading(false);
      }
    },
    [selectedCamera, dateRange]
  );

  useEffect(() => {
    fetchRecordings(1);
  }, [fetchRecordings]);

  // ? Initialize mpegts player when video modal opens
  useEffect(() => {
    console.log("Video Modal State Changed:", { visible, currentVideo });

    // Clear any previous error before starting
    if (visible && currentVideo) setPlaybackError(false);

    if (visible && currentVideo) {
      const isTs = currentVideo.toLowerCase().endsWith(".ts");
      const features = mpegts.getFeatureList();
      console.log("Video is TS:", isTs);
      console.log("MPEGTS Features:", features);

      if (isTs) {
        if (features.mseLivePlayback || features.msePlayback) {
          console.log("Initializing mpegts player...");
          try {
            const player = mpegts.createPlayer({
              type: "m2ts",  // Explicitly for MPEG-TS
              isLive: false,
              url: currentVideo,
            });

            if (videoRef.current) {
              console.log("Attaching to video element...");
              player.attachMediaElement(videoRef.current);
              player.load();
              player.play().then(() => {
                console.log("Playback started successfully!");
              }).catch(e => {
                console.error("Play interrupted/failed", e);
                setPlaybackError(true);
              });
              playerRef.current = player;
            } else {
              console.warn("Video ref is null! Waiting for Modal to render...");
              setTimeout(() => {
                if (videoRef.current) {
                  console.log("Ref found after delay! Attaching...");
                  player.attachMediaElement(videoRef.current);
                  player.load();
                  player.play().catch(e => {
                    console.error("Delayed play failed", e);
                    setPlaybackError(true);
                  });
                  playerRef.current = player;
                } else {
                  console.error("Video ref is STILL null after delay!");
                  setPlaybackError(true);
                }
              }, 200); // Wait 200ms for modal to attach DOM
            }
          } catch (error) {
            console.error("mpegts setup error:", error);
            setPlaybackError(true);
          }
        } else {
          console.warn("Browser does not support MSE playback via mpegts.js!");
          setPlaybackError(true);
        }
      }
    } else {
      if (playerRef.current) {
        console.log("Destroying mpegts player...");
        try {
          playerRef.current.pause();
          playerRef.current.unload();
          playerRef.current.detachMediaElement();
          playerRef.current.destroy();
        } catch (e) {
          console.error("Error during destroy:", e);
        }
        playerRef.current = null;
      }
    }
  }, [visible, currentVideo]);

  // ? Destroy player when modal unmounts
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        try {
          playerRef.current.unload();
          playerRef.current.detachMediaElement();
          playerRef.current.destroy();
        } catch (e) { }
        playerRef.current = null;
      }
    };
  }, []);

  const getVideoUrl = (rec) => {
    if (!rec) return null;
    const path = rec.fileUrl || rec.file_url || rec.url || rec.file_path || rec.filePath || rec.filename || rec.fileName || rec.name;
    if (!path) return null;
    if (path.toString().startsWith("http")) return path.toString();
    const cleanPath = path.toString().replace(/^\/+/, "");
    return `${REC_BASE}/${cleanPath}`;
  };

  const getTimestamp = (rec) => {
    if (!rec) return "N/A";
    const raw = rec.createdAt || rec.created_at || rec.recDate || rec.start_time || rec.timestamp || rec.date;
    if (!raw) return "N/A";
    try {
      // Backend returns UTC ISO without 'Z' (e.g. 2026-07-02T06:05:57.145304)
      const parseStr = typeof raw === "string" && raw.includes("T") && !raw.includes("Z") && !raw.includes("+")
        ? raw + "Z"
        : raw;
      const d = new Date(parseStr);
      if (isNaN(d.getTime())) {
        const dj = dayjs(raw);
        return dj.isValid() ? dj.format("DD/MM/YYYY, hh:mm:ss A") : "N/A";
      }
      return d.toLocaleString("en-IN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
    } catch {
      return "N/A";
    }
  };

  const getFileName = (rec) => {
    if (!rec) return "Recording";
    const camName = rec.camera_id || "Camera";
    const ts = getTimestamp(rec);
    return ts !== "N/A" ? `${camName} (${ts})` : `REC: ${camName}`;
  };

  const getFileSize = (rec) => {
    if (!rec) return "N/A";
    const kb = rec.sizeKB ?? rec.fileSizeKB ?? rec.filesize ?? (rec.size ? rec.size / 1024 : 0);
    if (kb === undefined || kb === null || kb === "") return "N/A";
    const num = Number(kb);
    if (isNaN(num) || num <= 0) return "N/A";
    if (num > 1024) return `${(num / 1024).toFixed(2)} MB`;
    return `${num.toFixed(1)} KB`;
  };

  const handleDownload = (rec) => {
    if (!rec) return;
    const url = getVideoUrl(rec);
    if (!url) return message.error("Download link not available.");
    const link = document.body.appendChild(document.createElement("a"));
    link.href = url;
    link.setAttribute("download", `recording_${rec.camera_id || 'vms'}.ts`);
    link.setAttribute("target", "_blank");
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-4 space-y-4 max-w-full">
      {/* Header & Filters aligned to Ajeevi Purple Theme */}
      <div className="flex px-4 py-3 rounded-md flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#9864db] text-[#E6E6FA] shadow-sm">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-[#fce4e4] whitespace-nowrap">
            Recording Archive
          </h2>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center w-full md:w-auto">
          <Select
            placeholder="All Cameras"
            value={selectedCamera}
            onChange={(val) => {
              setSelectedCamera(val);
              setTimeout(() => fetchRecordings(1), 100);
            }}
            allowClear
            className="w-full sm:w-48 text-black"
          >
            {Array.isArray(inventoryCameras) && inventoryCameras.map((cam) => (
              <Option key={cam?.id || cam?.name} value={cam?.name || cam?.id}>
                {cam?.name || cam?.id}
              </Option>
            ))}
          </Select>

          <RangePicker
            value={dateRange}
            onChange={(val) => setDateRange(val || [])}
            allowClear
            format="YYYY-MM-DD"
            className="w-full sm:w-auto max-w-xs"
          />

          <Button
            onClick={() => fetchRecordings(1)}
            loading={loading}
            className="w-full sm:w-auto bg-white/20 text-white border-white/40 hover:bg-white/30 hover:text-white"
          >
            Search
          </Button>

          <Button
            icon={<ReloadOutlined />}
            onClick={() => { fetchRecordings(currentPage); }}
            className="w-full sm:w-auto bg-white/20 text-white border-white/40 hover:bg-white/30 hover:text-white"
            title="Refresh List"
          />
        </div>
      </div>

      {/* Grid Content */}
      <div className="mt-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 bg-white rounded-md border border-[#e7e5ec] shadow-sm">
            <Spin size="large" />
            <p className="text-gray-500 text-sm">Fetching Archives...</p>
          </div>
        ) : recordings.length > 0 ? (
          <Row gutter={[16, 16]}>
            {recordings.map((rec, idx) => {
              const url = getVideoUrl(rec);
              return (
                <Col xs={24} sm={12} lg={8} xl={6} key={rec?.id || idx}>
                  <Card
                    hoverable
                    onClick={() => {
                      if (!url) return message.error("Video path not found in record.");
                      setCurrentVideo(url);
                      setCurrentMeta(rec);
                      setVisible(true);
                    }}
                    cover={
                      <div className="relative group overflow-hidden h-40 bg-gray-900 rounded-t-md">
                        <img
                          alt="thumbnail"
                          src={recording_thumbnail}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105 opacity-80"
                        />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                          <PlayCircleOutlined className="text-[#9864db] text-5xl bg-white/90 rounded-full shadow-lg" />
                        </div>
                        <div className="absolute top-2 left-2">
                          <Tag color="#9864db" className="m-0 text-[10px] font-semibold border-none rounded">
                            ARCHIVE
                          </Tag>
                        </div>
                        <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                          {getFileSize(rec) !== "N/A" && (
                            <span className="text-white bg-black/70 px-2 py-0.5 rounded text-[10px]">
                              {getFileSize(rec)}
                            </span>
                          )}
                          {getTimestamp(rec) !== "N/A" && (
                            <span className="text-white bg-black/80 px-2 py-0.5 rounded text-[10px] font-mono flex items-center gap-1">
                              <ClockCircleOutlined className="text-[9px] text-[#bda1ea]" /> {getTimestamp(rec)}
                            </span>
                          )}
                        </div>
                      </div>
                    }
                    className="shadow-sm border-[#e7e5ec] overflow-hidden rounded-md"
                    bodyStyle={{ padding: '12px 16px' }}
                    actions={[
                      <div key="play" className="text-[#9864db] font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors hover:text-purple-700">
                        <PlayCircleOutlined /> Play
                      </div>,
                      <div key="dl" className="text-gray-500 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors hover:text-[#9864db]" onClick={(e) => { e.stopPropagation(); handleDownload(rec); }}>
                        <DownloadOutlined /> Download
                      </div>
                    ]}
                  >
                    <Card.Meta
                      title={
                        <Tooltip title={getFileName(rec)}>
                          <span className="text-sm font-bold text-gray-800 truncate block">{getFileName(rec)}</span>
                        </Tooltip>
                      }
                      description={
                        <div className="flex flex-col gap-1.5 mt-1">
                          <div className="flex items-center gap-2 text-xs text-gray-600">
                            <VideoCameraOutlined className="text-[#9864db]" /> <span className="truncate font-medium">{rec?.camera_id || "Camera"}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-purple-700 bg-purple-50 px-2 py-1 rounded border border-purple-100 font-semibold">
                            <ClockCircleOutlined className="text-[#9864db]" /> <span>{getTimestamp(rec)}</span>
                          </div>
                        </div>
                      }
                    />
                  </Card>
                </Col>
              );
            })}
          </Row>
        ) : (
          <div className="py-24 text-center bg-white rounded-md border border-[#e7e5ec] shadow-sm flex flex-col items-center justify-center">
            <Empty description={<span className="text-gray-500">No recordings found for the selected criteria.</span>} />
          </div>
        )}
      </div>

      {total > pageSize && (
        <div className="flex justify-between items-center mt-6 p-4 bg-white rounded-md border border-[#e7e5ec] shadow-sm">
          <span className="text-sm text-gray-600">
            Showing page {currentPage}
          </span>
          <Pagination current={currentPage} pageSize={pageSize} total={total} onChange={(p) => fetchRecordings(p)} showSizeChanger={false} />
        </div>
      )}

      {/* Video Modal */}
      <Modal
        title={
          <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
            <VideoCameraOutlined className="text-[#9864db]" />
            <span className="font-semibold text-gray-800">{currentMeta?.camera_id || "Archive View"}</span>
          </div>
        }
        open={visible}
        footer={null}
        onCancel={() => { setVisible(false); setCurrentVideo(null); }}
        centered
        width={900}
        destroyOnClose
        styles={{ body: { padding: '0px', backgroundColor: '#000', borderRadius: '0 0 8px 8px', overflow: 'hidden' } }}
        className="rounded-lg shadow-2xl"
      >
        <div className="relative bg-black flex flex-col">

          {playbackError && (
            <div className="absolute top-0 left-0 right-0 z-50">
              <Alert
                message={<b>Unsupported Codec (H.265 / HEVC)</b>}
                description={
                  <div className="flex flex-col gap-2 mt-1">
                    <span className="text-xs">
                      Web browsers cannot decode this video. Please download the file to watch it locally.
                    </span>
                    <Button size="small" type="primary" onClick={() => handleDownload(currentMeta)} style={{ width: '120px', backgroundColor: '#9864db', borderColor: '#9864db' }}>
                      Download File
                    </Button>
                  </div>
                }
                type="error"
                banner
              />
            </div>
          )}

          <div className="aspect-video bg-[#0f0f11] flex items-center justify-center border-b border-gray-800">
            <video
              ref={videoRef}
              src={currentVideo?.endsWith(".mp4") ? currentVideo : undefined}
              controls
              autoPlay
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          </div>

          <div className="p-5 bg-gray-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex flex-col">
              <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Date & Timestamp</span>
              <span className="text-white text-base font-semibold flex items-center gap-2 mt-0.5">
                <ClockCircleOutlined className="text-[#9864db]" />
                {getTimestamp(currentMeta)}
              </span>
            </div>
            <div className="flex gap-3">
              <Tooltip title="Open video file directly in a new tab">
                <Button
                  icon={<GlobalOutlined />}
                  onClick={() => window.open(getVideoUrl(currentMeta), '_blank')}
                  className="bg-gray-800 border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 rounded-md"
                >
                  Direct Link
                </Button>
              </Tooltip>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={() => handleDownload(currentMeta)}
                style={{ backgroundColor: '#9864db', borderColor: '#9864db' }}
                className="rounded-md font-semibold hover:opacity-90"
              >
                Download
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Standard Ajeevi Footer */}
      <div className="fixed bottom-2 right-4 text-xs font-bold z-50 bg-white/80 px-2 py-1 flex items-center backdrop-blur-sm rounded">
        <span className="text-red-600">© Ajeevi</span>{" "}
        <span className="text-blue-600 ml-1">Technologies Pvt. Ltd.</span>
      </div>
    </div>
  );
};

export default RecordingViewer;
