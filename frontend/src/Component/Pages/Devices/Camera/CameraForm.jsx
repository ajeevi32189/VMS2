// import React, { useEffect, useState } from "react";
// import {
//   Form,
//   Input,
//   InputNumber,
//   Button,
//   Card,
//   Select,
//   Spin,
//   message,
//   Row,
//   Col,
// } from "antd";
// import { useNavigate, useLocation } from "react-router-dom";
// import { deviceApi } from "../../../../utils/axiosInstance";
// import Cookies from "js-cookie";

// const { Option } = Select;

// function CameraForm() {
//   const [form] = Form.useForm();
//   const [loading, setLoading] = useState(false);
//   const [nvrs, setNvrs] = useState([]);
//   const [locations, setLocations] = useState([]);
//   const [zones, setZones] = useState([]);

//   const navigate = useNavigate();
//   const location = useLocation();

//   const userId = Cookies.get("userId");
//   const editingCamera = location.state?.camera || null;

//   // ✅ Fetch NVRs
//   const fetchNvrs = async () => {
//     try {
//       const nvrRes = await deviceApi.get(
//         `/NVR/?user_id=${userId}&page=1&page_size=100`,
//       );
//       setNvrs(nvrRes.data.results || []);
//     } catch (err) {
//       message.error("Failed to load NVR data");
//     }
//   };

//   // ✅ Fetch Locations

//   const fetchLocations = async () => {
//     try {
//       let url = `/Location/?user_id=${userId}`;
//       let allLocations = [];

//       while (url) {
//         const res = await deviceApi.get(url);
//         allLocations = [...allLocations, ...res.data.results];
//         url = res.data.next;
//       }

//       setLocations(allLocations);
//     } catch (err) {
//       message.error("Failed to load locations");
//     }
//   };

//   // const fetchLocations = async () => {
//   //   try {
//   //     const res = await deviceApi.get(`/Location/?user_id=${userId}&page=1&page_size=100`);
//   //     setLocations(res.data.results || []);
//   //   } catch (err) {
//   //     message.error("Failed to load locations");
//   //   }
//   // };

//   // ✅ Fetch Zones
//   const fetchZones = async () => {
//     try {
//       let url = `/Zone/?user_id=${userId}`;
//       let allZones = [];

//       while (url) {
//         const res = await deviceApi.get(url);
//         allZones = [...allZones, ...res.data.results];
//         url = res.data.next;
//       }

//       setZones(allZones);
//     } catch (err) {
//       message.error("Failed to load zones");
//     }
//   };

//   // const fetchZones = async () => {
//   //   try {
//   //     const res = await deviceApi.get(`/Zone/?user_id=${userId}&page=1&page_size=100`);
//   //     setZones(res.data.results || []);
//   //   } catch (err) {
//   //     message.error("Failed to load zones");
//   //   }
//   // };

//   // ✅ Call start API with camera ID and RTSP URL
//   const callStartApi = async (cameraId, rtspUrl) => {
//     try {
//       // Encode the RTSP URL for the API call
//       const encodedRtspUrl = encodeURIComponent(rtspUrl);
//       const startApiUrl = `http://14.195.152.244:9014/start?rtspurl=${encodedRtspUrl}&id=${cameraId}`;

//       // Call the start API
//       const response = await fetch(startApiUrl, {
//         method: "GET",
//         headers: {
//           accept: "application/json",
//         },
//       });

//       if (response.ok) {
//         const data = await response.json();
//         console.log("Start API response:", data);
//         return true;
//       } else {
//         console.error("Start API failed:", response.statusText);
//         return false;
//       }
//     } catch (error) {
//       console.error("Error calling start API:", error);
//       return false;
//     }
//   };
//   const callFastApiAddCamera = async (cameraId, rtspUrl) => {
//     try {
//       const res = await fetch("http://14.195.152.244:9014/add-camera", {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//         },
//         body: JSON.stringify({
//           id: String(cameraId),
//           rtspurl: rtspUrl,
//         }),
//       });

//       const data = await res.json();

//       if (res.ok) {
//         console.log("HLS:", data.hls_url);
//         return true;
//       } else {
//         console.error("FastAPI error:", data);
//         return false;
//       }
//     } catch (err) {
//       console.error("FastAPI call failed:", err);
//       return false;
//     }
//   };
//   useEffect(() => {
//     fetchNvrs();
//     fetchLocations();
//     fetchZones();

//     if (editingCamera) {
//       form.setFieldsValue(editingCamera);
//     }
//   }, [editingCamera]);

