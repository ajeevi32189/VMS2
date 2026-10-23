import React, { useState, useEffect } from "react";
import { Modal, Form, Input, InputNumber, Popconfirm, message, Spin } from "antd";
import { EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { ticketApi } from "../../../utils/axiosInstance";
import { useAuth } from "../../../Authentication/AuthContext";

const SlaTable = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSla, setEditingSla] = useState(null);
  const [form] = Form.useForm();
  
  const { role } = useAuth();
  const isAdmin = (role || "").toLowerCase() === "admin";

  const fetchSlas = async () => {
    setLoading(true);
    try {
      const res = await ticketApi.get("/api/sla");
      if (Array.isArray(res.data)) {
        setData(res.data);
      } else if (res.data && Array.isArray(res.data.items)) {
        setData(res.data.items);
      } else if (res.data && Array.isArray(res.data.data)) {
        setData(res.data.data);
      } else {
        setData([]);
      }
    } catch (err) {
      console.error("Failed to fetch SLAs:", err);
      message.error("Failed to load SLAs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSlas();
  }, []);

  const handleOpenModal = (sla = null) => {
    setEditingSla(sla);
    if (sla) {
      form.setFieldsValue({
        name: sla.name,
        resolutionTimeInMinutes: sla.resolutionTimeInMinutes,
      });
    } else {
      form.resetFields();
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingSla(null);
    form.resetFields();
  };

  const handleSubmit = async (values) => {
    setLoading(true);
    try {
      if (editingSla) {
        await ticketApi.put(`/api/sla/${editingSla.id}`, {
          name: values.name,
          resolutionTimeInMinutes: values.resolutionTimeInMinutes,
        });
        message.success("SLA updated successfully!");
      } else {
        await ticketApi.post("/api/sla", {
          name: values.name,
          resolutionTimeInMinutes: values.resolutionTimeInMinutes,
        });
        message.success("SLA created successfully!");
      }
      handleCloseModal();
      fetchSlas();
    } catch (err) {
      console.error("SLA operation failed:", err);
      message.error(err.response?.data?.message || "Operation failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    setLoading(true);
    try {
      await ticketApi.delete(`/api/sla/${id}`);
      message.success("SLA deleted successfully!");
      fetchSlas();
    } catch (err) {
      console.error("Failed to delete SLA:", err);
      message.error("Failed to delete SLA");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 space-y-4 max-w-full">
      {/* Header Banner */}
      <div className="flex px-2 py-3 rounded-md flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-[#9864db] text-[#E6E6FA]">
        <div className="flex flex-col">
          <h2 className="text-xl font-bold text-[#fce4e4]">SLA Configurations</h2>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="px-3 py-1.5 bg-[#7844bb] text-white rounded-md text-sm hover:bg-[#6834aa] transition-colors"
        >
          + Add SLA
        </button>
      </div>

      {/* Table Wrapper */}
      <div className="overflow-x-auto rounded-md border-[#e7e5ec] shadow">
        <table className="min-w-full text-sm">
          <thead className="bg-[#9864db] text-[#E6E6FA]">
            <tr>
              <th className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold">S.No</th>
              <th className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold">ID</th>
              <th className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold">SLA Name</th>
              <th className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold">Resolution Time</th>
              <th className="px-4 py-3 border border-[#e7e5ec] text-left font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-green-100">
            {loading && data.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-gray-500">
                  <Spin tip="Loading SLAs..." />
                </td>
              </tr>
            ) : data.length > 0 ? (
              data.map((record, index) => {
                const minutes = record.resolutionTimeInMinutes;
                const hours = minutes ? (minutes / 60).toFixed(1) : "N/A";
                return (
                  <tr key={record.id} className="hover:bg-green-50">
                    <td className="px-4 py-3 border border-green-100 whitespace-nowrap font-medium text-gray-700">
                      {index + 1}
                    </td>
                    <td className="px-4 py-3 border border-green-100 whitespace-nowrap text-xs text-gray-500">
                      {record.id}
                    </td>
                    <td className="px-4 py-3 border border-green-100 whitespace-nowrap font-semibold text-purple-700">
                      {record.name}
                    </td>
                    <td className="px-4 py-3 border border-green-100 whitespace-nowrap text-gray-700">
                      {minutes ? `${minutes} mins (~${hours} hrs)` : "N/A"}
                    </td>
                    <td className="px-4 py-3 border border-green-100 whitespace-nowrap">
                      <div className="flex gap-3">
                        <EditOutlined
                          style={{ color: "#16a34a", fontSize: "15px", cursor: "pointer" }}
                          onClick={() => handleOpenModal(record)}
                        />
                        {isAdmin && (
                          <Popconfirm
                            title="Are you sure to delete this SLA?"
                            onConfirm={() => handleDelete(record.id)}
                            okText="Yes"
                            cancelText="No"
                          >
                            <DeleteOutlined
                              style={{ color: "#dc2626", fontSize: "15px", cursor: "pointer" }}
                            />
                          </Popconfirm>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={5} className="py-6 text-center text-gray-500">
                  No SLAs found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* SLA Modal Form */}
      <Modal
        title={editingSla ? "Edit SLA Configuration" : "Add SLA Configuration"}
        open={isModalOpen}
        onCancel={handleCloseModal}
        onOk={() => form.submit()}
        confirmLoading={loading}
        centered
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          className="mt-4"
        >
          <Form.Item
            label="SLA Name"
            name="name"
            rules={[
              { required: true, message: "Please enter SLA name" },
              { max: 120, message: "Name cannot exceed 120 characters" }
            ]}
          >
            <Input placeholder="e.g., Gold Support, High Severity SLA" />
          </Form.Item>

          <Form.Item
            label="Resolution Time (in Minutes)"
            name="resolutionTimeInMinutes"
            rules={[
              { required: true, message: "Please enter resolution time" },
              { type: "number", min: 1, message: "Must be at least 1 minute" }
            ]}
          >
            <InputNumber className="w-full" placeholder="e.g., 60, 240, 1440" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Sticky footer copyright */}
      <div className="fixed bottom-2 right-4 text-xs font-bold">
        <span className="text-red-600">© Ajeevi</span>{" "}
        <span className="text-blue-600">Technologies Pvt. Ltd.</span>
      </div>
    </div>
  );
};

export default SlaTable;
