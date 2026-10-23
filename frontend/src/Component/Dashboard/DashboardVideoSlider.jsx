// import React, { useState } from "react";
// import { Link } from "react-router-dom";
// import HlsPlayer from "react-hls-player";

// const videoData = [
//   {
//     id: 1,
//     title: "Highway Traffic",
//     src: "https://content.jwplatform.com/manifests/yp34SRmf.m3u8",
//   },
//   {
//     id: 2,
//     title: "Forest River",
//     src: "https://moiptvhls-i.akamaihd.net/hls/live/652317/live/master.m3u8",
//   },
//   {
//     id: 3,
//     title: "Ocean Drone View",
//     src: "https://content.jwplatform.com/manifests/yp34SRmf.m3u8",
//   },
// ];

// const DashboardVideoSlider = () => {
//   const [currentIndex, setCurrentIndex] = useState(0);

//   const nextVideo = () => {
//     setCurrentIndex((prev) => (prev + 1) % videoData.length);
//   };

//   const prevVideo = () => {
//     setCurrentIndex((prev) => (prev - 1 + videoData.length) % videoData.length);
//   };

//   const currentVideo = videoData[currentIndex];

//   return (
//     <div className="relative bg-purple-100 p-4 rounded-md shadow-md">
//       {/* Header */}
//       <div className="flex justify-between items-center mb-3">
//         <h2 className="text-xl font-semibold text-gray-800">Live Camera Feed</h2>
//         <Link
//           to="/all-videos"
//           className="text-sm text-purple-600 hover:underline"
//         >
//           View All
//         </Link>
//       </div>

//       {/* Video Container with fixed height */}
//       <div className="relative rounded-sm overflow-hidden shadow-md group h-64">
//         <HlsPlayer
//           key={currentVideo.id}
//           src={currentVideo.src}
//           autoPlay
//           controls
//           muted
//           playsInline
//           className="w-full h-full object-cover"
//         />

//         {/* Video Title */}
//         <div className="absolute bottom-2 left-2 bg-purple/70 text-sm px-3 py-1 rounded shadow text-white">
//           {currentVideo.title}
//         </div>

//         {/* Previous Button */}
//         <button
//           onClick={prevVideo}
//           className="absolute top-1/2 left-2 -translate-y-1/2 text-white bg-black/50 p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
//         >
//           ◀
//         </button>

//         {/* Next Button */}
//         <button
//           onClick={nextVideo}
//           className="absolute top-1/2 right-2 -translate-y-1/2 text-white bg-black/50 p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
//         >
//           ▶
//         </button>
//       </div>
//     </div>
//   );
// };

// export default DashboardVideoSlider;
