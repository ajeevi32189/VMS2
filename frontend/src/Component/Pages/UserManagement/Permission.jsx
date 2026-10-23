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

const PermissionData = () => {
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const [tableLoading, setTableLoading] = useState(false);
    const [permissions, setPermissions] = useState([]); // array of permissions
    const [editingPermission, setEditingPermission] = useState(null);
    const { role } = useAuth();
    const isAdmin = (role || "").toLowerCase() === "admin";

    const [pagination, setPagination] = useState({
        current: 1,
        pageSize: 5,
        total: 0,
    });

    // Fetch Permissions
    // Fetch Permissions
    const fetchPermissions = async () => {
        setTableLoading(true);
        try {
            const res = await api.get("/permissions");

            // ✅ Always read from res.data.data
            const data = Array.isArray(res.data?.data) ? res.data.data : [];

            setPermissions(data);
            setPagination((prev) => ({
                ...prev,
                total: data.length,
            }));
        } catch (err) {
            message.error("Failed to load permissions");
        } finally {
            setTableLoading(false);
        }
    };


    useEffect(() => {
        fetchPermissions();
    }, []);

    // Add / Update Permission
    const onFinish = async (values) => {
        try {
            setLoading(true);
            if (editingPermission) {
                await api.put(`/permissions/${editingPermission.id}`, values);
                message.success("Permission updated!");
            } else {
                await api.post("/permissions", values);
                message.success("Permission created!");
            }
            form.resetFields();
            setEditingPermission(null);
            fetchPermissions();
        } catch (err) {
            message.error("Operation failed");
        } finally {
            setLoading(false);
        }
    };

    // Delete Permission
    const handleDelete = async (id) => {
        try {
            await api.delete(`/permissions/${id}`);
            message.success("Permission deleted!");
            fetchPermissions();
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
            title: "Permission ID",
            dataIndex: "id",
        },
        {
            title: "Name",
            dataIndex: "name",
        },
        {
            title: "Description",
            dataIndex: "description",
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
                                setEditingPermission(record);
                                form.setFieldsValue({
                                    name: record.name,
                                    description: record.description,
                                });
                            }}
                        />
                    </Tooltip>
                    <Popconfirm
                        title="Are you sure to delete this permission?"
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

    // Frontend pagination slice
    const paginatedData = permissions.slice(
        (pagination.current - 1) * pagination.pageSize,
        pagination.current * pagination.pageSize
    );

    return (
        <Card className="m-4">
            {/* Header */}
            <div className="flex justify-between items-center bg-[#9864DB] text-white px-6 py-2 rounded-md shadow-sm mb-4">
                <div>
                    <h3 className="text-2xl font-semibold mb-1">
                        {editingPermission ? "✏️ Edit Permission" : "🔑 Create New Permission"}
                    </h3>
                    <p className="text-sm text-gray-100">
                        {editingPermission
                            ? `Editing: ${editingPermission.name}`
                            : "Enter permission details and save"}
                    </p>
                </div>
            </div>

            {/* Form - Only for Admin */}
            {isAdmin && (
                <Form
                    form={form}
                    layout="vertical"
                    initialValues={{ name: "", description: "" }}
                    onFinish={onFinish}
                >
                    <Form.Item
                        name="name"
                        label="Permission Name"
                        rules={[{ required: true, message: "Please enter permission name" }]}
                    >
                        <Input placeholder="Enter permission name" />
                    </Form.Item>

                    <Form.Item
                        name="description"
                        label="Permission Description"
                        rules={[{ required: true, message: "Please enter permission description" }]}
                    >
                        <Input.TextArea rows={1} placeholder="Enter description" />
                    </Form.Item>

                    <Form.Item>
                        <Button
                            type="primary"
                            htmlType="submit"
                            loading={loading}
                            style={{ background: "#522EA8", border: "none" }}
                        >
                            {editingPermission ? "Update Permission" : "Create Permission"}
                        </Button>
                        {editingPermission && (
                            <Button
                                className="ml-2"
                                onClick={() => {
                                    form.resetFields();
                                    setEditingPermission(null);
                                }}
                            >
                                Cancel
                            </Button>
                        )}
                    </Form.Item>
                </Form>
            )}

            {/* Table */}
            <h3 className="text-lg font-semibold mt-6 mb-2">📋 All Permissions</h3>
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

export default PermissionData;