//   // ✅ Validation rules
//   const rules = {
//     ip: [
//       {
//         pattern:
//           /^(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}$/,
//         message: "Invalid IP address",
//       },
//     ],
//     rtsp: [
//       { required: true, message: "RTSP URL is required" },
//       {
//         pattern:
//           /^rtsp:\/\/(?:\S+(?::\S*)?@)?(?:[A-Za-z0-9.-]+|\[[A-Fa-f0-9:.]+\])(?::\d+)?(?:\/[^\s]*)?$/,
//         message: "Invalid RTSP URL",
//       },
//     ],
//     latitude: [
//       { required: true, message: "Latitude is required" },
//       {
//         validator: (_, value) =>
//           value >= -90 && value <= 90
//             ? Promise.resolve()
//             : Promise.reject("Latitude must be between -90 and 90"),
//       },
//     ],
//     longitude: [
//       { required: true, message: "Longitude is required" },
//       {
//         validator: (_, value) =>
//           value >= -180 && value <= 180
//             ? Promise.resolve()
//             : Promise.reject("Longitude must be between -180 and 180"),
//       },
//     ],
//   };

//   // ✅ Submit handler
//   const onFinish = async (values) => {
//     setLoading(true);
//     try {
//       const payload = {
//         ...values,
//         hotspot: "2", // static
//         channelId: 101, // static
//         macAddress: "00:1A:2B:3C:4D:5E", // static
//         userid: String(userId),
//         isRecording: 0,
//         isStreaming: 1,
//         creditId: "67890",
//       };

//       let cameraId;

//       if (editingCamera) {
//         // Update existing camera
//         const response = await deviceApi.put(
//           `/Camera/${editingCamera.id}/`,
//           payload,
//         );
//         cameraId = editingCamera.id;
//         message.success("Camera updated successfully!");
//       } else {
//         // Create new camera
//         const response = await deviceApi.post(`/Camera/`, payload);
//         // Assuming the response contains the created camera ID
//         cameraId = response.data.id || response.data.cameraId;
//         message.success("Camera created successfully!");
//       }

//       // Call the start API with the camera ID and RTSP URL
//       if (cameraId && values.rtspurl) {
//         const startApiSuccess = await callStartApi(cameraId, values.rtspurl);

//         if (startApiSuccess) {
//           message.success("Camera started successfully!");
//         } else {
//           message.warning("Camera saved but start API call failed");
//         }
//       }

//       navigate("/camera/detail");
//     } catch (err) {
//       console.error(err);
//       message.error("Operation failed");
//     } finally {
//       setLoading(false);
//     }
//   };

//   return (
//     <Card className="m-4 shadow-md">
//       <div className="mb-4 bg-[#9864DB] text-white px-6 py-2 rounded-md flex justify-between items-center">
//         <h3 className="text-xl font-semibold">
//           {editingCamera ? "✏️ Edit Camera" : "➕ Add Camera"}
//         </h3>
//         <Button
//           onClick={() => navigate("/camera/detail")}
//           style={{
//             background: "#9864DB",
//             color: "white",
//             borderColor: "#9864DB",
//           }}
//         >
//           📋 Camera Details
//         </Button>
//       </div>

//       <Spin spinning={loading}>
//         <Form form={form} layout="vertical" onFinish={onFinish}>
//           {/* Row 1 */}
//           <Row gutter={16}>
//             <Col span={12}>
//               <Form.Item
//                 label="Camera Name"
//                 name="name"
//                 rules={[{ required: true, message: "Camera Name is required" }]}
//               >
//                 <Input placeholder="Enter camera name" />
//               </Form.Item>
//             </Col>
//             <Col span={12}>
//               <Form.Item label="Camera IP" name="cameraIP" rules={rules.ip}>
//                 <Input placeholder="e.g., 10.0.0.1 (optional)" />
//               </Form.Item>
//             </Col>
//           </Row>

//           {/* Row 2 */}
//           <Row gutter={16}>
//             <Col span={12}>
//               <Form.Item label="Port" name="port">
//                 <InputNumber min={1} max={65535} style={{ width: "100%" }} />
//               </Form.Item>
//             </Col>
//             <Col span={12}>
//               {/* <Form.Item
//                 label="Location"
//                 name="location"
//                 rules={[{ required: true, message: "Location is required" }]}
//               >
//                 <Select placeholder="Select Location">
//                   {locations.map((loc) => (
//                     <Option key={loc.id} value={loc.id}>
//                       {loc.name}
//                     </Option>
//                   ))}
//                 </Select>
//               </Form.Item> */}
//               <Form.Item
//                 label="Location"
//                 name="location"
//                 rules={[{ required: true, message: "Location is required" }]}
//               >
//                 <Select placeholder="Select Location">
//                   {locations.map((loc) => (
//                     <Option key={loc.id} value={loc.id}>
//                       {loc.locationName || loc.name || `Location ${loc.id}`}
//                     </Option>
//                   ))}
//                 </Select>
//               </Form.Item>
//             </Col>
//           </Row>

