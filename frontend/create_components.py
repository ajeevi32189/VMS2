import os

source_file = r'e:\Final-vms\canada-vms\src\Component\Pages\Analytics\CrowdDetection.jsx'
with open(source_file, 'r', encoding='utf-8') as f:
    content = f.read()

# For Facial Recognition
facial_content = content.replace('CrowdDetection', 'FacialRecognition')
facial_content = facial_content.replace('isCrowdAlert', 'isFacialAlert')
facial_content = facial_content.replace('crowdAlertsOnly', 'facialAlertsOnly')
facial_content = facial_content.replace('allCrowdAlerts', 'allFacialAlerts')
facial_content = facial_content.replace('Crowd Alerts', 'Facial Recognition Alerts')
facial_content = facial_content.replace('👥 Crowd', '👤 Facial Recognition')
facial_content = facial_content.replace('crowd alerts', 'facial recognition alerts')
facial_content = facial_content.replace('Crowd alerts', 'Facial recognition alerts')
facial_content = facial_content.replace('Crowd API Error', 'Facial API Error')
facial_content = facial_content.replace('Loading Crowd Alerts', 'Loading Facial Recognition Alerts')
facial_content = facial_content.replace('alertType=Crowd&objectName=Crowd', 'alertType=Facial&objectName=Facial')
facial_content = facial_content.replace('"crowd"', '"facial"').replace('"Crowd"', '"Facial"')

with open(r'e:\Final-vms\canada-vms\src\Component\Pages\Analytics\FacialRecognition.jsx', 'w', encoding='utf-8') as f:
    f.write(facial_content)

# For Abandoned Object
abandoned_content = content.replace('CrowdDetection', 'AbandonedObject')
abandoned_content = abandoned_content.replace('isCrowdAlert', 'isAbandonedAlert')
abandoned_content = abandoned_content.replace('crowdAlertsOnly', 'abandonedAlertsOnly')
abandoned_content = abandoned_content.replace('allCrowdAlerts', 'allAbandonedAlerts')
abandoned_content = abandoned_content.replace('Crowd Alerts', 'Abandoned Object Alerts')
abandoned_content = abandoned_content.replace('👥 Crowd', '📦 Abandoned Object')
abandoned_content = abandoned_content.replace('crowd alerts', 'abandoned object alerts')
abandoned_content = abandoned_content.replace('Crowd alerts', 'Abandoned object alerts')
abandoned_content = abandoned_content.replace('Crowd API Error', 'Abandoned API Error')
abandoned_content = abandoned_content.replace('Loading Crowd Alerts', 'Loading Abandoned Object Alerts')
abandoned_content = abandoned_content.replace('alertType=Crowd&objectName=Crowd', 'alertType=Abandoned&objectName=Abandoned')
abandoned_content = abandoned_content.replace('"crowd"', '"abandoned"').replace('"Crowd"', '"Abandoned"')

with open(r'e:\Final-vms\canada-vms\src\Component\Pages\Analytics\AbandonedObject.jsx', 'w', encoding='utf-8') as f:
    f.write(abandoned_content)
