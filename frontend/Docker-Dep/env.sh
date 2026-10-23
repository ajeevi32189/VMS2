#!/bin/sh

# Replace placeholders in env.js with actual Docker ENV values
sed -i "s|__API_URL__|${API_URL}|g" /usr/share/nginx/html/env.js
sed -i "s|__CAMERA_API_URL__|${CAMERA_API_URL}|g" /usr/share/nginx/html/env.js
sed -i "s|__STREAMING_API_URL__|${STREAMING_API_URL}|g" /usr/share/nginx/html/env.js
sed -i "s|__GO2RTC_URL__|${GO2RTC_URL}|g" /usr/share/nginx/html/env.js
sed -i "s|__ONVIF_API_URL__|${ONVIF_API_URL}|g" /usr/share/nginx/html/env.js
sed -i "s|__RECORDING_API_URL__|${RECORDING_API_URL}|g" /usr/share/nginx/html/env.js
sed -i "s|__ANALYTICS_API_URL__|${ANALYTICS_API_URL}|g" /usr/share/nginx/html/env.js
sed -i "s|__ROI_API_URL__|${ROI_API_URL}|g" /usr/share/nginx/html/env.js
sed -i "s|__TICKET_API_URL__|${TICKET_API_URL}|g" /usr/share/nginx/html/env.js
sed -i "s|__ONVIFGO2RTC_URL__|${ONVIFGO2RTC_URL}|g" /usr/share/nginx/html/env.js

exec "$@"
