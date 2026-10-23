import React, { useEffect, useState } from "react";
import {
  Table,
  Form,
  Input,
  Button,
  Card,
  message,
  Tooltip,
  Popconfirm,
} from "antd";
import {
  EditOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";
import { api } from "../../../utils/axiosInstance"; // centralized axios instance
import { useAuth } from "../../../Authentication/AuthContext";
import { formatIndianDateTime } from "../../../utils/imageUtils";

const RoleData = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [tableLoading, setTableLoading] = useState(false);
  const [roles, setRoles] = useState([]); // full list from API
  const [editingRole, setEditingRole] = useState(null);
  const { role } = useAuth();
  const isAdmin = (role || "").toLowerCase() === "admin";

  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 5,
    total: 0,
  });

  // Fetch Roles
  const fetchRoles = async () => {
    setTableLoading(true);
    try {
      const res = await api.get("/roles");
      const data = res.data || [];
      setRoles(data);
      setPagination((prev) => ({
        ...prev,
        total: data.length,
      }));
    } catch (err) {
      message.error("Failed to load roles");
    } finally {
      setTableLoading(false);
    }
  };

  useEffect(() => {
    fetchRoles();
  }, []);

  // Add / Update Role
  const onFinish = async (values) => {
    try {
      setLoading(true);
      if (editingRole) {
        await api.put(`/roles/${editingRole.id}`, values);
        message.success("Role updated!");
      } else {
        await api.post("/roles", values);
        message.success("Role created!");
      }
      form.resetFields();
      setEditingRole(null);
      fetchRoles();
    } catch (err) {
      message.error("Operation failed");
    } finally {
      setLoading(false);
    }
  };

  // Delete Role
  const handleDelete = async (id) => {
    try {
      await api.delete(`/roles/${id}`);
      message.success("Role deleted!");
      fetchRoles();
    } catch (err) {
      message.error("Delete failed");
    }
  };

  // Columns
  const columns = [
    {
      title: "S.No",
      render: (_, __, index) =>
        (pagination.current - 1) * pagination.pageSize + index + 1,
    },
    {
      title: "Role ID",
      dataIndex: "id",
    },
    {
      title: "Role Name",
      dataIndex: "name",
    },
    {
      title: "Created Date & Time",
      key: "createdAt",
      render: (_, record) => {
        const rawDate = record.createdAt || record.created_at || record.createdDate || null;
        return (
          <span className="text-xs text-gray-600 font-medium">
            {rawDate ? formatIndianDateTime(rawDate) : "—"}
          </span>
        );
      },
    },
    {
      title: "Actions",
      key: "actions",
      render: (_, record) => isAdmin ? (
        <div className="flex gap-2">
          <Tooltip title="Edit">
            <Button
              type="link"
              icon={<EditOutlined />}
              onClick={() => {
                setEditingRole(record);
                form.setFieldsValue({ name: record.name });
              }}
            />
          </Tooltip>
          <Popconfirm
            title="Are you sure to delete this role?"
            onConfirm={() => handleDelete(record.id)}
            okText="Yes"
            cancelText="No"
            icon={<ExclamationCircleOutlined style={{ color: "red" }} />}
          >
            <Tooltip title="Delete">
              <Button type="link" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </div>
      ) : null,
    },
  ];

  // Table pagination change
  const handleTableChange = (pag) => {
    setPagination(pag);
  };

  // Slice roles for frontend pagination
  const paginatedData = roles.slice(
    (pagination.current - 1) * pagination.pageSize,
    pagination.current * pagination.pageSize
  );

  return (
    <Card className="m-4">
      {/* Header */}
      <div className="flex justify-between items-center bg-[#9864DB] text-white px-6 py-2 rounded-md shadow-sm mb-4">
        <div>
          <h3 className="text-2xl font-semibold mb-1">
            {editingRole ? "✏️ Edit Role" : "🛡️ Create New Role"}
          </h3>
          <p className="text-sm text-gray-100">
            {editingRole
              ? `Editing: ${editingRole.name}`
              : "Enter role name and save"}
          </p>
        </div>
      </div>

      {/* Form - Only show for Admin */}
      {isAdmin && (
        <Form
          form={form}
          layout="vertical"
          initialValues={{ name: "" }}
          onFinish={onFinish}
        >
          <Form.Item
            name="name"
            label="Role Name"
            rules={[{ required: true, message: "Please enter role name" }]}
          >
            <Input placeholder="Enter role name" />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              style={{ background: "#522EA8", border: "none" }}
            >
              {editingRole ? "Update Role" : "Create Role"}
            </Button>
            {editingRole && (
              <Button
                className="ml-2"
                onClick={() => {
                  form.resetFields();
                  setEditingRole(null);
                }}
              >
                Cancel
              </Button>
            )}
          </Form.Item>
        </Form>
      )}

      {/* Table */}
      <h3 className="text-lg font-semibold mt-6 mb-2">📋 All Roles</h3>
      <Table
        dataSource={paginatedData}
        columns={columns}
        rowKey="id"
        loading={tableLoading}
        pagination={pagination}
        onChange={handleTableChange}
        bordered
      />
      {/* Footer */}
<div className="fixed bottom-2 right-4 text-xs font-bold">
  <span className="text-red-600">© Ajeevi</span>{" "}
  <span className="text-blue-600">Technologies Pvt. Ltd.</span>
</div>
    </Card>
  );
};

export default RoleData;