//           {/* Row 3 */}
//           <Row gutter={16}>
//             <Col span={12}>
//               <Form.Item label="RTSP URL" name="rtspurl" rules={rules.rtsp}>
//                 <Input placeholder="rtsp://user:pass@ip:port/stream" />
//               </Form.Item>
//             </Col>
//             <Col span={12}>
//               <Form.Item
//                 label="NVR"
//                 name="nvrId"
//                 rules={[{ required: true, message: "Please select an NVR!" }]}
//               >
//                 <Select placeholder="Select NVR">
//                   {nvrs.map((n) => (
//                     <Option key={n.id} value={n.id}>
//                       {n.name}
//                     </Option>
//                   ))}
//                 </Select>
//               </Form.Item>
//             </Col>
//           </Row>

//           {/* Row 4 */}
//           <Row gutter={16}>
//             <Col span={12}>
//               <Form.Item label="Make" name="manufacture">
//                 <Input placeholder="Optional" />
//               </Form.Item>
//             </Col>
//             <Col span={12}>
//               <Form.Item label="Model" name="brand">
//                 <Input placeholder="Optional" />
//               </Form.Item>
//             </Col>
//           </Row>

//           {/* Row 5 */}
//           <Row gutter={16}>
//             <Col span={12}>
//               <Form.Item
//                 label="Zone"
//                 name="zone_id"
//                 rules={[{ required: true, message: "Zone is required" }]}
//               >
//                 <Select placeholder="Select Zone">
//                   {zones.map((z) => (
//                     <Option key={z.id} value={z.id}>
//                       {z.name}
//                     </Option>
//                   ))}
//                 </Select>
//               </Form.Item>
//             </Col>
//           </Row>

//           {/* Actions */}
//           <Form.Item>
//             <Button
//               type="primary"
//               htmlType="submit"
//               style={{ background: "#9864DB", borderColor: "#9864DB" }}
//             >
//               {editingCamera ? "Update Camera" : "Create Camera"}
//             </Button>
//             <Button
//               className="ml-2"
//               onClick={() => navigate("/camera/detail")}
//               style={{ borderColor: "#522EA8", color: "#522EA8" }}
//             >
//               Cancel
//             </Button>
//           </Form.Item>
//         </Form>
//       </Spin>
//     </Card>
//   );
// }

// export default CameraForm;

import React, { useEffect, useState } from "react";
import {
  Form,
  Input,
  InputNumber,
  Button,
  Card,
  Select,
  Spin,
  message,
  Row,
  Col,
} from "antd";
import { useNavigate, useLocation } from "react-router-dom";
import { deviceApi } from "../../../../utils/axiosInstance";
import Cookies from "js-cookie";

const { Option } = Select;

