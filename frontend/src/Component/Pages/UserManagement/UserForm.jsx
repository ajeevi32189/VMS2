import React, { useEffect, useState } from "react";
import { Form, Input, Button, Card, message, Select, Spin } from "antd";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "../../../utils/axiosInstance"; // centralized axios
// import Cookies only if you still need it elsewhere

const UserForm = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [roles, setRoles] = useState([]);
  const navigate = useNavigate();
  const location = useLocation();

  const editingUser = location.state?.user || null; // check if editing

  // Fetch roles
  const fetchRoles = async () => {
    try {
      const res = await api.get("/roles"); // ✅ centralized axios
      setRoles(res.data || []);
    } catch (err) {
      message.error("Failed to load roles");
    }
  };

  useEffect(() => {
    fetchRoles();

    if (editingUser) {
      form.setFieldsValue({
        email: editingUser.email,
        roleName: editingUser.roles?.[0] || "", // first role
      });
    }
  }, [editingUser]);

  // Submit handler
  const onFinish = async (values) => {
    setLoading(true);
    try {
      if (editingUser) {
        await api.put(`/users/${editingUser.id}`, values); // update user
        message.success("User updated successfully!");
      } else {
        await api.post("/users", values); // create new user
        message.success("User created successfully!");
      }

      form.resetFields();
      navigate("/users");
    } catch (err) {
      console.error(err);
      message.error("Operation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="m-4 shadow-md">
      <div className="mb-4 bg-[#9864DB] text-white px-6 py-2 rounded-md">
        <h3 className="text-xl font-semibold">
          {editingUser ? "✏️ Edit User" : "➕ Add User"}
        </h3>
      </div>

      <Spin spinning={loading}>
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          initialValues={{ email: "", password: "", roleName: "" }}
        >
          {/* Email */}
          <Form.Item
            label="Email"
            name="email"
            rules={[
              { required: true, message: "Please enter email" },
              { type: "email", message: "Enter a valid email" },
            ]}
          >
            <Input placeholder="Enter email" />
          </Form.Item>

        {/* Password (hide in edit mode) */}
        {!editingUser && (
          <Form.Item
            label="Password"
            name="password"
            rules={[{ required: true, message: "Please enter password" }]}
          >
            <Input.Password placeholder="Enter password" />
          </Form.Item>
        )}

        {/* Role Select */}
        <Form.Item
          label="Role"
          name="roleName"
          rules={[{ required: true, message: "Please select a role" }]}
        >
          <Select placeholder="Select role">
            {roles.map((role) => (
              <Select.Option key={role.id} value={role.name}>
                {role.name}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        {/* Buttons */}
        <Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            style={{ background: "#522EA8", border: "none" }}
            loading={loading}
          >
            {editingUser ? "Update User" : "Create User"}
          </Button>
          <Button className="ml-2" onClick={() => navigate("/users")}>
            Cancel
          </Button>
        </Form.Item>
      </Form>
    </Spin>
    </Card >
  );
};

export default UserForm;
