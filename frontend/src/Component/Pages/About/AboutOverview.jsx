import React from "react";
import { Card, Tag, Timeline, Button } from "antd";
import { motion } from "framer-motion";
import {
  LineChartOutlined,
  CloudServerOutlined,
  LockOutlined,
  DeploymentUnitOutlined,
  MobileOutlined,
  SettingOutlined,
  DatabaseOutlined,
  TeamOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";

// Motion Variants
const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const item = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 120, damping: 16 },
  },
};

const AboutOverview = () => {
  return (
    <div className="min-h-screen pb-20 bg-gradient-to-b from-purple-50 via-white to-purple-50">
      {/* Hero Section */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7 }}
        className="relative text-center bg-purple-700 py-16 px-6 overflow-hidden rounded-xl"
      >
        {/* Solid Purple Background */}
        <div className="absolute inset-0 bg-purple-700 opacity-95 -z-10" />

        {/* Animated glow circles */}
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 6, repeat: Infinity }}
          className="absolute top-10 left-1/4 w-40 h-40 bg-purple-400 rounded-full blur-3xl opacity-40 -z-10"
        />
        <motion.div
          animate={{ scale: [1.2, 1, 1.2], opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 7, repeat: Infinity }}
          className="absolute bottom-10 right-1/4 w-48 h-48 bg-purple-300 rounded-full blur-3xl opacity-40 -z-10"
        />

        {/* Content */}
        <Tag
          color="purple"
          className="px-4 py-1 text-sm rounded-full shadow-sm bg-white/20 text-white border-none"
        >
          VMS • Overview
        </Tag>
        <h1 className="text-4xl md:text-5xl font-extrabold text-white mt-4">
          A Modern Video Management System
        </h1>
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mx-auto mt-4 h-1 w-24 bg-white rounded-full origin-left"
        />
        <p className="mt-6 max-w-2xl mx-auto text-gray-100 text-lg">
          Designed for{" "}
          <span className="font-semibold text-white">enterprises</span>,{" "}
          <span className="font-semibold text-white">smart cities</span>, and{" "}
          <span className="font-semibold text-white">
            critical infrastructure
          </span>{" "}
          — delivering scalability, intelligence, and rock-solid security.
        </p>
      </motion.div>

      {/* 🌟 Key Highlights */}
      <motion.div
        variants={container}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-80px" }}
        className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 px-4"
      >
        {[
          {
            title: "Smart Detection",
            icon: <LineChartOutlined />,
            desc: "AI-powered fire, intrusion, and anomaly detection in real-time.",
          },
          {
            title: "Cloud + Edge",
            icon: <CloudServerOutlined />,
            desc: "Hybrid storage: edge NVRs, cloud archive, and redundancy.",
          },
          {
            title: "Ultra Security",
            icon: <LockOutlined />,
            desc: "Zero-trust architecture with encryption & role-based access.",
          },
          {
            title: "Scalability",
            icon: <DeploymentUnitOutlined />,
            desc: "Manage 10 to 10,000+ cameras with seamless scaling.",
          },
          {
            title: "Mobile Ready",
            icon: <MobileOutlined />,
            desc: "Monitor anywhere, anytime with mobile-first design.",
          },
          {
            title: "Ops Friendly",
            icon: <SettingOutlined />,
            desc: "Centralized health alerts & automated recovery.",
          },
        ].map((f, i) => (
          <motion.div key={i} variants={item}>
            <Card className="rounded-xl shadow-md hover:shadow-lg transition-all border border-purple-100 h-full">
              <div className="flex items-start gap-3">
                <div className="h-12 w-12 grid place-content-center rounded-xl bg-purple-50 text-purple-600 text-xl">
                  {f.icon}
                </div>
                <div>
                  <h3 className="font-semibold text-gray-800">{f.title}</h3>
                  <p className="text-sm text-gray-500 mt-1">{f.desc}</p>
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      {/* 🛡 Why Choose Us */}
      <Card className="mt-12 mx-4 rounded-2xl border border-purple-100 shadow-md p-6">
        <h2 className="text-xl font-semibold text-purple-700 mb-4">
          Why Choose Our VMS?
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 text-base text-gray-600">
          <li>✅ Ultra-low latency streaming across all devices</li>
          <li>✅ AI-driven analytics for proactive alerts</li>
          <li>✅ Secure & compliant with GDPR, ISO standards</li>
          <li>✅ 99.97% uptime SLA with high availability</li>
          <li>✅ Scales from SMBs to enterprise deployments</li>
          <li>✅ Modern UI with intuitive dashboards</li>
        </ul>
      </Card>

      {/* 🏭 Use Cases & Analytics */}
      <Card className="mt-12 mx-4 rounded-2xl border border-purple-100 shadow-md p-6">
        <h2 className="text-xl font-semibold text-purple-700 mb-4">
          Use Cases & AI Analytics
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-gray-600 text-sm">
          <li>🏙 Smart City – Traffic Monitoring, License Plate Recognition</li>
          <li>🚇 Public Safety – Crowd Detection, Loitering Alerts</li>
          <li>🏭 Locations – Intrusion Detection, Truck Tracking</li>
          <li>🔥 Fire & Smoke Detection in critical facilities</li>
          <li>🛡 Perimeter Guarding & Virtual Fencing</li>
          <li>🚶 People Counting, Heatmaps & Queue Analysis</li>
          <li>🎥 Retail – Loss Prevention & Behavioral Analytics</li>
          <li>📦 Logistics – Loading Bay & Vehicle Flow Monitoring</li>
          <li>⚠️ Abandoned Object & Suspicious Activity Alerts</li>
        </ul>
      </Card>

      {/* 📊 Advanced Features */}
      <Card className="mt-12 mx-4 rounded-2xl border border-purple-100 shadow-md p-6">
        <h2 className="text-xl font-semibold text-purple-700 mb-4">
          Advanced Features
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-gray-600 text-sm">
          <li>🔗 Third-party integrations (IoT, sensors, alarms)</li>
          <li>📊 Advanced reporting & incident analytics</li>
          <li>👥 Role-based multi-user access control</li>
          <li>☁️ Cloud backup & disaster recovery</li>
          <li>🔐 End-to-end encryption with audit trails</li>
          <li>⚡ Real-time alert SLA under 1.2s</li>
        </ul>
      </Card>

      {/* ⏳ Release Timeline */}
      <Card className="mt-12 mx-4 rounded-2xl border border-purple-100 shadow-sm p-6">
        <h2 className="text-xl font-semibold text-purple-700 mb-4">
          Release Timeline
        </h2>
        <Timeline
          items={[
            {
              color: "purple",
              children: (
                <div>
                  <b>v1.0</b> — First Release (March 2025) – Core streaming &
                  recording
                </div>
              ),
            },
            {
              color: "purple",
              children: (
                <div>
                  <b>v2.0</b> — Second Release (Oct 2025) – AI Analytics & Smart
                  Detection
                </div>
              ),
            },
            {
              color: "purple",
              children: (
                <div>
                  <b>v3.0</b> — Final Release (Jan 2026) – Enterprise-scale
                  multi-site & reporting
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* 🚀 Future Roadmap */}
      <Card className="mt-12 mx-4 rounded-2xl border border-purple-100 shadow-md p-6">
        <h2 className="text-xl font-semibold text-purple-700 mb-4">
          Future Roadmap
        </h2>
        <p className="text-sm text-gray-600 mb-3">
          Beyond 2026, we’re focusing on predictive analytics, automation, and
          global scale.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2 text-sm text-gray-600">
          <li>🤖 AI-powered video summarization</li>
          <li>📊 Predictive alerting for threat prevention</li>
          <li>🌍 Global-scale multi-cloud support</li>
          <li>🔗 Deeper IoT & sensor integrations</li>
          <li>🛰 Edge AI for offline intelligence</li>
        </ul>
      </Card>

      {/* Footer */}
      <div className="fixed bottom-2 right-4 text-xs font-bold">
        <span className="text-red-600">© Ajeevi</span>{" "}
        <span className="text-blue-600">Technologies Pvt. Ltd.</span>
      </div>
    </div>
  );
};

export default AboutOverview;
