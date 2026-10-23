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
  Switch,
  Upload,
} from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { useNavigate, useLocation } from "react-router-dom";
import { deviceApi } from "../../../../utils/axiosInstance";
import Cookies from "js-cookie";
const { Option } = Select;

function NvrForm() {
  const [form] = Form.useForm();
  // const [loading, setLoading] = useState(false);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(false);

  const [zones, setZones] = useState([]);
  const navigate = useNavigate();
  const location = useLocation();

  const userId = Cookies.get("userId");
  const editingNvr = location.state?.nvr || null;

  // Fetch dropdown data
  // const fetchData = async () => {
  //   try {
  //     const zoneRes = await deviceApi.get("/zone");
  //     setZones(zoneRes.data || []);
  //     console.log(zoneRes.data, "zone data");
  //   } catch (err) {
  //     message.error("Failed to load dropdown data");
  //   }
  // };

  // const fetchData = async () => {
  //   try {
  //     const zoneRes = await deviceApi.get("/Zone/");
  //     setZones(zoneRes.data.results || []);
  //     // console.log(zoneRes.data.results, "zone data");
  //   } catch (err) {
  //     message.error("Failed to load dropdown data");
  //   }
  // };

  const fetchLocations = async () => {
    try {
      let url = `/Location/`;
      let all = [];

      while (url) {
        const res = await deviceApi.get(url);

        const results = res.data.results || res.data;
        all = [...all, ...results];

        url = res.data.next;
      }

      setLocations(all);
    } catch (err) {
      console.error(err);
      message.error("Failed to load locations");
    }
  };

  const fetchData = async () => {
    try {
      let url = "/Zone/";
      let allZones = [];

      while (url) {
        const res = await deviceApi.get(url);
        allZones.push(...res.data.results);
        url = res.data.next;
      }

      setZones(allZones);
    } catch (err) {
      message.error("Failed to load dropdown data");
    }
  };

  useEffect(() => {
    fetchData();
    fetchLocations();

    if (editingNvr) {
      form.setFieldsValue({
        name: editingNvr.name,
        username: editingNvr.username,
        password: editingNvr.password ? "********" : "",
        nvrip: editingNvr.nvrip,
        port: editingNvr.port || 80,
        nvrtype: editingNvr.nvrtype,
        model: editingNvr.model,
        make: editingNvr.make,
        location: editingNvr.location,
        zone_id: typeof editingNvr.zone === 'object' ? editingNvr.zone?.id : editingNvr.zone,
        responsible_Person: editingNvr.responsible_Person,
        status: editingNvr.status === 1,
        userid: String(userId),
      });
    } else {
      form.setFieldsValue({ port: 80, status: true });
    }
  }, [editingNvr]);

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const payload = {
        ...values,
        zone: values.zone_id, // Map zone_id back to zone for the backend
        status: values.status ? 1 : 0,
        userid: String(userId),
      };

      if (editingNvr && values.password === "********") {
        delete payload.password; // keep old password
      }

      if (editingNvr) {
        await deviceApi.put(`/NVR/${editingNvr.id}/`, payload);
        message.success("NVR updated successfully!");
      } else {
        await deviceApi.post("/NVR/", payload);
        message.success("NVR created successfully!");
      }
      navigate("/devices/nvrs");
    } catch (err) {
      console.error("NVR Submit Error:", err.response?.data || err);
      message.error(err.response?.data?.detail || err.response?.data?.message || "Operation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="m-4 shadow-md">
      <div className="mb-4 bg-[#9864DB] text-white px-6 py-2 rounded-md flex justify-between items-center">
        <h3 className="text-xl font-semibold">
          {editingNvr ? "✏️ Edit NVR" : "➕ Add NVR"}
        </h3>
        <Button
          onClick={() => navigate("/devices/nvrs")}
          style={{
            background: "#9864DB",
            color: "white",
            borderColor: "#9864DB",
          }}
        >
          📋 NVR Details
        </Button>
      </div>
      <Spin spinning={loading}>
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          initialValues={{ port: 80, status: true }}
        >
          {/* Row 1 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="NVR Name"
                name="name"
                rules={[{ required: true, message: "NVR Name is required" }]}
              >
                <Input placeholder="Enter NVR name" />
              </Form.Item>
            </Col>

            <Col span={12}>
              <Form.Item
                label="Username"
                name="username"
                rules={[{ required: true, message: "Username is required" }]}
              >
                <Input placeholder="Enter NVR username" />
              </Form.Item>
            </Col>
          </Row>

          {/* Row 2 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="Password"
                name="password"
                rules={
                  editingNvr
                    ? [] // optional on edit
                    : [{ required: true, message: "Password is required" }]
                }
              >
                <Input.Password
                  placeholder={
                    editingNvr
                      ? "Leave blank to keep current"
                      : "Enter NVR password"
                  }
                />
              </Form.Item>
            </Col>

            <Col span={12}>
              <Form.Item
                label="NVR IP"
                name="nvrip"
                rules={[{ required: true, message: "NVR IP is required" }]}
              >
                <Input placeholder="e.g., x.x.x.x" />
              </Form.Item>
            </Col>
          </Row>

          {/* Row 3 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="HTTP Port"
                name="port"
                rules={[{ required: true, message: "HTTP Port is required" }]}
              >
                <InputNumber min={1} max={65535} style={{ width: "100%" }} />
              </Form.Item>
            </Col>

            <Col span={12}>
              {/* <Form.Item
                label="Location"
                name="location"
                rules={[{ required: true, message: "Please enter location" }]}
              >
                <Input placeholder="Enter location" />
              </Form.Item> */}

              <Form.Item
                label="Location"
                name="location"
                rules={[{ required: true, message: "Please select location" }]}
              >
                <Select placeholder="Select location">
                  {locations.map((l) => (
                    <Option key={l.id} value={l.name}>
                      {l.name}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          {/* Row 4 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="Region"
                name="zone_id"
                rules={[{ required: true, message: "Please select a zone" }]}
              >
                {/* <Select placeholder="Select zone">
                  {zones.map((z) => (
                    <Option key={z.id} value={z.id}>
                      {z.name}
                    </Option>
                  ))}
                </Select> */}
                <Select placeholder="Select zone">
                  {zones.map((z) => (
                    <Option key={z.id} value={z.id}>
                      {z.name}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>

            <Col span={12}>
              <Form.Item 
                label="NVR Type" 
                name="nvrtype"
                rules={[{ required: true, message: "NVR Type is required" }]}
              >
                <Input placeholder="Enter NVR type (e.g., CP Plus)" />
              </Form.Item>
            </Col>
          </Row>

          {/* Row 5 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Model" name="model">
                <Input placeholder="Optional" />
              </Form.Item>
            </Col>

            <Col span={12}>
              <Form.Item label="Make" name="make">
                <Input placeholder="Optional" />
              </Form.Item>
            </Col>
          </Row>

          {/* Row 6 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Responsible Person" name="responsible_Person">
                <Input placeholder="Optional" />
              </Form.Item>
            </Col>

            <Col span={12}>
              <Form.Item label="Status" name="status" valuePropName="checked">
                <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
              </Form.Item>
            </Col>
          </Row>

          {/* Row 7 - Upload */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Upload Image" name="img">
                <Upload beforeUpload={() => false} maxCount={1}>
                  <Button
                    icon={<UploadOutlined />}
                    style={{ borderColor: "#522EA8", color: "#522EA8" }}
                  >
                    Click to Upload
                  </Button>
                </Upload>
              </Form.Item>
            </Col>
          </Row>

          {/* Actions */}
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              style={{ background: "#9864DB", borderColor: "#9864DB" }}
            >
              {editingNvr ? "Update NVR" : "Create NVR"}
            </Button>
            <Button
              className="ml-2"
              onClick={() => navigate("/devices/nvrs")}
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

export default NvrForm;




//////////////

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
//   Switch,
//   Upload,
// } from "antd";
// import { UploadOutlined } from "@ant-design/icons";
// import { useNavigate, useLocation } from "react-router-dom";
// import { deviceApi } from "../../../../utils/axiosInstance";
// import Cookies from "js-cookie";
// const { Option } = Select;

// // const zones = [
// //   { id: 1, name: "North Zone" },
// //   { id: 2, name: "South Zone" },
// //   { id: 3, name: "East Zone" },
// //   { id: 4, name: "West Zone" },
// // ];

// function NvrForm() {
//   const [form] = Form.useForm();
//   // const [loading, setLoading] = useState(false);
//   const [locations, setLocations] = useState([]);
//   const [loading, setLoading] = useState(false);

//   const [zones, setZones] = useState([]);
//   const navigate = useNavigate();
//   const location = useLocation();

//   const userId = Cookies.get("userId");
//   const editingNvr = location.state?.nvr || null;

//   // Fetch dropdown data
//   // const fetchData = async () => {
//   //   try {
//   //     const zoneRes = await deviceApi.get("/zone");
//   //     setZones(zoneRes.data || []);
//   //     console.log(zoneRes.data, "zone data");
//   //   } catch (err) {
//   //     message.error("Failed to load dropdown data");
//   //   }
//   // };

//   // const fetchData = async () => {
//   //   try {
//   //     const zoneRes = await deviceApi.get("/Zone/");
//   //     setZones(zoneRes.data.results || []);
//   //     // console.log(zoneRes.data.results, "zone data");
//   //   } catch (err) {
//   //     message.error("Failed to load dropdown data");
//   //   }
//   // };

//   const fetchLocations = async () => {
//     try {
//       let url = `/Location/`;
//       let all = [];

//       while (url) {
//         const res = await deviceApi.get(url);

//         const results = res.data.results || res.data;
//         all = [...all, ...results];

//         url = res.data.next;
//       }

//       setLocations(all);
//     } catch (err) {
//       console.error(err);
//       message.error("Failed to load locations");
//     }
//   };

//   const fetchData = async () => {
//     try {
//       let url = "/Zone/";
//       let allZones = [];

//       while (url) {
//         const res = await deviceApi.get(url);
//         allZones.push(...res.data.results);
//         url = res.data.next;
//       }

//       setZones(allZones);
//     } catch (err) {
//       message.error("Failed to load dropdown data");
//     }
//   };

//   useEffect(() => {
//     fetchData();
//     fetchLocations();

//     if (editingNvr) {
//       form.setFieldsValue({
//         name: editingNvr.name,
//         username: editingNvr.username,
//         password: editingNvr.password ? "********" : "",
//         nvrip: editingNvr.nvrip,
//         port: editingNvr.port || 80,
//         nvrtype: editingNvr.nvrtype,
//         model: editingNvr.model,
//         make: editingNvr.make,
//         location: editingNvr.location,
//         // zone: editingNvr.zone,
//         zone: editingNvr.zone?.id,
//         responsible_Person: editingNvr.responsible_Person,
//         status: editingNvr.status === 1,
//         userid: String(userId),
//       });
//     } else {
//       form.setFieldsValue({ port: 80, status: true });
//     }
//   }, [editingNvr]);

//   const onFinish = async (values) => {
//     setLoading(true);
//     try {
//       const payload = {
//         ...values,
//         status: values.status ? 1 : 0,
//         userid: String(userId),
//       };

//       if (editingNvr && values.password === "********") {
//         delete payload.password; // keep old password
//       }

//       if (editingNvr) {
//         await deviceApi.put(`/NVR/${editingNvr.id}/`, payload);
//         message.success("NVR updated successfully!");
//       } else {
//         await deviceApi.post("/NVR/", payload);
//         message.success("NVR created successfully!");
//       }
//       navigate("/devices/nvrs");
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
//           {editingNvr ? "✏️ Edit NVR" : "➕ Add NVR"}
//         </h3>
//         <Button
//           onClick={() => navigate("/devices/nvrs")}
//           style={{
//             background: "#9864DB",
//             color: "white",
//             borderColor: "#9864DB",
//           }}
//         >
//           📋 NVR Details
//         </Button>
//       </div>
//       <Spin spinning={loading}>
//         <Form
//           form={form}
//           layout="vertical"
//           onFinish={onFinish}
//           initialValues={{ port: 80, status: true }}
//         >
//           {/* Row 1 */}
//           <Row gutter={16}>
//             <Col span={12}>
//               <Form.Item
//                 label="NVR Name"
//                 name="name"
//                 rules={[{ required: true, message: "NVR Name is required" }]}
//               >
//                 <Input placeholder="Enter NVR name" />
//               </Form.Item>
//             </Col>

//             <Col span={12}>
//               <Form.Item
//                 label="Username"
//                 name="username"
//                 rules={[{ required: true, message: "Username is required" }]}
//               >
//                 <Input placeholder="Enter NVR username" />
//               </Form.Item>
//             </Col>
//           </Row>

//           {/* Row 2 */}
//           <Row gutter={16}>
//             <Col span={12}>
//               <Form.Item
//                 label="Password"
//                 name="password"
//                 rules={
//                   editingNvr
//                     ? [] // optional on edit
//                     : [{ required: true, message: "Password is required" }]
//                 }
//               >
//                 <Input.Password
//                   placeholder={
//                     editingNvr
//                       ? "Leave blank to keep current"
//                       : "Enter NVR password"
//                   }
//                 />
//               </Form.Item>
//             </Col>

//             <Col span={12}>
//               <Form.Item
//                 label="NVR IP"
//                 name="nvrip"
//                 rules={[{ required: true, message: "NVR IP is required" }]}
//               >
//                 <Input placeholder="e.g., 10.0.0.1" />
//               </Form.Item>
//             </Col>
//           </Row>

//           {/* Row 3 */}
//           <Row gutter={16}>
//             <Col span={12}>
//               <Form.Item
//                 label="HTTP Port"
//                 name="port"
//                 rules={[{ required: true, message: "HTTP Port is required" }]}
//               >
//                 <InputNumber min={1} max={65535} style={{ width: "100%" }} />
//               </Form.Item>
//             </Col>

//             <Col span={12}>
//               {/* <Form.Item
//                 label="Location"
//                 name="location"
//                 rules={[{ required: true, message: "Please enter location" }]}
//               >
//                 <Input placeholder="Enter location" />
//               </Form.Item> */}

//               <Form.Item
//                 label="Location"
//                 name="location"
//                 rules={[{ required: true, message: "Please select location" }]}
//               >
//                 <Select placeholder="Select location">
//                   {locations.map((l) => (
//                     <Option key={l.id} value={l.name}>
//                       {l.name}
//                     </Option>
//                   ))}
//                 </Select>
//               </Form.Item>
//             </Col>
//           </Row>

//           {/* Row 4 */}
//           <Row gutter={16}>
//             <Col span={12}>
//               <Form.Item
//                 label="Region"
//                 name="zone"
//                 rules={[{ required: true, message: "Please select a zone" }]}
//               >
//                 {/* <Select placeholder="Select zone">
//                   {zones.map((z) => (
//                     <Option key={z.id} value={z.id}>
//                       {z.name}
//                     </Option>
//                   ))}
//                 </Select> */}
//                 <Select placeholder="Select zone">
//                   {zones.map((z) => (
//                     <Option key={z.id} value={z.id}>
//                       {z.name}
//                     </Option>
//                   ))}
//                 </Select>
//               </Form.Item>
//             </Col>

//             <Col span={12}>
//               <Form.Item label="NVR Type" name="nvrtype">
//                 <Input placeholder="Optional" />
//               </Form.Item>
//             </Col>
//           </Row>

//           {/* Row 5 */}
//           <Row gutter={16}>
//             <Col span={12}>
//               <Form.Item label="Model" name="model">
//                 <Input placeholder="Optional" />
//               </Form.Item>
//             </Col>

//             <Col span={12}>
//               <Form.Item label="Make" name="make">
//                 <Input placeholder="Optional" />
//               </Form.Item>
//             </Col>
//           </Row>

//           {/* Row 6 */}
//           <Row gutter={16}>
//             <Col span={12}>
//               <Form.Item label="Responsible Person" name="responsible_Person">
//                 <Input placeholder="Optional" />
//               </Form.Item>
//             </Col>

//             <Col span={12}>
//               <Form.Item label="Status" name="status" valuePropName="checked">
//                 <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
//               </Form.Item>
//             </Col>
//           </Row>

//           {/* Row 7 - Upload */}
//           <Row gutter={16}>
//             <Col span={12}>
//               <Form.Item label="Upload Image" name="img">
//                 <Upload beforeUpload={() => false} maxCount={1}>
//                   <Button
//                     icon={<UploadOutlined />}
//                     style={{ borderColor: "#522EA8", color: "#522EA8" }}
//                   >
//                     Click to Upload
//                   </Button>
//                 </Upload>
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
//               {editingNvr ? "Update NVR" : "Create NVR"}
//             </Button>
//             <Button
//               className="ml-2"
//               onClick={() => navigate("/devices/nvrs")}
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

// export default NvrForm;



/////////////////////////////////

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
//   Switch,
//   Upload,
// } from "antd";
// import { UploadOutlined } from "@ant-design/icons";
// import { useNavigate, useLocation } from "react-router-dom";
// import { deviceApi } from "../../../../utils/axiosInstance";
// import Cookies from "js-cookie";
// const { Option } = Select;
// const zones = [
//   { id: 1, name: "North Zone" },
//   { id: 2, name: "South Zone" },
//   { id: 3, name: "East Zone" },
//   { id: 4, name: "West Zone" },
// ];

// function NvrForm() {
//   const [form] = Form.useForm();
//   const [loading, setLoading] = useState(false);
//   // const [zones, setZones] = useState([]);
//   const navigate = useNavigate();
//   const location = useLocation();

//   const userId = Cookies.get("userId");
//   const editingNvr = location.state?.nvr || null;

//   // Fetch dropdown data
//   const fetchData = async () => {
//     try {
//       const zoneRes = await deviceApi.get("/zone");
//       setZones(zoneRes.data || []);
//       console.log(zoneRes, "zone data");
//     } catch (err) {
//       message.error("Failed to load dropdown data");
//     }
//   };

//   useEffect(() => {
//     fetchData();
//     if (editingNvr) {
//       form.setFieldsValue({
//         name: editingNvr.name,
//         username: editingNvr.username,
//         password: editingNvr.password ? "********" : "",
//         nvrip: editingNvr.nvrip,
//         port: editingNvr.port || 80,
//         nvrtype: editingNvr.nvrtype,
//         model: editingNvr.model,
//         make: editingNvr.make,
//         location: editingNvr.location,
//         zone: editingNvr.zone,
//         responsible_Person: editingNvr.responsible_Person,
//         status: editingNvr.status === 1,
//         userid: String(userId),
//       });
//     } else {
//       form.setFieldsValue({ port: 80, status: true });
//     }
//   }, [editingNvr]);

//   const onFinish = async (values) => {
//     setLoading(true);
//     try {
//       const payload = { ...values, status: values.status ? 1 : 0, userid: String(userId) };

//       if (editingNvr && values.password === "********") {
//         delete payload.password; // keep old password
//       }

//       if (editingNvr) {
//         await deviceApi.put(`/NVR/${editingNvr.id}/`, payload);
//         message.success("NVR updated successfully!");
//       } else {
//         await deviceApi.post("/NVR/", payload);
//         message.success("NVR created successfully!");
//       }
//       navigate("/devices/nvrs");
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
//           {editingNvr ? "✏️ Edit NVR" : "➕ Add NVR"}
//         </h3>
//         <Button
//           onClick={() => navigate("/devices/nvrs")}
//           style={{ background: "#9864DB", color: "white", borderColor: "#9864DB" }}
//         >
//           📋 NVR Details
//         </Button>
//       </div>
//       <Spin spinning={loading}>
//         <Form
//           form={form}
//           layout="vertical"
//           onFinish={onFinish}
//           initialValues={{ port: 80, status: true }}
//         >
//           {/* Row 1 */}
//           <Row gutter={16}>
//             <Col span={12}>
//               <Form.Item
//                 label="NVR Name"
//                 name="name"
//                 rules={[{ required: true, message: "NVR Name is required" }]}
//               >
//                 <Input placeholder="Enter NVR name" />
//               </Form.Item>
//             </Col>

//             <Col span={12}>
//               <Form.Item
//                 label="Username"
//                 name="username"
//                 rules={[{ required: true, message: "Username is required" }]}
//               >
//                 <Input placeholder="Enter NVR username" />
//               </Form.Item>
//             </Col>
//           </Row>

//           {/* Row 2 */}
//           <Row gutter={16}>
//             <Col span={12}>
//               <Form.Item
//                 label="Password"
//                 name="password"
//                 rules={
//                   editingNvr
//                     ? [] // optional on edit
//                     : [{ required: true, message: "Password is required" }]
//                 }
//               >
//                 <Input.Password
//                   placeholder={
//                     editingNvr
//                       ? "Leave blank to keep current"
//                       : "Enter NVR password"
//                   }
//                 />
//               </Form.Item>
//             </Col>

//             <Col span={12}>
//               <Form.Item
//                 label="NVR IP"
//                 name="nvrip"
//                 rules={[{ required: true, message: "NVR IP is required" }]}
//               >
//                 <Input placeholder="e.g., 10.0.0.1" />
//               </Form.Item>
//             </Col>
//           </Row>

//           {/* Row 3 */}
//           <Row gutter={16}>
//             <Col span={12}>
//               <Form.Item
//                 label="Port"
//                 name="port"
//                 rules={[{ required: true, message: "Port is required" }]}
//               >
//                 <InputNumber min={1} max={65535} style={{ width: "100%" }} />
//               </Form.Item>
//             </Col>

//             <Col span={12}>
//               <Form.Item
//                 label="Location"
//                 name="location"
//                 rules={[{ required: true, message: "Please enter location" }]}
//               >
//                 <Input placeholder="Enter location" />
//               </Form.Item>
//             </Col>
//           </Row>

//           {/* Row 4 */}
//           <Row gutter={16}>
//             <Col span={12}>
//               <Form.Item
//                 label="Zone"
//                 name="zone"
//                 rules={[{ required: true, message: "Please select a zone" }]}
//               >
//                 <Select placeholder="Select zone">
//                   {zones.map((z) => (
//                     <Option key={z.id} value={z.id}>
//                       {z.name}
//                     </Option>
//                   ))}
//                 </Select>
//               </Form.Item>
//             </Col>

//             <Col span={12}>
//               <Form.Item label="NVR Type" name="nvrtype">
//                 <Input placeholder="Optional" />
//               </Form.Item>
//             </Col>
//           </Row>

//           {/* Row 5 */}
//           <Row gutter={16}>
//             <Col span={12}>
//               <Form.Item label="Model" name="model">
//                 <Input placeholder="Optional" />
//               </Form.Item>
//             </Col>

//             <Col span={12}>
//               <Form.Item label="Make" name="make">
//                 <Input placeholder="Optional" />
//               </Form.Item>
//             </Col>
//           </Row>

//           {/* Row 6 */}
//           <Row gutter={16}>
//             <Col span={12}>
//               <Form.Item label="Responsible Person" name="responsible_Person">
//                 <Input placeholder="Optional" />
//               </Form.Item>
//             </Col>

//             <Col span={12}>
//               <Form.Item label="Status" name="status" valuePropName="checked">
//                 <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
//               </Form.Item>
//             </Col>
//           </Row>

//           {/* Row 7 - Upload */}
//           <Row gutter={16}>
//             <Col span={12}>
//               <Form.Item label="Upload Image" name="img">
//                 <Upload beforeUpload={() => false} maxCount={1}>
//                   <Button icon={<UploadOutlined />} style={{ borderColor: "#522EA8", color: "#522EA8" }}>
//                     Click to Upload
//                   </Button>
//                 </Upload>
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
//               {editingNvr ? "Update NVR" : "Create NVR"}
//             </Button>
//             <Button
//               className="ml-2"
//               onClick={() => navigate("/devices/nvrs")}
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

// export default NvrForm;