function CameraForm() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [nvrs, setNvrs] = useState([]);
  const [locations, setLocations] = useState([]);
  const [zones, setZones] = useState([]);

  const navigate = useNavigate();
  const location = useLocation();

  const userId = Cookies.get("userId");
  const editingCamera = location.state?.camera || null;

  // Fetch NVRs
  const fetchNvrs = async () => {
    try {
      const nvrRes = await deviceApi.get(
        `/NVR/?userid=${userId}&page=1&page_size=100`
      );
      setNvrs(nvrRes.data.results || []);
    } catch (err) {
      message.error("Failed to load NVR data");
    }
  };

  // Fetch Locations
  const fetchLocations = async () => {
    try {
      let url = `/Location/?userid=${userId}`;
      let allLocations = [];

      while (url) {
        const res = await deviceApi.get(url);
        allLocations = [...allLocations, ...res.data.results];
        url = res.data.next;
      }

      setLocations(allLocations);
    } catch (err) {
      message.error("Failed to load locations");
    }
  };

  // Fetch Zones
  const fetchZones = async () => {
    try {
      let url = `/Zone/?userid=${userId}`;
      let allZones = [];

      while (url) {
        const res = await deviceApi.get(url);
        allZones = [...allZones, ...res.data.results];
        url = res.data.next;
      }

      setZones(allZones);
    } catch (err) {
      message.error("Failed to load zones");
    }
  };

  const callFastApiAddCamera = async (cameraId, rtspUrl) => {
    try {
      const res = await fetch(
        `${import.meta.env.VITE_STREAMING_API_URL}/add-camera`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: `${cameraId}`, 
            rtspurl: rtspUrl,
          }),
        }
      );

      const data = await res.json();

      if (res.ok) {
        console.log("HLS:", data.hls_url);
        return true;
      } else {
        console.error("FastAPI error:", data);
        return false;
      }
    } catch (err) {
      console.error("FastAPI call failed:", err);
      return false;
    }
  };

  useEffect(() => {
    fetchNvrs();
    fetchLocations();
    fetchZones();

    if (editingCamera) {
      form.setFieldsValue(editingCamera);
    }
  }, [editingCamera]);

  const rules = {
    ip: [],
    rtsp: [
      { required: true, message: "RTSP URL is required" },
      {
        pattern:
          /^rtsp:\/\/(?:\S+(?::\S*)?@)?(?:[A-Za-z0-9.-]+|\[[A-Fa-f0-9:.]+\])(?::\d+)?(?:\/[^\s]*)?$/,
        message: "Invalid RTSP URL",
      },
    ],
  };

  // Submit
  const onFinish = async (values) => {
    setLoading(true);
    try {
      const payload = {
        ...values,
        hotspot: "2",
        channelId: 101,
        macAddress: "00:1A:2B:3C:4D:5E",
        userid: String(userId),
        isRecording: 0,
        isStreaming: 1,
        creditId: "67890",
      };

      let cameraId;

      if (editingCamera) {
        await deviceApi.put(`/Camera/${editingCamera.id}/`, payload);
        cameraId = editingCamera.id;
        message.success("Camera updated successfully!");
      } else {
        const response = await deviceApi.post(`/Camera/`, payload);
        cameraId = response.data.id || response.data.cameraId;
        message.success("Camera created successfully!");
      }

      if (cameraId && values.rtspurl) {
        const fastApiSuccess = await callFastApiAddCamera(
          cameraId, 
          values.rtspurl
        );

        if (fastApiSuccess) {
          message.success("Camera added & HLS ready ✅");
        } else {
          message.warning("Camera saved but streaming failed");
        }
      }

      navigate("/camera/detail");
    } catch (err) {
      console.error(err);
      message.error("Operation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="m-4 shadow-md">
      <div className="mb-4 bg-[#9864DB] text-white px-6 py-2 rounded-md flex justify-between items-center">
        <h3 className="text-xl font-semibold">
          {editingCamera ? "✏️ Edit Camera" : "➕ Add Camera"}
        </h3>
        <Button
          onClick={() => navigate("/camera/detail")}
          style={{
            background: "#9864DB",
            color: "white",
            borderColor: "#9864DB",
          }}
        >
          📋 Camera Details
        </Button>
      </div>

      <Spin spinning={loading}>
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="Camera Name"
                name="name"
                rules={[{ required: true, message: "Camera Name is required" }]}
              >
                <Input placeholder="Enter camera name" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Camera IP" name="cameraIP" rules={rules.ip}>
                <Input placeholder="e.g., x.x.x.x (optional)" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Port" name="port">
                <InputNumber min={1} max={65535} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="Location"
                name="location"
                rules={[{ required: true, message: "Location is required" }]}
              >
                <Select placeholder="Select Location">
                  {locations.map((loc) => (
                    <Option key={loc.id} value={loc.id}>
                      {loc.locationName || loc.name || `Location ${loc.id}`}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="RTSP URL" name="rtspurl" rules={rules.rtsp}>
                <Input placeholder="rtsp://user:pass@ip:port/stream" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="NVR"
                name="nvrId"
                rules={[{ required: true, message: "Please select an NVR!" }]}
              >
                <Select placeholder="Select NVR">
                  {nvrs.map((n) => (
                    <Option key={n.id} value={n.id}>
                      {n.name}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          {/* ✅ SAME AS YOUR ORIGINAL (NO CHANGE) */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Make" name="manufacture">
                <Input placeholder="Optional" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Model" name="brand">
                <Input placeholder="Optional" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="Zone"
                name="zone_id"
                rules={[{ required: true, message: "Zone is required" }]}
              >
                <Select placeholder="Select Zone">
                  {zones.map((z) => (
                    <Option key={z.id} value={z.id}>
                      {z.name}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              style={{ background: "#9864DB", borderColor: "#9864DB" }}
            >
              {editingCamera ? "Update Camera" : "Create Camera"}
            </Button>
            <Button
              className="ml-2"
              onClick={() => navigate("/camera/detail")}
              style={{ borderColor: "#522EA8", color: "#522EA8" }}
            >
              Cancel
            </Button>
          </Form.Item>
        </Form>
      </Spin>
    </Card>
  );
}

export default CameraForm;