import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
} from "@tanstack/react-table";
import {
  Modal,
  Select,
  Button,
  Tag,
  Empty,
  Spin,
  message,
  Card,
  Row,
  Col,
  Alert,
  Upload,
  Input,
  Radio,
  Image,
  Popconfirm,
  Badge,
} from "antd";
import {
  PlayCircleOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  VideoCameraOutlined,
  DownloadOutlined,
  PlusOutlined,
  DeleteOutlined,
  HistoryOutlined,
  CheckCircleOutlined,
  SyncOutlined,
  UploadOutlined,
  AlertOutlined,
  ExclamationCircleOutlined,
  InboxOutlined,
} from "@ant-design/icons";
import Cookies from "js-cookie";
import axios from "axios";
import { deviceApi } from "../../../utils/axiosInstance";
import { ANALYTICS_API_URL, RECORDING_API_URL } from "../../../config";
import { AlertSnapshot, formatIndianDateTime } from "../../../utils/imageUtils";

const { Option } = Select;
const columnHelper = createColumnHelper();

const VideoUploadAnalytics = () => {
  const [activeTab, setActiveTab] = useState("new_job"); // "new_job" or job.id
  const [jobs, setJobs] = useState([]);
  
  // Form State
  const [jobName, setJobName] = useState("");
  const [sourceType, setSourceType] = useState("upload"); // "upload" or "recording"
  const [uploadedFile, setUploadedFile] = useState(null);
  const [fileList, setFileList] = useState([]);
  const [selectedRecording, setSelectedRecording] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [loadingRecordings, setLoadingRecordings] = useState(false);
  
  // Detection Groups State
  const [availableGroups, setAvailableGroups] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(false);

  // Active Job State
  const [alerts, setAlerts] = useState([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [sorting, setSorting] = useState([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  
  const [submittingJob, setSubmittingJob] = useState(false);
  const [localVideoUrl, setLocalVideoUrl] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [progressState, setProgressState] = useState(""); // "downloading", "uploading", "processing", ""

  const userId = Cookies.get("userId") || "anonymous";
  const pollingIntervalRef = useRef(null);

  // Load jobs from localStorage on mount
  useEffect(() => {
    const savedJobs = localStorage.getItem("video_analytics_jobs");
    if (savedJobs) {
      try {
        setJobs(JSON.parse(savedJobs));
      } catch (e) {
        console.error("Failed to parse saved jobs", e);
      }
    }
  }, []);

  // Save jobs to localStorage when state changes
  const saveJobsToLocalStorage = (updatedJobs) => {
    localStorage.setItem("video_analytics_jobs", JSON.stringify(updatedJobs));
    setJobs(updatedJobs);
  };

  // Fetch available recordings
  const fetchRecordingsList = async () => {
    setLoadingRecordings(true);
    try {
      const res = await axios.get(`${RECORDING_API_URL}/api/v1/recordings`, {
        params: { page: 1, pageSize: 100 },
      });
      const data = res?.data?.recordings || [];
      setRecordings(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to fetch recording archive:", err);
      message.warning("Failed to load recording archive list.");
    } finally {
      setLoadingRecordings(false);
    }
  };

  // Fetch detection groups
  const fetchDetectionGroups = async () => {
    setLoadingGroups(true);
    try {
      const res = await deviceApi.get("/DetectionGroups/");
      setAvailableGroups(res.data.results || []);
    } catch (err) {
      console.error("Failed to load detection groups:", err);
      message.error("Failed to load detection use cases.");
    } finally {
      setLoadingGroups(false);
    }
  };

  useEffect(() => {
    fetchDetectionGroups();
    fetchRecordingsList();
  }, []);

  const getRecordingUrl = (rec) => {
    if (!rec) return null;
    const path = rec.fileUrl || rec.file_url || rec.url || rec.file_path || rec.filename || rec.fileName;
    if (!path) return null;
    if (path.toString().startsWith("http")) return path.toString();
    const cleanPath = path.toString().replace(/^\/+/, "");
    return `${RECORDING_API_URL}/${cleanPath}`;
  };

  // Handle switching tabs
  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    setAlerts([]);
    setPage(1);
    setGlobalFilter("");
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    if (tabId !== "new_job") {
      const job = jobs.find((j) => j.id === tabId);
      if (job) {
        if (job.inputType === "recording" && job.url) {
          setLocalVideoUrl(job.url);
        } else if (job.inputType === "upload") {
          // If we uploaded it in this session we might have blob url, otherwise empty
          setLocalVideoUrl(job.localBlobUrl || "");
        }
        
        fetchJobAlerts(job.id);
        
        // Start polling if job is processing
        if (job.status === "processing") {
          pollingIntervalRef.current = setInterval(() => {
            fetchJobAlerts(job.id, true);
          }, 3000);
        }
      }
    } else {
      setLocalVideoUrl("");
    }
  };

  // Fetch alerts for a specific job/camera ID
  const fetchJobAlerts = async (jobId, isPolling = false) => {
    if (!isPolling) setLoadingAlerts(true);
    try {
      // Query alerts for this specific job ID (passed as camera_id)
      const res = await deviceApi.get(
        `/CameraAlert/?userid=${userId}&camera_id=${jobId}&end_date=&format=json&page=1&pageSize=1000&start_date=`
      );
      
      let allResults = res.data.results || [];
      
      if (globalFilter && globalFilter.trim()) {
        const q = globalFilter.trim().toLowerCase();
        allResults = allResults.filter(item =>
          (item.camera_name || item.cameraName || item.camera || item.name || "").toLowerCase().includes(q) ||
          (item.objectName || "").toLowerCase().includes(q) ||
          (item.alertType || "").toLowerCase().includes(q) ||
          (item.camera_location || item.location || "").toLowerCase().includes(q) ||
          String(item.deviceId || item.device_id || item.camera_id || "").toLowerCase().includes(q) ||
          String(item.id || "").toLowerCase().includes(q)
        );
      }
      
      // Sort newest first
      allResults.sort((a, b) => new Date(b.regDate) - new Date(a.regDate));
      
      setAlerts(allResults);
      setTotalCount(allResults.length);
      setTotalPages(Math.max(1, Math.ceil(allResults.length / pageSize)));

      // Check if EOF / job completion is indicated in any alert
      const hasEof = allResults.some(
        (alert) =>
          alert.objectName?.toLowerCase().includes("eof") ||
          JSON.stringify(alert).toLowerCase().includes("eof")
      );

      if (hasEof) {
        markJobCompleted(jobId);
      }
    } catch (err) {
      console.error("Failed to fetch alerts for job:", err);
    } finally {
      if (!isPolling) setLoadingAlerts(false);
    }
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  // Mark a job as completed
  const markJobCompleted = (jobId) => {
    const updatedJobs = jobs.map((job) => {
      if (job.id === jobId && job.status === "processing") {
        message.success(`Analytics job "${job.name}" completed processing!`);
        return { ...job, status: "completed" };
      }
      return job;
    });
    
    // Only update and clear interval if status changed
    const currentJob = jobs.find(j => j.id === jobId);
    if (currentJob && currentJob.status === "processing") {
      saveJobsToLocalStorage(updatedJobs);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }
  };

  const handleStartAnalytics = async () => {
    // Validation
    if (sourceType === "upload" && !uploadedFile) {
      return message.error("Please upload a video file first.");
    }
    if (sourceType === "recording" && !selectedRecording) {
      return message.error("Please select a recording from the archive.");
    }
    if (selectedGroups.length === 0) {
      return message.error("Please select at least one analytics use case.");
    }

    setSubmittingJob(true);
    setUploadProgress(0);
    setProgressState("");
    const jobId = `job_${Date.now()}`;
    const finalJobName = jobName.trim() || (sourceType === "upload" ? uploadedFile.name : `Recording ${selectedRecording}`);
    
    const selectedGroupNames = availableGroups
      .filter((g) => selectedGroups.includes(g.id))
      .map((g) => g.name);

    try {
      const formData = new FormData();
      formData.append("camera_id", jobId);
      formData.append("camera_name", finalJobName);
      formData.append("objectlist", JSON.stringify(selectedGroupNames));
      formData.append("user_id", userId);

      let videoSourceUrl = "";
      let blobUrl = "";

      if (sourceType === "upload") {
        formData.append("file", uploadedFile);
        blobUrl = URL.createObjectURL(uploadedFile);
        setProgressState("uploading");
      } else {
        const recordingObj = recordings.find((r) => r.id === selectedRecording);
        videoSourceUrl = getRecordingUrl(recordingObj);
        
        // Fetch recording as blob so it acts exactly like a local file upload
        setProgressState("downloading");
        try {
          const recResponse = await axios.get(videoSourceUrl, {
            responseType: "blob",
            onDownloadProgress: (progressEvent) => {
              if (progressEvent.total) {
                const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                setUploadProgress(percentCompleted);
              }
            },
          });
          const videoFile = new File([recResponse.data], `recording_${selectedRecording}.mp4`, { type: recResponse.data.type || "video/mp4" });
          formData.append("file", videoFile);
          blobUrl = URL.createObjectURL(videoFile);
          
          setUploadProgress(0);
          setProgressState("uploading");
        } catch (fetchErr) {
          console.error("Failed to fetch recording blob:", fetchErr);
          throw new Error("Failed to fetch recording from archive. It might be unavailable or blocked by CORS.");
        }
      }

      // Call Flask Analytics Backend Upload endpoint
      // Using standard Axios to post form data (no custom headers to avoid preflight issues)
      const response = await axios.post(`${ANALYTICS_API_URL}/UploadVideo`, formData, {
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(percentCompleted);
            if (percentCompleted === 100) {
              setProgressState("processing");
            }
          }
        },
      });

      if (response.status === 200 || response.status === 201) {
        message.success("Video submitted for analytics successfully!");

        const newJob = {
          id: jobId,
          name: finalJobName,
          inputType: sourceType,
          fileName: sourceType === "upload" ? uploadedFile.name : `Recording ID: ${selectedRecording}`,
          url: videoSourceUrl,
          localBlobUrl: blobUrl,
          status: "processing",
          createdAt: new Date().toISOString(),
          selectedGroups: selectedGroupNames,
        };

        const updatedJobs = [newJob, ...jobs];
        saveJobsToLocalStorage(updatedJobs);

        // Reset Form
        setJobName("");
        setUploadedFile(null);
        setFileList([]);
        setSelectedRecording(null);
        setSelectedGroups([]);
        
        // Select newly created job
        handleTabChange(jobId);
      } else {
        throw new Error("Invalid response from analytics server");
      }
    } catch (err) {
      console.error("Failed to start video analytics job:", err);
      message.error(err.message || "Failed to connect or submit to analytics backend server.");
    } finally {
      setSubmittingJob(false);
      setProgressState("");
      setUploadProgress(0);
    }
  };

  const handleDeleteJob = (jobId, e) => {
    e.stopPropagation();
    const updatedJobs = jobs.filter((job) => job.id !== jobId);
    saveJobsToLocalStorage(updatedJobs);
    
    if (activeTab === jobId) {
      handleTabChange("new_job");
    }
    message.success("Job deleted from history.");
  };

  const handleForceComplete = (jobId) => {
    const updatedJobs = jobs.map((job) => {
      if (job.id === jobId) {
        return { ...job, status: "completed" };
      }
      return job;
    });
    saveJobsToLocalStorage(updatedJobs);
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    message.info("Job marked as completed.");
  };

  // Upload handlers
  const uploadProps = {
    onRemove: () => {
      setUploadedFile(null);
      setFileList([]);
    },
    beforeUpload: (file) => {
      const maxSizeBytes = 1024 * 1024 * 1024; // 1GB
      const isVideo = file.type.startsWith("video/") || file.type === "video/mpeg" || file.name.endsWith(".mp4") || file.name.endsWith(".avi") || file.name.endsWith(".mkv") || file.name.endsWith(".mpeg") || file.name.endsWith(".mpg") || file.name.endsWith(".mov");
      if (!isVideo) {
        message.error(`${file.name} is not a valid video file.`);
        return Upload.LIST_IGNORE;
      }
      if (file.size > maxSizeBytes) {
        message.error(`File size must be less than 1GB. Current size: ${(file.size / (1024 * 1024)).toFixed(2)}MB`);
        return Upload.LIST_IGNORE;
      }
      setUploadedFile(file);
      setFileList([file]);
      return false; // Prevent auto-upload
    },
    fileList,
    maxCount: 1,
  };

  // Table Columns config
  const columns = useMemo(() => [
    columnHelper.display({
      id: "srno",
      header: "Sr. No.",
      cell: (info) => pageSize * (page - 1) + info.row.index + 1,
    }),
    columnHelper.accessor("objectName", {
      header: "Detected Event",
      cell: (info) => {
        const raw = info.getValue();
        if (!raw) return "-";
        const rawStr = String(raw);
        try {
          const cleaned = rawStr.replace(/'/g, '"');
          const parsed = JSON.parse(cleaned);
          const eventName = Object.keys(parsed)[0] || rawStr;
          let emoji = "🚨";
          const eventLower = String(eventName).toLowerCase();
          if (eventLower.includes("fire")) emoji = "🔥";
          else if (eventLower.includes("smoke")) emoji = "💨";
          else if (eventLower.includes("rodent")) emoji = "🐀";
          else if (eventLower.includes("crowd")) emoji = "👥";
          else if (eventLower.includes("anpr") || eventLower.includes("license")) emoji = "🚗";
          
          return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-700 border border-purple-200">
              {emoji} {eventName}
            </span>
          );
        } catch {
          let emoji = "🚨";
          const rawLower = rawStr.toLowerCase();
          if (rawLower.includes("fire")) emoji = "🔥";
          else if (rawLower.includes("smoke")) emoji = "💨";
          else if (rawLower.includes("rodent")) emoji = "🐀";
          else if (rawLower.includes("crowd")) emoji = "👥";
          
          return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-700 border border-purple-200">
              {emoji} {rawStr}
            </span>
          );
        }
      },
    }),
    columnHelper.accessor("alertStatus", {
      header: "Severity",
      cell: (info) => {
        const code = info.getValue();
        let label = "Unknown";
        let color = "bg-gray-100 text-gray-600 border-gray-200";
        switch (code) {
          case "B": label = "Basic"; color = "bg-blue-50 text-blue-700 border-blue-200"; break;
          case "C": label = "Critical"; color = "bg-red-50 text-red-700 border-red-200 animate-pulse"; break;
          case "S": label = "Severe"; color = "bg-orange-50 text-orange-700 border-orange-200"; break;
          case "N": label = "Normal"; color = "bg-green-50 text-green-700 border-green-200"; break;
        }
        return (
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${color}`}>
            {label}
          </span>
        );
      },
    }),
    columnHelper.accessor("regDate", {
      header: "Timestamp",
      cell: (info) => formatIndianDateTime(info.getValue()),
    }),
    columnHelper.accessor("framePath", {
      header: "Snapshot",
      cell: (info) => {
        const path = info.getValue();
        if (!path) return <span>-</span>;
        const row = info.row.original;

        return (
          <AlertSnapshot
            path={path}
            cameraName={row.camera_name}
            alt="alert snapshot"
            width={80}
            height={60}
            className="object-cover rounded border border-gray-200 hover:scale-105 transition-transform"
            preview={{ mask: "Preview" }}
          />
        );
      },
    }),
  ], [page, pageSize]);

  // Paginated Data
  const paginatedAlerts = useMemo(() => {
    const startIndex = (page - 1) * pageSize;
    return alerts.slice(startIndex, startIndex + pageSize);
  }, [alerts, page, pageSize]);

  const table = useReactTable({
    data: paginatedAlerts,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
  });

  const getStatusBadge = (status) => {
    switch (status) {
      case "processing":
        return <Badge status="processing" text="Processing" className="text-purple-600 font-semibold" />;
      case "completed":
        return <Badge status="success" text="Completed" className="text-green-600 font-semibold" />;
      case "failed":
        return <Badge status="error" text="Failed" className="text-red-600 font-semibold" />;
      default:
        return <Badge status="default" text="Idle" />;
    }
  };

  const selectedJobDetails = useMemo(() => {
    return jobs.find((j) => j.id === activeTab);
  }, [jobs, activeTab]);

  return (
    <div className="p-4 space-y-4 max-w-full min-h-[calc(100vh-80px)]">
      {/* Header */}
      <div className="flex px-4 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA] shadow-md">
        <div className="flex items-center gap-2">
          <VideoCameraOutlined className="text-2xl text-[#fce4e4]" />
          <h2 className="text-xl font-bold text-[#fce4e4]">
            Recorded Video Upload & Analytics
          </h2>
        </div>
        <div className="text-xs text-purple-200">
          Process local files or archived camera recordings
        </div>
      </div>

      <Row gutter={[16, 16]}>
        {/* Left Sidebar - Jobs History */}
        <Col xs={24} md={8} lg={6}>
          <Card
            title={
              <div className="flex items-center gap-2 text-purple-800">
                <HistoryOutlined />
                <span className="font-semibold text-sm">Analytics Jobs History</span>
              </div>
            }
            bodyStyle={{ padding: "8px 0" }}
            className="shadow-sm border-[#e7e5ec] h-[calc(100vh-180px)] overflow-y-auto"
            extra={
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => handleTabChange("new_job")}
                className="bg-[#9864db] hover:bg-[#8754d1] border-none"
              >
                New Job
              </Button>
            }
          >
            {jobs.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <Empty description="No jobs processed yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              </div>
            ) : (
              <div className="space-y-1">
                {jobs.map((job) => {
                  const isActive = activeTab === job.id;
                  return (
                    <div
                      key={job.id}
                      onClick={() => handleTabChange(job.id)}
                      className={`flex flex-col p-3 mx-2 rounded-lg cursor-pointer transition-all ${
                        isActive
                          ? "bg-purple-100 border-l-4 border-purple-600 text-purple-900"
                          : "hover:bg-gray-50 text-gray-700"
                      }`}
                    >
                      <div className="flex justify-between items-start gap-1">
                        <span className="font-bold text-xs truncate max-w-[150px]">{job.name}</span>
                        <Popconfirm
                          title="Delete this job from history?"
                          onConfirm={(e) => handleDeleteJob(job.id, e)}
                          okText="Yes"
                          cancelText="No"
                          onCancel={(e) => e.stopPropagation()}
                        >
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={(e) => e.stopPropagation()}
                            className="h-6 w-6 p-0 hover:bg-red-50 rounded"
                          />
                        </Popconfirm>
                      </div>
                      
                      <div className="flex items-center justify-between mt-2 text-[10px] text-gray-500">
                        <span>
                          {job.inputType === "upload" ? "📂 Upload" : "🎥 Archive"}
                        </span>
                        <span>
                          {new Date(job.createdAt).toLocaleDateString("en-IN", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-[10px]">
                          {job.status === "processing" ? (
                            <Tag color="processing" icon={<SyncOutlined spin />} className="m-0 py-0 text-[9px]">
                              Analyzing
                            </Tag>
                          ) : (
                            <Tag color="success" icon={<CheckCircleOutlined />} className="m-0 py-0 text-[9px]">
                              Completed
                            </Tag>
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </Col>

        {/* Right Main Panel */}
        <Col xs={24} md={16} lg={18}>
          {activeTab === "new_job" ? (
            <Card
              title={
                <div className="text-[#3B1E54] font-semibold flex items-center gap-2">
                  <PlusOutlined /> Create New Analytics Job
                </div>
              }
              className="shadow-sm border-[#e7e5ec]"
            >
              <div className="space-y-5">
                {/* Job Name */}
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-2 uppercase">
                    Job Name (Optional)
                  </label>
                  <Input
                    placeholder="Enter custom name for this analysis job (e.g. Warehouse A Smoke Test)"
                    value={jobName}
                    onChange={(e) => setJobName(e.target.value)}
                    className="max-w-xl"
                  />
                </div>

                {/* Input Type Selector */}
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-2 uppercase">
                    Select Video Input Source
                  </label>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setSourceType("upload")}
                      className={`px-4 py-2 text-xs font-semibold rounded-md border flex items-center gap-2 transition-all ${
                        sourceType === "upload"
                          ? "bg-[#9864db] text-white border-[#9864db] shadow"
                          : "bg-white text-[#3B1E54] border-purple-200 hover:bg-purple-50"
                      }`}
                    >
                      📂 Upload Local File
                    </button>
                    <button
                      type="button"
                      onClick={() => setSourceType("recording")}
                      className={`px-4 py-2 text-xs font-semibold rounded-md border flex items-center gap-2 transition-all ${
                        sourceType === "recording"
                          ? "bg-[#9864db] text-white border-[#9864db] shadow"
                          : "bg-white text-[#3B1E54] border-purple-200 hover:bg-purple-50"
                      }`}
                    >
                      🎥 Archive Recording
                    </button>
                  </div>
                </div>

                {/* Conditional Form - Local Upload */}
                {sourceType === "upload" && (
                  <div className="max-w-xl border border-dashed border-purple-300 rounded-lg p-5 bg-purple-50/20">
                    <Upload.Dragger {...uploadProps} className="bg-white">
                      <p className="ant-upload-drag-icon text-purple-500">
                        <InboxOutlined />
                      </p>
                      <p className="ant-upload-text text-sm font-semibold text-gray-700">
                        Click or drag video file to this area to upload
                      </p>
                      <p className="ant-upload-hint text-xs text-gray-500">
                        Supports MP4, AVI, MKV, MOV, MPEG formats. Max size 1GB.
                      </p>
                    </Upload.Dragger>
                  </div>
                )}

                {/* Conditional Form - Archive Recording */}
                {sourceType === "recording" && (
                  <div className="max-w-xl">
                    <label className="block text-xs font-semibold text-gray-500 mb-1">
                      Choose Recording from Server Archive
                    </label>
                    <Select
                      placeholder="Select a recording..."
                      loading={loadingRecordings}
                      value={selectedRecording}
                      onChange={(val) => setSelectedRecording(val)}
                      className="w-full text-black"
                      showSearch
                      optionFilterProp="children"
                    >
                      {recordings.map((rec) => {
                        const time = rec.recDate || rec.start_time || rec.created_at || "Archive";
                        const formattedTime = new Date(time).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        });
                        return (
                          <Option key={rec.id} value={rec.id}>
                            Camera: {rec.camera_id} | {formattedTime} ({rec.fileSizeKB ? `${Math.round(rec.fileSizeKB)} KB` : "TS"})
                          </Option>
                        );
                      })}
                    </Select>
                  </div>
                )}

                {/* Analytics Use Case / Detection Groups */}
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-2 uppercase">
                    Select Use Cases / Detection Models to Apply
                  </label>
                  
                  {loadingGroups ? (
                    <div className="py-4">
                      <Spin size="small" /> Loading use cases...
                    </div>
                  ) : availableGroups.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {availableGroups.map((group) => {
                        const isSelected = selectedGroups.includes(group.id);
                        return (
                          <button
                            key={group.id}
                            type="button"
                            onClick={() => {
                              const nextSelected = isSelected
                                ? selectedGroups.filter((id) => id !== group.id)
                                : [...selectedGroups, group.id];
                              setSelectedGroups(nextSelected);
                            }}
                            className={`px-4 py-1.5 text-xs font-semibold rounded-full border transition-all duration-200 cursor-pointer ${
                              isSelected
                                ? "bg-[#9864db] text-white border-[#9864db] shadow-sm"
                                : "bg-white text-purple-700 border-purple-200 hover:bg-purple-50 hover:border-purple-300"
                            }`}
                          >
                            {group.name}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <Empty description="No detection groups found on server." image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  )}
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleStartAnalytics}
                    disabled={submittingJob}
                    className="px-6 py-2.5 rounded-lg bg-[#9864db] hover:bg-[#8754d1] text-white font-semibold shadow hover:shadow-lg transition-all flex items-center gap-2 disabled:opacity-80 disabled:cursor-not-allowed text-sm w-full sm:w-auto justify-center"
                  >
                    {submittingJob ? (
                      <>
                        <Spin size="small" className="text-white" />
                        {progressState === "downloading" ? `Fetching Recording... ${uploadProgress}%` :
                         progressState === "uploading" ? `Uploading Video... ${uploadProgress}%` :
                         progressState === "processing" ? "Processing on Server..." : "Starting..."}
                      </>
                    ) : (
                      <>
                        <PlayCircleOutlined />
                        Start Analytics Process
                      </>
                    )}
                  </button>
                  
                  {submittingJob && progressState && progressState !== "processing" && (
                    <div className="mt-3 max-w-xl">
                      <div className="flex justify-between text-xs text-gray-500 mb-1 font-semibold">
                        <span>{progressState === "downloading" ? "Downloading from archive..." : "Uploading to analytics server..."}</span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-[#9864db] h-2 rounded-full transition-all duration-300 ease-out" 
                          style={{ width: `${uploadProgress}%` }}
                        ></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ) : (
            /* Selected Job Analytics Dashboard */
            <div className="space-y-4">
              {/* Job Summary Banner */}
              {selectedJobDetails && (
                <Card className="shadow-sm border-[#e7e5ec]">
                  <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-bold text-gray-800">
                          {selectedJobDetails.name}
                        </h3>
                        {getStatusBadge(selectedJobDetails.status)}
                      </div>
                      <div className="text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
                        <span>
                          <b>Job ID:</b> {selectedJobDetails.id}
                        </span>
                        <span>
                          <b>Source:</b> {selectedJobDetails.inputType === "upload" ? "Local Upload" : "Archived Recording"}
                        </span>
                        <span>
                          <b>Created:</b> {new Date(selectedJobDetails.createdAt).toLocaleString("en-IN")}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {selectedJobDetails.selectedGroups.map((g, idx) => (
                          <span key={idx} className="px-2 py-0.5 text-[10px] rounded bg-purple-100 text-purple-800 font-semibold">
                            {g}
                          </span>
                        ))}
                      </div>
                    </div>
                    
                    <div className="flex gap-2">
                      {selectedJobDetails.status === "processing" && (
                        <>
                          <Button
                            size="small"
                            type="dashed"
                            danger
                            onClick={() => handleForceComplete(selectedJobDetails.id)}
                            icon={<CheckCircleOutlined />}
                          >
                            Mark Completed
                          </Button>
                          <Button
                            size="small"
                            icon={<ReloadOutlined spin={loadingAlerts} />}
                            onClick={() => fetchJobAlerts(selectedJobDetails.id)}
                          >
                            Refresh
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </Card>
              )}

              {/* Video Player (if available) */}
              {localVideoUrl && (
                <Card className="shadow-sm border-[#e7e5ec] overflow-hidden" bodyStyle={{ padding: 0 }}>
                  <div className="aspect-video max-h-[350px] bg-black flex items-center justify-center">
                    <video
                      src={localVideoUrl}
                      controls
                      autoPlay
                      muted
                      className="w-full h-full object-contain"
                    />
                  </div>
                </Card>
              )}

              {/* Alerts Section */}
              <Card
                title={
                  <div className="flex justify-between items-center w-full">
                    <div className="text-[#3B1E54] font-semibold flex items-center gap-2 text-sm">
                      <AlertOutlined /> Alerts Generated ({totalCount})
                    </div>
                    {selectedJobDetails?.status === "processing" && (
                      <span className="text-[10px] text-purple-500 animate-pulse flex items-center gap-1">
                        <SyncOutlined spin /> Live polling active...
                      </span>
                    )}
                  </div>
                }
                className="shadow-sm border-[#e7e5ec]"
              >
                <div className="space-y-4">
                  {/* Table Toolbar */}
                  <div className="flex justify-end gap-3 items-center">
                    <input
                      type="text"
                      placeholder="Search job alerts..."
                      value={globalFilter}
                      onChange={(e) => {
                        setGlobalFilter(e.target.value);
                        setPage(1);
                        setTimeout(() => fetchJobAlerts(selectedJobDetails.id), 100);
                      }}
                      className="px-3 py-1 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring focus:ring-purple-300 min-w-[200px]"
                    />
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(1);
                      }}
                      className="px-2 py-1 border border-gray-300 rounded-md text-sm"
                    >
                      {[10, 25, 50].map((size) => (
                        <option key={size} value={size}>
                          Show {size}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Table */}
                  <div className="overflow-x-auto rounded-md border-[#e7e5ec] shadow-sm">
                    <table className="min-w-full text-sm">
                      <thead className="bg-[#9864db] text-[#E6E6FA]">
                        {table.getHeaderGroups().map((headerGroup) => (
                          <tr key={headerGroup.id}>
                            {headerGroup.headers.map((header) => (
                              <th
                                key={header.id}
                                className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold"
                              >
                                {flexRender(header.column.columnDef.header, header.getContext())}
                              </th>
                            ))}
                          </tr>
                        ))}
                      </thead>
                      <tbody className="bg-white divide-y divide-purple-50">
                        {loadingAlerts && alerts.length === 0 ? (
                          <tr>
                            <td colSpan={columns.length} className="text-center py-8">
                              <div className="flex items-center justify-center gap-2">
                                <Spin size="small" />
                                Loading event alerts...
                              </div>
                            </td>
                          </tr>
                        ) : table.getRowModel().rows.length > 0 ? (
                          table.getRowModel().rows.map((row) => (
                            <tr key={row.id} className="hover:bg-purple-50/30 transition-colors">
                              {row.getVisibleCells().map((cell) => (
                                <td
                                  key={cell.id}
                                  className="px-4 py-3 border border-purple-100 whitespace-normal break-words"
                                >
                                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </td>
                              ))}
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={columns.length} className="text-center py-12 text-gray-400">
                              <Empty description="No alerts generated for this job yet." image={Empty.PRESENTED_IMAGE_SIMPLE} />
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  <div className="flex flex-col sm:flex-row justify-between items-center mt-4 gap-2">
                    <div className="flex flex-col sm:flex-row items-center gap-2">
                      <span className="text-xs text-gray-600">
                        Page {page} of {totalPages || 1}
                      </span>
                      <span className="text-xs text-gray-600">
                        Showing {alerts.length} of {totalCount} alert{totalCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex gap-2 items-center">
                      <button
                        onClick={() => setPage((p) => Math.max(p - 1, 1))}
                        className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs font-semibold"
                        disabled={page === 1 || loadingAlerts}
                      >
                        Prev
                      </button>
                      <button
                        onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                        className="px-3 py-1 border rounded bg-green-100 text-[#2c028d] hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs font-semibold"
                        disabled={page === totalPages || loadingAlerts}
                      >
                        Next
                      </button>
                      <div className="flex items-center gap-1 ml-2">
                        <span className="text-xs text-gray-600">Go to:</span>
                        <input
                          type="number"
                          min="1"
                          max={totalPages}
                          value={page}
                          onChange={(e) => {
                            const value = parseInt(e.target.value);
                            if (value >= 1 && value <= totalPages) {
                              setPage(value);
                            }
                          }}
                          className="w-12 px-2 py-0.5 border border-gray-300 rounded text-xs text-center"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </Col>
      </Row>

      {/* standard footer */}
      <div className="fixed bottom-2 right-4 text-xs font-bold z-50 bg-white/80 px-2 py-1 flex items-center backdrop-blur-sm rounded">
        <span className="text-red-600">© Ajeevi</span>{" "}
        <span className="text-blue-600 ml-1">Technologies Pvt. Ltd.</span>
      </div>
    </div>
  );
};

export default VideoUploadAnalytics;
