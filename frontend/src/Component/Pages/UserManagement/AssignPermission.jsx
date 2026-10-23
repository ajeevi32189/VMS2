import React, { useEffect, useState } from "react";
import {
    Table,
    Form,
    Select,
    Button,
    Card,
    message,
    Tooltip,
    Popconfirm,
} from "antd";
import {
    SafetyCertificateOutlined,
    ExclamationCircleOutlined,
} from "@ant-design/icons";
import { api } from "../../../utils/axiosInstance";
import { formatIndianDateTime } from "../../../utils/imageUtils";

const { Option } = Select;

const AssignPermission = () => {
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const [tableLoading, setTableLoading] = useState(false);

    const [roles, setRoles] = useState([]);
    const [permissions, setPermissions] = useState([]);
    const [assigned, setAssigned] = useState([]);

    const [selectedRole, setSelectedRole] = useState(null);

    const [pagination, setPagination] = useState({
        current: 1,
        pageSize: 5,
        total: 0,
    });

    // Fetch roles
    const fetchRoles = async () => {
        try {
            const res = await api.get("/roles");
            setRoles(res.data || []);
        } catch {
            message.error("Failed to load roles");
        }
    };

    // Fetch all permissions
    const fetchPermissions = async () => {
        try {
            const res = await api.get("/permissions");
            setPermissions(res.data?.data || []);
        } catch {
            message.error("Failed to load permissions");
        }
    };

    // Fetch assigned permissions for a role
    const fetchAssigned = async (roleName) => {
        if (!roleName) return;
        setTableLoading(true);
        try {
            const res = await api.get(`/permissions/role/${roleName}`);

            if (res.data?.status && Array.isArray(res.data.permissions)) {
                const data = res.data.permissions.map((p, idx) => ({
                    id: `${roleName}-${idx}`,
                    roleName: res.data.role,
                    permissionName: typeof p === "string" ? p : (p.name || p.permissionName),
                    createdAt: typeof p === "object" ? (p.createdAt || p.created_at || p.assignedAt || p.createdDate) : null,
                }));
                setAssigned(data);
                setPagination((prev) => ({ ...prev, total: data.length }));
            } else {
                setAssigned([]);
            }
        } catch {
            message.error("Failed to load role permissions");
        } finally {
            setTableLoading(false);
        }
    };

    useEffect(() => {
        fetchRoles();
        fetchPermissions();
    }, []);

    // Assign permission to role
    const onFinish = async (values) => {
        try {
            setLoading(true);
            await api.post(`/permissions/assign/${values.roleName}`, {
                permissionName: values.permissionName,
            });
            message.success("Permission assigned to role!");
            setSelectedRole(values.roleName);
            fetchAssigned(values.roleName);
            form.resetFields(["permissionName"]);
        } catch {
            message.error("Failed to assign permission");
        } finally {
            setLoading(false);
        }
    };
    // Remove permission from role
    const handleDelete = async (permissionName) => {
        try {
            await api.delete(`/permissions/role/${selectedRole}/${permissionName}`);
            message.success("Permission removed from role!");
            fetchAssigned(selectedRole);
        } catch {
            message.error("Delete failed");
        }
    };


    const columns = [
        {
            title: "S.No",
            render: (_, __, index) =>
                (pagination.current - 1) * pagination.pageSize + index + 1,
        },
        { title: "Permission", dataIndex: "permissionName" },
        {
            title: "Created Date & Time",
            key: "createdAt",
            render: (_, record) => {
                const rawDate = record.createdAt || record.created_at || record.assignedAt || null;
                return (
                    <span className="text-xs text-gray-600 font-medium">
                        {rawDate ? formatIndianDateTime(rawDate) : "—"}
                    </span>
                );
            },
        },
        {
            title: "Actions",
            render: (_, record) => (
                <Popconfirm
                    title="Remove this permission from role?"
                    onConfirm={() => handleDelete(record.permissionName)}
                    okText="Yes"
                    cancelText="No"
                    icon={<ExclamationCircleOutlined style={{ color: "red" }} />}
                >
                    <Tooltip title="Remove">
                        <Button type="link" danger>
                            Remove
                        </Button>
                    </Tooltip>
                </Popconfirm>
            ),
        },
    ];

    const handleTableChange = (pag) => setPagination(pag);

    const paginatedData = assigned.slice(
        (pagination.current - 1) * pagination.pageSize,
        pagination.current * pagination.pageSize
    );

    return (
        <Card className="m-4">
            {/* Header */}
            <div className="flex justify-between items-center bg-[#9864DB] text-white px-6 py-2 rounded-md shadow-sm mb-4">
                <div>
                    <h3 className="text-2xl font-semibold mb-1">
                        <SafetyCertificateOutlined /> Assign Role Permission
                    </h3>
                    <p className="text-sm text-gray-100">
                        Assign permissions to specific roles
                    </p>
                </div>
            </div>

            {/* Form */}
            <Form form={form} layout="vertical" onFinish={onFinish}>
                <Form.Item
                    name="roleName"
                    label="Select Role"
                    rules={[{ required: true, message: "Please select a role" }]}
                >
                    <Select
                        placeholder="Choose a role"
                        onChange={(value) => {
                            setSelectedRole(value);
                            fetchAssigned(value);
                        }}
                    >
                        {roles.map((r) => (
                            <Option key={r.id} value={r.name}>
                                {r.name}
                            </Option>
                        ))}
                    </Select>
                </Form.Item>

                <Form.Item
                    name="permissionName"
                    label="Select Permission"
                    rules={[{ required: true, message: "Please select a permission" }]}
                >
                    <Select placeholder="Choose a permission">
                        {permissions.map((p) => (
                            <Option key={p.name} value={p.name}>
                                {p.name}
                            </Option>
                        ))}
                    </Select>
                </Form.Item>

                <Form.Item>
                    <Button
                        type="primary"
                        htmlType="submit"
                        loading={loading}
                        style={{ background: "#522EA8", border: "none" }}
                    >
                        Assign
                    </Button>
                </Form.Item>
            </Form>

            {/* Table */}
            <h3 className="text-lg font-semibold mt-6 mb-2">
                📋 Permissions for Role:{" "}
                <span className="text-purple-700">{selectedRole || "None"}</span>
            </h3>
            <Table
                dataSource={paginatedData}
                columns={columns}
                rowKey={(record) => record.id}
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

export default AssignPermission;
