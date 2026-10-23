import React, { useEffect, useState } from "react";
import { Table, Checkbox, Button, Spin, message, Input, Select, Tooltip } from "antd";
import Cookies from "js-cookie";
import { deviceApi } from "../../../../utils/axiosInstance";
import axios from "axios";
import { ONVIF_API_URL } from "../../../../config";
import { useNavigate } from "react-router-dom";
const { Option } = Select;

const Expand = ({ data }) => {
  const userId = Cookies.get("userId");
  const navigate = useNavigate();
  const [cameraData, setCameraData] = useState([]);
  const [addCameraData, setAddCameraData] = useState([]);
  const [locations, setLocations] = useState([]);
  const [zones, setZones] = useState([]);
  const [selectedCameras, setSelectedCameras] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchCameraDetails();
    fetchLocations();
    fetchZones();
  }, []);

  const fetchCameraDetails = async () => {
    setLoading(true);
    try {
      const added = await deviceApi.get(`/Camera/?userid=${userId}`);
      setAddCameraData(added.data.results || []);

      const onvif = await axios.post(`${ONVIF_API_URL}/get_camera_details`, {
        cameras: [{ nvr_ip: data.nvrip, username: data.username, password: data.password, nvr_port: parseInt(data.port, 10) }],
      });

      if (onvif.data?.[data.nvrip]?.error) {
        message.error(onvif.data[data.nvrip].error);
        setCameraData([]);
      } else {
        // Filter to show only MainStream entries (skip SubStream1, SubStream2 duplicates)
        const allCameras = onvif.data[data.nvrip] || [];
        const mainStreamOnly = allCameras.filter(cam => {
          const name = cam["Camera Name"] || "";
          // Keep if it's a MainStream OR if it doesn't have SubStream in the name
          return !name.includes("SubStream");
        });
        setCameraData(mainStreamOnly);
      }

    } catch (err) {
      console.error(err);
      message.error("Failed to fetch ONVIF cameras!");
    } finally {
      setLoading(false);
    }
  };


  const fetchLocations = async () => {
    try {
      let url = `/Location/`;
      let all = [];

      while (url) {
        const res = await deviceApi.get(url);
        all = [...all, ...res.data.results];
        url = res.data.next;
      }

      setLocations(all);
    } catch {
      message.error("Failed to load locations");
    }
  };


  // const fetchLocations = async () => {
  //   try {
  //     const res = await deviceApi.get(`/Location/`);
  //     setLocations(res.data.results || []);
  //   } catch {
  //     message.error("Failed to load locations");
  //   }
  // };

  const fetchZones = async () => {
    try {
      let url = `/Zone/`;
      let allZones = [];

      while (url) {
        const res = await deviceApi.get(url);
        allZones.push(...res.data.results);
        url = res.data.next;
      }

      setZones(allZones);
    } catch {
      message.error("Failed to load zones");
    }
  };

  // const fetchZones = async () => {
  //   try {
  //     const res = await deviceApi.get(`/Zone/`);
  //     setZones(res.data.results || []);
  //   } catch {
  //     message.error("Failed to load zones");
  //   }
  // };

  const handleCheckboxChange = (camera, checked) => {
    const key = camera["Stream URI"];
    if (checked) {
      setSelectedCameras((prev) => ({
        ...prev,
        [key]: {
          ...camera,
          camera_name: camera["Camera Name"] || "",
          // location: null,
          // zone: null,
          location: locations.length > 0 ? locations[0].id : null,
          zone: zones.length > 0 ? zones[0].id : null,
          port: camera["Port"] || "554",
          manufacture: camera["Manufacturer"] || "N/A",
          brand: camera["Brand"] || "N/A",
          nvrId: data.id,
        },
      }));
    } else {
      setSelectedCameras((prev) => {
        const updated = { ...prev };
        delete updated[key];
        return updated;
      });
    }
  };

  const handleFieldChange = (key, field, value) => {
    setSelectedCameras((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  };

  // const submitCameras = async () => {
  //   for (const key in selectedCameras) {
  //     const cam = selectedCameras[key];
  //     if (!cam.camera_name || !cam.location || !cam.zone) {
  //       return message.warning("Camera Name, Location, and Zone are required!");
  //     }
  //   }

  //   setLoading(true);
  //   try {
  //     for (const key in selectedCameras) {
  //       const cam = selectedCameras[key];
  //       await deviceApi.post(`/Camera/`, {
  //         name: cam.camera_name,
  //         cameraIP: cam["Camera Name"] || "N/A",
  //         nvrId: cam.nvrId,
  //         zone: cam.zone,
  //         location: cam.location,
  //         rtspurl: cam["Stream URI"],
  //         port: cam.port,
  //         brand: cam.brand,
  //         manufacture: cam.manufacture,
  //         hotspot: cam["GroupId"] || 5,
  //         macAddress: cam["Mac Address"] || "N/A",
  //         channelId: cam["Channel"] || 101,
  //         latitude: cam["Latitude"] || 21.14,
  //         longitude: cam["Longitude"] || 79.08,
  //         isRecording: 0,
  //         isStreaming: 0,
  //         userid: String(userId),
  //         creditId: "67890",
  //       });
  //     }
  //     message.success("Selected cameras added successfully!");
  //     setSelectedCameras({});
  //     // fetchCameraDetails();
  //   } catch (err) {
  //     console.error(err);
  //     message.error("Failed to add cameras!");
  //   } finally {
  //     setLoading(false);
  //     navigate('/devices/cameras');
  //   }
  // };

  const submitCameras = async () => {
    // validation
    for (const key in selectedCameras) {
      const cam = selectedCameras[key];
      if (!cam.camera_name || !cam.location || !cam.zone) {
        return message.warning("Camera Name, Location, and Zone are required!");
      }
    }

    setLoading(true);

    try {
      const nvrType = (data.nvrtype || "").toLowerCase();
      let nvrUser = 'admin';
      let nvrPass = '';
      if (nvrType.includes('cp')) {
        nvrPass = 'admin123';
      } else if (nvrType.includes('prama')) {
        nvrPass = 'Central@0001';
      }

      const payloads = Object.values(selectedCameras).map((cam) => {
        let finalRtsp = cam["Stream URI"] || "";
        // Inject credentials into RTSP URL for streaming server authentication ONLY if not already present
        if (finalRtsp.startsWith("rtsp://") && nvrPass) {
          const withoutScheme = finalRtsp.substring(7);
          const firstSlashIdx = withoutScheme.indexOf('/');
          const hostPart = firstSlashIdx !== -1 ? withoutScheme.substring(0, firstSlashIdx) : withoutScheme;

          // If there is no '@' in the host part, it means no credentials exist
          if (!hostPart.includes('@')) {
            finalRtsp = finalRtsp.replace("rtsp://", `rtsp://${encodeURIComponent(nvrUser)}:${encodeURIComponent(nvrPass)}@`);
          }
        }

        return {
          name: cam.camera_name,
          cameraIP: cam["Camera Name"] || "N/A",
          nvrId: cam.nvrId,
          zone_id: cam.zone,
          location: cam.location,
          rtspurl: finalRtsp,
          port: cam.port,
          brand: cam.brand,
          manufacture: cam.manufacture,
          hotspot: cam["GroupId"] || 5,
          macAddress: cam["Mac Address"] || "N/A",
          channelId: cam["Channel"] || 101,
          latitude: cam["Latitude"] || 21.14,
          longitude: cam["Longitude"] || 79.08,
          isRecording: 0,
          isStreaming: 0,
          userid: String(userId),
          creditId: "67890",
        };
      });


      // ? submit ALL cameras properly
      await Promise.all(
        payloads.map((payload) =>
          deviceApi.post(`/Camera/`, payload)
        )
      );

      message.success("Selected cameras added successfully!");
      setSelectedCameras({});
    } catch (err) {
      console.error(err);
      message.error("Failed to add cameras!");
    } finally {
      setLoading(false);
      navigate("/devices/cameras"); // ? navigate AFTER all c     alls finish
    }
  };

  const columns = [
    {
      title: "Select",
      render: (_, record) => {
        const alreadyAdded = addCameraData.some(c => c.rtspurl === record["Stream URI"]);
        return (
          <Checkbox
            disabled={alreadyAdded}
            checked={!!selectedCameras[record["Stream URI"]]}
            onChange={(e) => handleCheckboxChange(record, e.target.checked)}
          />
        );
      },
    },
    { title: "Camera Name (ONVIF)", dataIndex: "Camera Name" },

    {
      title: "Location",
      render: (_, record) => {
        const selected = selectedCameras[record["Stream URI"]];
        return selected ? (
          <Select
            placeholder="Select Location"
            value={selected.location}
            onChange={(val) => handleFieldChange(record["Stream URI"], "location", val)}
            style={{ width: 150 }}
          >
            {locations.map((loc) => (
              <Option key={loc.id} value={loc.id}>{loc.name}</Option>
            ))}
          </Select>
        ) : null;
      },
    },
    {
      title: "Zone",
      render: (_, record) => {
        const selected = selectedCameras[record["Stream URI"]];
        return selected ? (
          <Select
            placeholder="Select Zone"
            value={selected.zone}
            onChange={(val) => handleFieldChange(record["Stream URI"], "zone", val)}
            style={{ width: 150 }}
          >
            {zones.map((z) => (
              <Option key={z.id} value={z.id}>{z.name}</Option>
            ))}
          </Select>
        ) : null;
      },
    },
  ];

  return (
    <div className="space-y-4">
      <Spin spinning={loading}>
        <Table
          rowKey={(record) => record["Stream URI"]}
          columns={columns}
          dataSource={cameraData}
          pagination={false}
          bordered
        />
      </Spin>

      {Object.keys(selectedCameras).length > 0 && (
        <Button
          type="primary"
          className="bg-purple-600 hover:bg-purple-700"
          onClick={submitCameras}
        >
          Add Selected Cameras
        </Button>
      )}
    </div>
  );
};

export default Expand;



//////


// import React, { useEffect, useState } from "react";
// import { Table, Checkbox, Button, Spin, message, Input, Select, Tooltip } from "antd";
// import Cookies from "js-cookie";
// import { deviceApi } from "../../../../utils/axiosInstance";
// import axios from "axios";
// import {ONVIF_API_URL} from "../../../../config";
// import { useNavigate } from "react-router-dom";
// const { Option } = Select;

// const Expand = ({ data }) => {
//   const userId = Cookies.get("userId");
//   const navigate = useNavigate();
//   const [cameraData, setCameraData] = useState([]);
//   const [addCameraData, setAddCameraData] = useState([]);
//   const [locations, setLocations] = useState([]);
//   const [zones, setZones] = useState([]);
//   const [selectedCameras, setSelectedCameras] = useState({});
//   const [loading, setLoading] = useState(false);

//   useEffect(() => {
//     fetchCameraDetails();
//     fetchLocations();
//     fetchZones();
//   }, []);

//   const fetchCameraDetails = async () => {
//     setLoading(true);
//     try {
//       const added = await deviceApi.get(`/Camera/?user_id=${userId}`);
//       setAddCameraData(added.data.results || []);

//       const onvif = await axios.post(`${ONVIF_API_URL}/get_camera_details`, {
//         cameras: [{ nvr_ip: data.nvrip, username: data.username, password: data.password, nvr_port: parseInt(data.port, 10) }],
//       });

//       if (onvif.data?.[data.nvrip]?.error) {
//         message.error(onvif.data[data.nvrip].error);
//         setCameraData([]);
//       } else {
//         setCameraData(onvif.data[data.nvrip] || []);
//       }
//     } catch (err) {
//       console.error(err);
//       message.error("Failed to fetch ONVIF cameras!");
//     } finally {
//       setLoading(false);
//     }
//   };


//   const fetchLocations = async () => {
//   try {
//     let url = `/Location/`;
//     let all = [];

//     while (url) {
//       const res = await deviceApi.get(url);
//       all = [...all, ...res.data.results];
//       url = res.data.next;
//     }

//     setLocations(all);
//   } catch {
//     message.error("Failed to load locations");
//   }
// };


//   // const fetchLocations = async () => {
//   //   try {
//   //     const res = await deviceApi.get(`/Location/`);
//   //     setLocations(res.data.results || []);
//   //   } catch {
//   //     message.error("Failed to load locations");
//   //   }
//   // };

// const fetchZones = async () => {
//   try {
//     let url = `/Zone/`;
//     let allZones = [];

//     while (url) {
//       const res = await deviceApi.get(url);
//       allZones.push(...res.data.results);
//       url = res.data.next;
//     }

//     setZones(allZones);
//   } catch {
//     message.error("Failed to load zones");
//   }
// };

//   // const fetchZones = async () => {
//   //   try {
//   //     const res = await deviceApi.get(`/Zone/`);
//   //     setZones(res.data.results || []);
//   //   } catch {
//   //     message.error("Failed to load zones");
//   //   }
//   // };

//   const handleCheckboxChange = (camera, checked) => {
//     const key = camera["Stream URI"];
//     if (checked) {
//       setSelectedCameras((prev) => ({
//         ...prev,
//         [key]: {
//           ...camera,
//           camera_name: camera["Camera Name"] || "",
//           // location: null,
//           // zone: null,
//           location: locations.length > 0 ? locations[0].id : null,
//         zone: zones.length > 0 ? zones[0].id : null,
//           port: camera["Port"] || "554",
//           manufacture: camera["Manufacturer"] || "N/A",
//           brand: camera["Brand"] || "N/A",
//           nvrId: data.id,
//         },
//       }));
//     } else {
//       setSelectedCameras((prev) => {
//         const updated = { ...prev };
//         delete updated[key];
//         return updated;
//       });
//     }
//   };

//   const handleFieldChange = (key, field, value) => {
//     setSelectedCameras((prev) => ({
//       ...prev,
//       [key]: { ...prev[key], [field]: value },
//     }));
//   };

//   // const submitCameras = async () => {
//   //   for (const key in selectedCameras) {
//   //     const cam = selectedCameras[key];
//   //     if (!cam.camera_name || !cam.location || !cam.zone) {
//   //       return message.warning("Camera Name, Location, and Zone are required!");
//   //     }
//   //   }

//   //   setLoading(true);
//   //   try {
//   //     for (const key in selectedCameras) {
//   //       const cam = selectedCameras[key];
//   //       await deviceApi.post(`/Camera/`, {
//   //         name: cam.camera_name,
//   //         cameraIP: cam["Camera Name"] || "N/A",
//   //         nvrId: cam.nvrId,
//   //         zone: cam.zone,
//   //         location: cam.location,
//   //         rtspurl: cam["Stream URI"],
//   //         port: cam.port,
//   //         brand: cam.brand,
//   //         manufacture: cam.manufacture,
//   //         hotspot: cam["GroupId"] || 5,
//   //         macAddress: cam["Mac Address"] || "N/A",
//   //         channelId: cam["Channel"] || 101,
//   //         latitude: cam["Latitude"] || 21.14,
//   //         longitude: cam["Longitude"] || 79.08,
//   //         isRecording: 0,
//   //         isStreaming: 0,
//   //         userid: String(userId),
//   //         creditId: "67890",
//   //       });
//   //     }
//   //     message.success("Selected cameras added successfully!");
//   //     setSelectedCameras({});
//   //     // fetchCameraDetails();
//   //   } catch (err) {
//   //     console.error(err);
//   //     message.error("Failed to add cameras!");
//   //   } finally {
//   //     setLoading(false);
//   //     navigate('/devices/cameras');
//   //   }
//   // };

// const submitCameras = async () => {
//   // validation
//   for (const key in selectedCameras) {
//     const cam = selectedCameras[key];
//     if (!cam.camera_name || !cam.location || !cam.zone) {
//       return message.warning("Camera Name, Location, and Zone are required!");
//     }
//   }

//   setLoading(true);

//   try {
//     const payloads = Object.values(selectedCameras).map((cam) => ({
//       name: cam.camera_name,
//       cameraIP: cam["Camera Name"] || "N/A",
//       nvrId: cam.nvrId,
//       zone: cam.zone,
//       location: cam.location,
//       rtspurl: cam["Stream URI"],
//       port: cam.port,
//       brand: cam.brand,
//       manufacture: cam.manufacture,
//       hotspot: cam["GroupId"] || 5,
//       macAddress: cam["Mac Address"] || "N/A",
//       channelId: cam["Channel"] || 101,
//       latitude: cam["Latitude"] || 21.14,
//       longitude: cam["Longitude"] || 79.08,
//       isRecording: 0,
//       isStreaming: 0,
//       userid: String(userId),
//       creditId: "67890",
//     }));


//     // ? submit ALL cameras properly
//     await Promise.all(
//       payloads.map((payload) =>
//         deviceApi.post(`/Camera/`, payload)
//       )
//     );

//     message.success("Selected cameras added successfully!");
//     setSelectedCameras({});
//   } catch (err) {
//     console.error(err);
//     message.error("Failed to add cameras!");
//   } finally {
//     setLoading(false);
//     navigate("/devices/cameras"); // ? navigate AFTER all c     alls finish
//   }
// };

//   const columns = [
//     {
//       title: "Select",
//       render: (_, record) => {
//         const alreadyAdded = addCameraData.some(c => c.rtspurl === record["Stream URI"]);
//         return (
//           <Checkbox
//             disabled={alreadyAdded}
//             checked={!!selectedCameras[record["Stream URI"]]}
//             onChange={(e) => handleCheckboxChange(record, e.target.checked)}
//           />
//         );
//       },
//     },
//     { title: "Camera Name (ONVIF)", dataIndex: "Camera Name" },
//     {
//       title: "Custom Camera Name",
//       render: (_, record) => {
//         const selected = selectedCameras[record["Stream URI"]];
//         return selected ? (
//           <Input
//             placeholder="Enter camera name"
//             value={selected.camera_name}
//             onChange={(e) => handleFieldChange(record["Stream URI"], "camera_name", e.target.value)}
//           />
//         ) : null;
//       },
//     },
//     {
//       title: "Location",
//       render: (_, record) => {
//         const selected = selectedCameras[record["Stream URI"]];
//         return selected ? (
//           <Select
//             placeholder="Select Location"
//             value={selected.location}
//             onChange={(val) => handleFieldChange(record["Stream URI"], "location", val)}
//             style={{ width: 150 }}
//           >
//             {locations.map((loc) => (
//               <Option key={loc.id} value={loc.id}>{loc.name}</Option>
//             ))}
//           </Select>
//         ) : null;
//       },
//     },
//     {
//       title: "Zone",
//       render: (_, record) => {
//         const selected = selectedCameras[record["Stream URI"]];
//         return selected ? (
//           <Select
//             placeholder="Select Zone"
//             value={selected.zone}
//             onChange={(val) => handleFieldChange(record["Stream URI"], "zone", val)}
//             style={{ width: 150 }}
//           >
//             {zones.map((z) => (
//               <Option key={z.id} value={z.id}>{z.name}</Option>
//             ))}
//           </Select>
//         ) : null;
//       },
//     },
//   ];

//   return (
//     <div className="space-y-4">
//       <Spin spinning={loading}>
//         <Table
//           rowKey={(record) => record["Stream URI"]}
//           columns={columns}
//           dataSource={cameraData}
//           pagination={false}
//           bordered
//         />
//       </Spin>

//       {Object.keys(selectedCameras).length > 0 && (
//         <Button
//           type="primary"
//           className="bg-purple-600 hover:bg-purple-700"
//           onClick={submitCameras}
//         >
//           Add Selected Cameras
//         </Button>
//       )}
//     </div>
//   );
// };

// export default Expand;




////////////////////////

// import React, { useEffect, useState } from "react";
// import { Table, Checkbox, Button, Spin, message, Input, Select, Tooltip } from "antd";
// import Cookies from "js-cookie";
// import { deviceApi } from "../../../../utils/axiosInstance";
// import axios from "axios";
// import {ONVIF_API_URL} from "../../../../config";
// import { useNavigate } from "react-router-dom";
// const { Option } = Select;

// const Expand = ({ data }) => {
//   const userId = Cookies.get("userId");
//   const navigate = useNavigate();
//   const [cameraData, setCameraData] = useState([]);
//   const [addCameraData, setAddCameraData] = useState([]);
//   const [locations, setLocations] = useState([]);
//   const [zones, setZones] = useState([]);
//   const [selectedCameras, setSelectedCameras] = useState({});
//   const [loading, setLoading] = useState(false);

//   useEffect(() => {
//     fetchCameraDetails();
//     fetchLocations();
//     fetchZones();
//   }, []);

//   const fetchCameraDetails = async () => {
//     setLoading(true);
//     try {
//       const added = await deviceApi.get(`/Camera/?user_id=${userId}`);
//       setAddCameraData(added.data.results || []);

//       const onvif = await axios.post(`${ONVIF_API_URL}/get_camera_details`, {
//         cameras: [{ nvr_ip: data.nvrip, username: data.username, password: data.password, nvr_port: parseInt(data.port, 10) }],
//       });

//       if (onvif.data?.[data.nvrip]?.error) {
//         message.error(onvif.data[data.nvrip].error);
//         setCameraData([]);
//       } else {
//         setCameraData(onvif.data[data.nvrip] || []);
//       }
//     } catch (err) {
//       console.error(err);
//       message.error("Failed to fetch ONVIF cameras!");
//     } finally {
//       setLoading(false);
//     }
//   };

//   const fetchLocations = async () => {
//     try {
//       const res = await deviceApi.get(`/Location/?user_id=${userId}`);
//       setLocations(res.data.results || []);
//     } catch {
//       message.error("Failed to load locations");
//     }
//   };

//   const fetchZones = async () => {
//     try {
//       const res = await deviceApi.get(`/Zone/?user_id=${userId}`);
//       setZones(res.data.results || []);
//     } catch {
//       message.error("Failed to load zones");
//     }
//   };

//   const handleCheckboxChange = (camera, checked) => {
//     const key = camera["Stream URI"];
//     if (checked) {
//       setSelectedCameras((prev) => ({
//         ...prev,
//         [key]: {
//           ...camera,
//           camera_name: camera["Camera Name"] || "",
//           location: null,
//           zone: null,
//           port: camera["Port"] || "554",
//           manufacture: camera["Manufacturer"] || "N/A",
//           brand: camera["Brand"] || "N/A",
//           nvrId: data.id,
//         },
//       }));
//     } else {
//       setSelectedCameras((prev) => {
//         const updated = { ...prev };
//         delete updated[key];
//         return updated;
//       });
//     }
//   };

//   const handleFieldChange = (key, field, value) => {
//     setSelectedCameras((prev) => ({
//       ...prev,
//       [key]: { ...prev[key], [field]: value },
//     }));
//   };

//   const submitCameras = async () => {
//     for (const key in selectedCameras) {
//       const cam = selectedCameras[key];
//       if (!cam.camera_name || !cam.location || !cam.zone) {
//         return message.warning("Camera Name, Location, and Zone are required!");
//       }
//     }

//     setLoading(true);
//     try {
//       for (const key in selectedCameras) {
//         const cam = selectedCameras[key];
//         await deviceApi.post(`/Camera/`, {
//           name: cam.camera_name,
//           cameraIP: cam["Camera Name"] || "N/A",
//           nvrId: cam.nvrId,
//           zone: cam.zone,
//           location: cam.location,
//           rtspurl: cam["Stream URI"],
//           port: cam.port,
//           brand: cam.brand,
//           manufacture: cam.manufacture,
//           hotspot: cam["GroupId"] || 5,
//           macAddress: cam["Mac Address"] || "N/A",
//           channelId: cam["Channel"] || 101,
//           latitude: cam["Latitude"] || 21.14,
//           longitude: cam["Longitude"] || 79.08,
//           isRecording: 0,
//           isStreaming: 0,
//           userid: String(userId),
//           creditId: "67890",
//         });
//       }
//       message.success("Selected cameras added successfully!");
//       setSelectedCameras({});
//       // fetchCameraDetails();
//     } catch (err) {
//       console.error(err);
//       message.error("Failed to add cameras!");
//     } finally {
//       setLoading(false);
//       navigate('/devices/cameras');
//     }
//   };

//   const columns = [
//     {
//       title: "Select",
//       render: (_, record) => {
//         const alreadyAdded = addCameraData.some(c => c.rtspurl === record["Stream URI"]);
//         return (
//           <Checkbox
//             disabled={alreadyAdded}
//             checked={!!selectedCameras[record["Stream URI"]]}
//             onChange={(e) => handleCheckboxChange(record, e.target.checked)}
//           />
//         );
//       },
//     },
//     { title: "Camera Name (ONVIF)", dataIndex: "Camera Name" },
//     {
//       title: "Custom Camera Name",
//       render: (_, record) => {
//         const selected = selectedCameras[record["Stream URI"]];
//         return selected ? (
//           <Input
//             placeholder="Enter camera name"
//             value={selected.camera_name}
//             onChange={(e) => handleFieldChange(record["Stream URI"], "camera_name", e.target.value)}
//           />
//         ) : null;
//       },
//     },
//     {
//       title: "Location",
//       render: (_, record) => {
//         const selected = selectedCameras[record["Stream URI"]];
//         return selected ? (
//           <Select
//             placeholder="Select Location"
//             value={selected.location}
//             onChange={(val) => handleFieldChange(record["Stream URI"], "location", val)}
//             style={{ width: 150 }}
//           >
//             {locations.map((loc) => (
//               <Option key={loc.id} value={loc.id}>{loc.name}</Option>
//             ))}
//           </Select>
//         ) : null;
//       },
//     },
//     {
//       title: "Zone",
//       render: (_, record) => {
//         const selected = selectedCameras[record["Stream URI"]];
//         return selected ? (
//           <Select
//             placeholder="Select Zone"
//             value={selected.zone}
//             onChange={(val) => handleFieldChange(record["Stream URI"], "zone", val)}
//             style={{ width: 150 }}
//           >
//             {zones.map((z) => (
//               <Option key={z.id} value={z.id}>{z.name}</Option>
//             ))}
//           </Select>
//         ) : null;
//       },
//     },
//   ];

//   return (
//     <div className="space-y-4">
//       <Spin spinning={loading}>
//         <Table
//           rowKey={(record) => record["Stream URI"]}
//           columns={columns}
//           dataSource={cameraData}
//           pagination={false}
//           bordered
//         />
//       </Spin>

//       {Object.keys(selectedCameras).length > 0 && (
//         <Button
//           type="primary"
//           className="bg-purple-600 hover:bg-purple-700"
//           onClick={submitCameras}
//         >
//           Add Selected Cameras
//         </Button>
//       )}
//     </div>
//   );
// };

// export default Expand;




////////////////////RRRRRRRRRRRRRRRRRRRRRRRR


// import React, { useEffect, useState } from "react";
// import { Table, Checkbox, Button, Spin, message, Input, Select, Tooltip } from "antd";
// import Cookies from "js-cookie";
// import { deviceApi } from "../../../../utils/axiosInstance";
// import axios from "axios";
// import {ONVIF_API_URL} from "../../../../config";
// import { useNavigate } from "react-router-dom";
// const { Option } = Select;

// const Expand = ({ data }) => {
//   const userId = Cookies.get("userId");
//   const navigate = useNavigate();
//   const [cameraData, setCameraData] = useState([]);
//   const [addCameraData, setAddCameraData] = useState([]);
//   const [locations, setLocations] = useState([]);
//   const [zones, setZones] = useState([]);
//   const [selectedCameras, setSelectedCameras] = useState({});
//   const [loading, setLoading] = useState(false);

//   useEffect(() => {
//     fetchCameraDetails();
//     fetchLocations();
//     fetchZones();
//   }, []);

//   const fetchCameraDetails = async () => {
//     setLoading(true);
//     try {
//       const added = await deviceApi.get(`/Camera/?user_id=${userId}`);
//       setAddCameraData(added.data.results || []);

//       const onvif = await axios.post(`${ONVIF_API_URL}/get_camera_details`, {
//         cameras: [{ nvr_ip: data.nvrip, username: data.username, password: data.password, nvr_port: parseInt(data.port, 10) }],
//       });

//       if (onvif.data?.[data.nvrip]?.error) {
//         message.error(onvif.data[data.nvrip].error);
//         setCameraData([]);
//       } else {
//         setCameraData(onvif.data[data.nvrip] || []);
//       }
//     } catch (err) {
//       console.error(err);
//       message.error("Failed to fetch ONVIF cameras!");
//     } finally {
//       setLoading(false);
//     }
//   };

//   const fetchLocations = async () => {
//     try {
//       const res = await deviceApi.get(`/Location/?user_id=${userId}`);
//       setLocations(res.data.results || []);
//     } catch {
//       message.error("Failed to load locations");
//     }
//   };

//   const fetchZones = async () => {
//     try {
//       const res = await deviceApi.get(`/Zone/?user_id=${userId}`);
//       setZones(res.data.results || []);
//     } catch {
//       message.error("Failed to load zones");
//     }
//   };

//   const handleCheckboxChange = (camera, checked) => {
//     const key = camera["Stream URI"];
//     if (checked) {
//       setSelectedCameras((prev) => ({
//         ...prev,
//         [key]: {
//           ...camera,
//           camera_name: camera["Camera Name"] || "",
//           location: null,
//           zone: null,
//           port: camera["Port"] || "554",
//           manufacture: camera["Manufacturer"] || "N/A",
//           brand: camera["Brand"] || "N/A",
//           nvrId: data.id,
//         },
//       }));
//     } else {
//       setSelectedCameras((prev) => {
//         const updated = { ...prev };
//         delete updated[key];
//         return updated;
//       });
//     }
//   };

//   const handleFieldChange = (key, field, value) => {
//     setSelectedCameras((prev) => ({
//       ...prev,
//       [key]: { ...prev[key], [field]: value },
//     }));
//   };

//   const submitCameras = async () => {
//     for (const key in selectedCameras) {
//       const cam = selectedCameras[key];
//       if (!cam.camera_name || !cam.location || !cam.zone) {
//         return message.warning("Camera Name, Location, and Zone are required!");
//       }
//     }

//     setLoading(true);
//     try {
//       for (const key in selectedCameras) {
//         const cam = selectedCameras[key];
//         await deviceApi.post(`/Camera/`, {
//           name: cam.camera_name,
//           cameraIP: cam["Camera Name"] || "N/A",
//           nvrId: cam.nvrId,
//           zone: cam.zone,
//           location: cam.location,
//           rtspurl: cam["Stream URI"],
//           port: cam.port,
//           brand: cam.brand,
//           manufacture: cam.manufacture,
//           hotspot: cam["GroupId"] || 5,
//           macAddress: cam["Mac Address"] || "N/A",
//           channelId: cam["Channel"] || 101,
//           latitude: cam["Latitude"] || 21.14,
//           longitude: cam["Longitude"] || 79.08,
//           isRecording: 0,
//           isStreaming: 1,
//           userid: String(userId),
//           creditId: "67890",
//         });
//       }
//       message.success("Selected cameras added successfully!");
//       setSelectedCameras({});
//       // fetchCameraDetails();
//     } catch (err) {
//       console.error(err);
//       message.error("Failed to add cameras!");
//     } finally {
//       setLoading(false);
//       navigate('/devices/cameras');
//     }
//   };

//   const columns = [
//     {
//       title: "Select",
//       render: (_, record) => {
//         const alreadyAdded = addCameraData.some(c => c.rtspurl === record["Stream URI"]);
//         return (
//           <Checkbox
//             disabled={alreadyAdded}
//             checked={!!selectedCameras[record["Stream URI"]]}
//             onChange={(e) => handleCheckboxChange(record, e.target.checked)}
//           />
//         );
//       },
//     },
//     { title: "Camera Name (ONVIF)", dataIndex: "Camera Name" },
//     {
//       title: "Custom Camera Name",
//       render: (_, record) => {
//         const selected = selectedCameras[record["Stream URI"]];
//         return selected ? (
//           <Input
//             placeholder="Enter camera name"
//             value={selected.camera_name}
//             onChange={(e) => handleFieldChange(record["Stream URI"], "camera_name", e.target.value)}
//           />
//         ) : null;
//       },
//     },
//     {
//       title: "Location",
//       render: (_, record) => {
//         const selected = selectedCameras[record["Stream URI"]];
//         return selected ? (
//           <Select
//             placeholder="Select Location"
//             value={selected.location}
//             onChange={(val) => handleFieldChange(record["Stream URI"], "location", val)}
//             style={{ width: 150 }}
//           >
//             {locations.map((loc) => (
//               <Option key={loc.id} value={loc.id}>{loc.name}</Option>
//             ))}
//           </Select>
//         ) : null;
//       },
//     },
//     {
//       title: "Zone",
//       render: (_, record) => {
//         const selected = selectedCameras[record["Stream URI"]];
//         return selected ? (
//           <Select
//             placeholder="Select Zone"
//             value={selected.zone}
//             onChange={(val) => handleFieldChange(record["Stream URI"], "zone", val)}
//             style={{ width: 150 }}
//           >
//             {zones.map((z) => (
//               <Option key={z.id} value={z.id}>{z.name}</Option>
//             ))}
//           </Select>
//         ) : null;
//       },
//     },
//   ];

//   return (
//     <div className="space-y-4">
//       <Spin spinning={loading}>
//         <Table
//           rowKey={(record) => record["Stream URI"]}
//           columns={columns}
//           dataSource={cameraData}
//           pagination={false}
//           bordered
//         />
//       </Spin>

//       {Object.keys(selectedCameras).length > 0 && (
//         <Button
//           type="primary"
//           className="bg-purple-600 hover:bg-purple-700"
//           onClick={submitCameras}
//         >
//           Add Selected Cameras
//         </Button>
//       )}
//     </div>
//   );
// };

// export default Expand;
