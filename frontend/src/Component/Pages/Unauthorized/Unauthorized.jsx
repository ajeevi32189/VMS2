import React from "react";
import { useNavigate } from "react-router-dom";
import { Result, Button } from "antd";
import { ArrowLeftOutlined, VideoCameraOutlined } from "@ant-design/icons";

const Unauthorized = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6 bg-white">
      <Result
        status="403"
        title="403 - Access Denied"
        subTitle="You do not have sufficient permissions to access this module or resource."
        extra={[
          <Button
            type="primary"
            key="stream"
            icon={<VideoCameraOutlined />}
            onClick={() => navigate("/live/stream")}
            className="bg-[#9864DB] hover:bg-[#8552c7] border-none"
          >
            Go to Live Stream
          </Button>,
          <Button
            key="dashboard"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate("/dashboard")}
          >
            Dashboard
          </Button>,
        ]}
      />
    </div>
  );
};

export default Unauthorized;

